// iCloud for Windows speaks the same SRP session, with two encoding quirks:
// MSG (and sometimes ErrCode) arrive as strings, and SMSG arrives as a JSON string.

import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const results = [];
const ok = (name, cond, detail = "") => {
  results.push({ name, cond });
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : " -> " + detail}`);
};

const SRC = new URL("../../src/", import.meta.url);
const crypt = await import(new URL("crypto.js", SRC));
const { sha256, bigIntToBytes, bytesToBigInt, padBytes, utf8ToBytes, mod, powmod } = crypt;

const N = BigInt(
  "0x" +
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF",
);
const NB = 384;
const g = 5n;

class SrpServer {
  constructor({ pin, salt }) {
    this.pin = pin;
    this.salt = salt;
  }
  async start(username, A) {
    this.username = username;
    this.A = A;
    const innerHash = await sha256(utf8ToBytes(username + ":" + this.pin));
    const x = bytesToBigInt(await sha256(this.salt, innerHash));
    this.v = powmod(g, x, N);
    this.b = bytesToBigInt(crypt.randomBytes(32));
    const k = bytesToBigInt(await sha256(bigIntToBytes(N), padBytes(bigIntToBytes(g), NB)));
    this.B = mod(mod(k * this.v, N) + powmod(g, this.b, N), N);
    return { B: this.B, s: this.salt };
  }
  async sharedKey() {
    const u = bytesToBigInt(
      await sha256(padBytes(bigIntToBytes(this.A), NB), padBytes(bigIntToBytes(this.B), NB)),
    );
    const S = powmod(mod(this.A * powmod(this.v, u, N), N), this.b, N);
    return bytesToBigInt(await sha256(bigIntToBytes(S)));
  }
  async expectedM() {
    const K = await this.sharedKey();
    const hN = await sha256(bigIntToBytes(N));
    const hg = await sha256(padBytes(bigIntToBytes(g), NB));
    const xored = new Uint8Array(hN.length);
    for (let i = 0; i < hN.length; i++) xored[i] = hN[i] ^ hg[i];
    return sha256(
      xored,
      await sha256(utf8ToBytes(this.username)),
      this.salt,
      bigIntToBytes(this.A),
      bigIntToBytes(this.B),
      padBytes(bigIntToBytes(K), 32),
    );
  }
  async hamk(m) {
    const K = await this.sharedKey();
    return sha256(bigIntToBytes(this.A), m, padBytes(bigIntToBytes(K), 32));
  }
}

function makeWindowsHost({ pin, salt }) {
  const state = { server: null, live: false, username: "" };
  const port = {
    onMessage: { addListener: (fn) => port._listeners.push(fn) },
    onDisconnect: { addListener: () => {} },
    _listeners: [],
    disconnect() {},
    postMessage(msg) {
      setTimeout(() => void handle(msg), 0);
    },
  };
  const reply = (m) => port._listeners.forEach((fn) => fn(m));
  const b64 = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64");
  const unb64 = (s) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));
  const hex = (bytes) => "0x" + crypt.bytesToHex(bytes);
  const unhex = (s) => crypt.hexToBytes(String(s).replace(/^0x/, ""));

  async function encryptReply(obj) {
    const keyBytes = padBytes(bigIntToBytes(await state.server.sharedKey()), 32).slice(0, 16);
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
    const iv = crypt.randomBytes(16);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, utf8ToBytes(JSON.stringify(obj))),
    );
    return crypt.concatBytes(iv, ct);
  }

  async function handle(msg) {
    if (msg.cmd === 14) {
      return reply({
        cmd: 14,
        capabilities: {
          secretSessionVersion: 1,
          canFillOneTimeCodes: true,
          supportsSubURLs: true,
          scanForOTPURI: true,
        },
      });
    }
    if (msg.cmd === 4) {
      const blob = await encryptReply({
        STATUS: 0,
        Entries: [{ USR: "ada@example.com", sites: ["example.com"] }],
      });
      const smsg = JSON.stringify({ TID: state.username, SDATA: hex(blob) });
      return reply({ cmd: 4, payload: { SMSG: smsg } });
    }
    if (msg.cmd !== 2) return;
    const pake = unb64(msg.msg.PAKE);
    if (msg.msg.QID === "m0") {
      state.username = pake.TID;
      state.server = new SrpServer({ pin, salt });
      state.live = true;
      const { B, s } = await state.server.start(pake.TID, bytesToBigInt(unhex(pake.A)));
      return reply({
        cmd: 2,
        payload: {
          PAKE: b64({
            TID: pake.TID,
            MSG: "1",
            PROTO: 1,
            VER: "1.0",
            B: hex(bigIntToBytes(B)),
            s: hex(s),
          }),
        },
      });
    }
    if (!state.live) {
      return reply({ cmd: 2, payload: { PAKE: b64({ TID: pake.TID, MSG: "3", ErrCode: "1" }) } });
    }
    const expected = await state.server.expectedM();
    const got = unhex(pake.M);
    state.live = false;
    if (Buffer.compare(Buffer.from(expected), Buffer.from(got)) !== 0) {
      return reply({ cmd: 2, payload: { PAKE: b64({ TID: pake.TID, MSG: "3", ErrCode: "1" }) } });
    }
    const hamk = await state.server.hamk(got);
    return reply({
      cmd: 2,
      payload: { PAKE: b64({ TID: pake.TID, MSG: "3", ErrCode: "0", HAMK: hex(hamk) }) },
    });
  }

  globalThis.chrome = { runtime: { connectNative: () => port, lastError: undefined } };
  return state;
}

const salt = crypt.randomBytes(16);
if (salt[0] === 0) salt[0] = 0x7f;
makeWindowsHost({ pin: "123456", salt });
const { ApplePasswords } = await import(new URL(`protocol.js?windows=${Math.random()}`, SRC));
const client = new ApplePasswords();
await client.connect();
ok("windows capabilities omit the passwords-app sheet", client.canOpenPasswordsAppToNewPasswordSheet === false);
ok("windows capabilities include one-time codes", client.canFillOneTimeCodes === true);
ok("windows capabilities include totp setup", client.canSetUpTotp === true);

await client.requestChallenge();
let err = null;
await client.verifyPin("123456").catch((e) => (err = e));
ok("string MSG and string ErrCode still unlock", client.state === "unlocked" && !err, String(err?.message));

let names = null;
let listErr = null;
try {
  names = await client.getLoginNamesForURL(1, "https://example.com/login");
} catch (e) {
  listErr = e;
}
ok(
  "string SMSG still lists logins",
  names?.[0]?.username === "ada@example.com" && !listErr,
  listErr ? String(listErr.message) : JSON.stringify(names),
);

const failed = results.filter((r) => !r.cond).length;
if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
