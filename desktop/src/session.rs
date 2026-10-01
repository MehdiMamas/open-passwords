use std::time::{Duration, Instant};

use serde_json::{json, Value};
use url::Url;
use zeroize::Zeroizing;

use crate::host::Host;
use crate::srp::{
    bytes_to_bigint, SrpSession, MSG_CLIENT_KEY_EXCHANGE, MSG_CLIENT_VERIFICATION, MSG_SERVER_KEY_EXCHANGE,
    MSG_SERVER_VERIFICATION, SRP_WITH_RFC_VERIFICATION,
};

const CHALLENGE_TTL: Duration = Duration::from_secs(180);
const CMD_HANDSHAKE: i64 = 2;
const CMD_GET_LOGIN_NAMES: i64 = 4;
const CMD_GET_PASSWORD: i64 = 5;
const CMD_GET_CAPABILITIES: i64 = 14;
const ACTION_SEARCH: i64 = 2;
const ACTION_GHOST_SEARCH: i64 = 5;
const STATUS_SUCCESS: i64 = 0;
const STATUS_NO_RESULTS: i64 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Disconnected,
    NeedsPin,
    Unlocked,
    NoHelper,
}

pub struct SessionError {
    pub message: String,
    pub reissued: bool,
}

impl SessionError {
    fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), reissued: false }
    }

    fn reissued(message: impl Into<String>) -> Self {
        Self { message: message.into(), reissued: true }
    }
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

#[derive(Clone, Debug)]
pub struct Login {
    pub username: String,
}

pub struct Session {
    host: Option<Host>,
    srp: Option<SrpSession>,
    state: State,
    challenge_at: Option<Instant>,
}

impl Session {
    pub fn new() -> Self {
        Self {
            host: None,
            srp: None,
            state: State::Disconnected,
            challenge_at: None,
        }
    }

    pub fn state(&self) -> State {
        self.state
    }

    pub fn connect(&mut self) -> Result<(), SessionError> {
        if self.host.is_some() && self.srp.is_some() {
            return Ok(());
        }
        self.drop_host();
        let mut host = match Host::spawn() {
            Ok(host) => host,
            Err(e) => {
                self.state = State::NoHelper;
                return Err(SessionError::new(e));
            }
        };
        let reply = host
            .request(&json!({ "cmd": CMD_GET_CAPABILITIES }), Some(Duration::from_secs(5)))
            .map_err(|e| {
                self.state = State::Disconnected;
                SessionError::new(e)
            })?;
        let caps = reply.get("capabilities").cloned().unwrap_or(Value::Null);
        if let Some(version) = caps.get("secretSessionVersion").and_then(as_int) {
            if version != SRP_WITH_RFC_VERIFICATION {
                self.state = State::Disconnected;
                return Err(SessionError::new("unsupported capabilities (expected SRP RFC verification)"));
            }
        }
        let use_b64 = caps.get("shouldUseBase64").and_then(|v| v.as_bool()).unwrap_or(false);
        let srp = SrpSession::new(use_b64).map_err(SessionError::new)?;
        self.host = Some(host);
        self.srp = Some(srp);
        self.challenge_at = None;
        self.state = State::NeedsPin;
        Ok(())
    }

    pub fn has_challenge(&self) -> bool {
        self.state == State::NeedsPin
            && self.srp.as_ref().is_some_and(|s| s.has_server())
            && self.challenge_at.is_some_and(|t| t.elapsed() < CHALLENGE_TTL)
    }

    pub fn request_challenge(&mut self) -> Result<(), SessionError> {
        if self.srp.is_none() {
            self.connect()?;
        }
        let srp = self.srp.as_ref().ok_or_else(|| SessionError::new("not connected"))?;
        let pake = json_to_base64(&json!({
            "TID": srp.username,
            "MSG": MSG_CLIENT_KEY_EXCHANGE,
            "A": srp.serialize(&srp.client_public_key_bytes(), true),
            "VER": "1.0",
            "PROTO": [SRP_WITH_RFC_VERIFICATION],
        }));
        if let Some(srp) = self.srp.as_mut() {
            srp.clear_challenge();
        }
        let reply = self
            .send(json!({
                "cmd": CMD_HANDSHAKE,
                "msg": { "QID": "m0", "PAKE": pake, "HSTBRSR": "Chrome" }
            }))
            .map_err(SessionError::new)?;
        let pake = pake_object(&reply)?;
        let srp = self.srp.as_mut().ok_or_else(|| SessionError::new("not connected"))?;
        if pake.get("TID").and_then(|v| v.as_str()) != Some(srp.username.as_str()) {
            return Err(SessionError::new("challenge for another session"));
        }
        if pake.get("ErrCode").is_some() {
            return Err(SessionError::new(format!("server hello error {}", pake["ErrCode"])));
        }
        let msg = pake.get("MSG").and_then(as_int).unwrap_or(-1);
        if msg != MSG_SERVER_KEY_EXCHANGE {
            return Err(SessionError::new("unexpected server message"));
        }
        let proto = pake.get("PROTO").and_then(as_int).unwrap_or(-1);
        if proto != SRP_WITH_RFC_VERIFICATION {
            return Err(SessionError::new("unsupported protocol"));
        }
        let b_str = pake.get("B").and_then(|v| v.as_str()).ok_or_else(|| SessionError::new("missing B"))?;
        let s_str = pake.get("s").and_then(|v| v.as_str()).ok_or_else(|| SessionError::new("missing salt"))?;
        let b = bytes_to_bigint(&srp.deserialize(b_str).map_err(SessionError::new)?);
        let salt = srp.deserialize(s_str).map_err(SessionError::new)?;
        srp.set_server_public_key(b, salt).map_err(SessionError::new)?;
        self.challenge_at = Some(Instant::now());
        self.state = State::NeedsPin;
        Ok(())
    }

