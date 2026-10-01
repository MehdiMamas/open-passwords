use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::time::Duration;

use serde_json::Value;

const MAX_MESSAGE: usize = 1024 * 1024;

pub struct Host {
    child: Child,
    stdin: ChildStdin,
    stdout: std::process::ChildStdout,
}

impl Host {
    pub fn spawn() -> Result<Self, String> {
        let path = helper_path().ok_or_else(|| "iCloud for Windows is not installed".to_string())?;
        let mut child = Command::new(&path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("could not start the iCloud helper: {e}"))?;
        let stdin = child.stdin.take().ok_or("helper stdin missing")?;
        let stdout = child.stdout.take().ok_or("helper stdout missing")?;
        Ok(Self { child, stdin, stdout })
    }

    pub fn request(&mut self, message: &Value, timeout: Option<Duration>) -> Result<Value, String> {
        let _ = timeout;
        self.write(message)?;
        let want = message.get("cmd").and_then(|v| v.as_i64());
        for _ in 0..8 {
            let reply = self.read()?;
            if want.is_none() || reply.get("cmd").and_then(|v| v.as_i64()) == want {
                return Ok(reply);
            }
        }
        Err("helper reply did not match the request".into())
    }

    fn write(&mut self, message: &Value) -> Result<(), String> {
        let bytes = serde_json::to_vec(message).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_MESSAGE {
            return Err("message too large".into());
        }
        let len = (bytes.len() as u32).to_le_bytes();
        self.stdin.write_all(&len).map_err(|e| format!("helper write: {e}"))?;
        self.stdin.write_all(&bytes).map_err(|e| format!("helper write: {e}"))?;
        self.stdin.flush().map_err(|e| format!("helper write: {e}"))?;
        Ok(())
    }

    fn read(&mut self) -> Result<Value, String> {
        let mut len_buf = [0u8; 4];
        self.stdout.read_exact(&mut len_buf).map_err(|e| format!("helper closed: {e}"))?;
        let len = u32::from_le_bytes(len_buf) as usize;
        if len > MAX_MESSAGE {
            return Err("helper message too large".into());
        }
        let mut body = vec![0u8; len];
        self.stdout.read_exact(&mut body).map_err(|e| format!("helper closed: {e}"))?;
        serde_json::from_slice(&body).map_err(|e| format!("helper json: {e}"))
    }

    pub fn end(&mut self) {
        let _ = self.write(&serde_json::json!({ "cmd": 0 }));
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn helper_path() -> Option<PathBuf> {
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let alias = PathBuf::from(local).join(r"Microsoft\WindowsApps\iCloudPasswordsExtensionHelper.exe");
        if alias.is_file() {
            return Some(alias);
        }
    }
    let packaged = PathBuf::from(
        r"C:\Program Files\WindowsApps\AppleInc.iCloud_15.9.60.0_x64__nzyj5cx40ttqa\iCloud\iCloudPasswordsExtensionHelper.exe",
    );
    if packaged.is_file() {
        Some(packaged)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn length_prefix_matches_chrome_framing() {
        let message = serde_json::json!({"cmd": 14});
        let bytes = serde_json::to_vec(&message).unwrap();
        let mut framed = (bytes.len() as u32).to_le_bytes().to_vec();
        framed.extend_from_slice(&bytes);
        assert!(framed.len() < MAX_MESSAGE);
        assert_eq!(u32::from_le_bytes(framed[..4].try_into().unwrap()) as usize, bytes.len());
        let parsed: Value = serde_json::from_slice(&framed[4..]).unwrap();
        assert_eq!(parsed["cmd"], 14);
    }
}