    pub fn verify_pin(&mut self, pin: &str) -> Result<(), SessionError> {
        if self.srp.is_none() {
            return Err(SessionError::new("not connected"));
        }
        if !self.has_challenge() {
            self.request_challenge()?;
            return Err(SessionError::reissued("Enter the new code your PC is showing now"));
        }
        let result = self.verify_pin_inner(pin);
        if result.is_err() {
            if let Some(srp) = self.srp.as_mut() {
                srp.clear_challenge();
            }
            self.challenge_at = None;
        }
        result
    }

    fn verify_pin_inner(&mut self, pin: &str) -> Result<(), SessionError> {
        let srp = self.srp.as_mut().ok_or_else(|| SessionError::new("not connected"))?;
        srp.set_shared_key(pin).map_err(SessionError::new)?;
        let m = srp.compute_m().map_err(SessionError::new)?;
        let pake = json_to_base64(&json!({
            "TID": srp.username,
            "MSG": MSG_CLIENT_VERIFICATION,
            "M": srp.serialize(&m, false),
        }));
        let reply = self
            .send(json!({
                "cmd": CMD_HANDSHAKE,
                "msg": { "QID": "m2", "PAKE": pake }
            }))
            .map_err(SessionError::new)?;
        let pake = pake_object(&reply)?;
        let srp = self.srp.as_ref().ok_or_else(|| SessionError::new("not connected"))?;
        if pake.get("TID").and_then(|v| v.as_str()) != Some(srp.username.as_str()) {
            return Err(SessionError::new("verification for another session"));
        }
        let msg = pake.get("MSG").and_then(as_int).unwrap_or(-1);
        if msg != MSG_SERVER_VERIFICATION {
            return Err(SessionError::new("unexpected server message"));
        }
        if let Some(code) = pake.get("ErrCode").and_then(as_int) {
            if code == 1 {
                return Err(SessionError::new("Incorrect code"));
            }
            if code != 0 {
                return Err(SessionError::new(format!("verification error {code}")));
            }
        }
        let hamk = pake.get("HAMK").and_then(|v| v.as_str()).ok_or_else(|| SessionError::new("missing HAMK"))?;
        let remote = srp.deserialize(hamk).map_err(SessionError::new)?;
        if !srp.hamk_matches(&m, &remote).map_err(SessionError::new)? {
            return Err(SessionError::new("server HAMK mismatch"));
        }
        self.state = State::Unlocked;
        Ok(())
    }

    pub fn logins_for(&mut self, url: &str) -> Result<Vec<Login>, SessionError> {
        self.ensure_unlocked()?;
        let host = hostname(url)?;
        let res = self.encrypted_query(
            CMD_GET_LOGIN_NAMES,
            "CmdGetLoginNames4URL",
            Some(&host),
            json!({ "ACT": ACTION_GHOST_SEARCH, "URL": host }),
        )?;
        let status = res.get("STATUS").and_then(as_int).unwrap_or(-1);
        if status == STATUS_NO_RESULTS {
            return Ok(Vec::new());
        }
        if status != STATUS_SUCCESS {
            return Err(SessionError::new(query_status(status)));
        }
        let entries = res.get("Entries").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        Ok(entries
            .iter()
            .filter_map(|e| e.get("USR").and_then(|v| v.as_str()).map(|u| Login { username: u.to_string() }))
            .collect())
    }

    pub fn password_for(&mut self, url: &str, username: &str) -> Result<Zeroizing<String>, SessionError> {
        self.ensure_unlocked()?;
        let host = hostname(url)?;
        let res = self.encrypted_query(
            CMD_GET_PASSWORD,
            "CmdGetPassword4LoginName",
            Some(&host),
            json!({ "ACT": ACTION_SEARCH, "URL": host, "USR": username }),
        )?;
        let status = res.get("STATUS").and_then(as_int).unwrap_or(-1);
        if status == STATUS_NO_RESULTS {
            return Err(SessionError::new("No password for that login"));
        }
        if status != STATUS_SUCCESS {
            return Err(SessionError::new(query_status(status)));
        }
        let password = res
            .get("Entries")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .and_then(|e| e.get("PWD").and_then(|v| v.as_str()))
            .ok_or_else(|| SessionError::new("No password for that login"))?;
        Ok(Zeroizing::new(password.to_string()))
    }

    pub fn lock(&mut self) {
        if let Some(host) = self.host.as_mut() {
            host.end();
        }
        self.drop_host();
        self.state = State::Disconnected;
    }

    fn ensure_unlocked(&self) -> Result<(), SessionError> {
        if self.state == State::Unlocked && self.srp.is_some() && self.host.is_some() {
            Ok(())
        } else {
            Err(SessionError::new("not unlocked"))
        }
    }

    fn encrypted_query(&mut self, cmd: i64, qid: &str, hostname: Option<&str>, body: Value) -> Result<Value, SessionError> {
        let srp = self.srp.as_ref().ok_or_else(|| SessionError::new("not connected"))?;
        let encrypted = srp.encrypt(&body).map_err(SessionError::new)?;
        let sdata = srp.serialize(&encrypted, true);
        let smsg = serde_json::to_string(&json!({ "TID": srp.username, "SDATA": sdata })).map_err(|e| SessionError::new(e.to_string()))?;
        let mut message = json!({
            "cmd": cmd,
            "tabId": 0,
            "frameId": 0,
            "payload": { "QID": qid, "SMSG": smsg }
        });
        if let Some(hostname) = hostname {
            message["url"] = Value::String(hostname.to_string());
        }
        let reply = self.send(message).map_err(SessionError::new)?;
        let smsg = reply.get("payload").and_then(|p| p.get("SMSG")).ok_or_else(|| SessionError::new("missing SMSG"))?;
        let smsg = if let Some(text) = smsg.as_str() {
            serde_json::from_str::<Value>(text).map_err(|e| SessionError::new(e.to_string()))?
        } else {
            smsg.clone()
        };
        let srp = self.srp.as_ref().ok_or_else(|| SessionError::new("not connected"))?;
        if smsg.get("TID").and_then(|v| v.as_str()) != Some(srp.username.as_str()) {
            return Err(SessionError::new("response for another session"));
        }
        let sdata = smsg.get("SDATA").and_then(|v| v.as_str()).ok_or_else(|| SessionError::new("missing SDATA"))?;
        let bytes = srp.deserialize(sdata).map_err(SessionError::new)?;
        let plain = srp.decrypt(&bytes).map_err(SessionError::new)?;
        serde_json::from_slice(&plain).map_err(|e| SessionError::new(e.to_string()))
    }

    fn send(&mut self, message: Value) -> Result<Value, String> {
        let host = self.host.as_mut().ok_or("connection closed")?;
        host.request(&message, None)
    }

    fn drop_host(&mut self) {
        self.host = None;
        self.srp = None;
        self.challenge_at = None;
    }
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

fn hostname(url: &str) -> Result<String, SessionError> {
    let parsed = Url::parse(url).map_err(|_| SessionError::new("rule URL is not a valid URL"))?;
    parsed
        .host_str()
        .map(|h| h.to_string())
        .ok_or_else(|| SessionError::new("rule URL has no host"))
}

fn json_to_base64(value: &Value) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    STANDARD.encode(serde_json::to_vec(value).unwrap_or_default())
}

fn pake_object(reply: &Value) -> Result<Value, SessionError> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    let encoded = reply
        .get("payload")
        .and_then(|p| p.get("PAKE"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| SessionError::new("missing PAKE"))?;
    let bytes = STANDARD.decode(encoded).map_err(|e| SessionError::new(format!("PAKE: {e}")))?;
    serde_json::from_slice(&bytes).map_err(|e| SessionError::new(e.to_string()))
}

fn as_int(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn query_status(status: i64) -> String {
    match status {
        1 => "Generic query error".into(),
        2 => "Invalid query param".into(),
        3 => "No query results".into(),
        4 => "Failed to delete".into(),
        5 => "Failed to update".into(),
        6 => "Invalid message format".into(),
        7 => "Duplicate item".into(),
        8 => "Unknown action".into(),
        9 => "Invalid session".into(),
        other => format!("Query error: status {other}"),
    }
}
