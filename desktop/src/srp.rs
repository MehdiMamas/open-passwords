//! Port of `src/apple/srp.js` and the byte helpers in `src/apple/crypto.js`.
//! Apple's "HAMK" is SHA-256(A || M || K), not an HMAC.

use aes::Aes128;
use aes_gcm::aead::generic_array::GenericArray;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::AesGcm;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use num_bigint::BigUint;
use sha2::{Digest, Sha256};
use typenum::U16;
use zeroize::Zeroize;

const GROUP_PRIME_HEX: &str = "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CBBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF";
const GROUP_PRIME_BYTES: usize = 384;

pub const SRP_WITH_RFC_VERIFICATION: i64 = 1;
pub const MSG_CLIENT_KEY_EXCHANGE: i64 = 0;
pub const MSG_SERVER_KEY_EXCHANGE: i64 = 1;
pub const MSG_CLIENT_VERIFICATION: i64 = 2;
pub const MSG_SERVER_VERIFICATION: i64 = 3;

type Aes128Gcm16 = AesGcm<Aes128, U16>;

fn group_prime() -> BigUint {
    BigUint::parse_bytes(GROUP_PRIME_HEX.as_bytes(), 16).expect("SRP prime")
}

fn generator() -> BigUint {
    BigUint::from(5u8)
}

pub fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    hasher.finalize().into()
}

pub fn random_bytes(count: usize) -> Result<Vec<u8>, String> {
    let mut out = vec![0u8; count];
    getrandom::getrandom(&mut out).map_err(|e| format!("rng: {e}"))?;
    Ok(out)
}

pub fn bigint_to_bytes(n: &BigUint) -> Vec<u8> {
    if n == &BigUint::from(0u8) {
        return vec![0];
    }
    n.to_bytes_be()
}

pub fn bytes_to_bigint(bytes: &[u8]) -> BigUint {
    BigUint::from_bytes_be(bytes)
}

pub fn pad_bytes(bytes: &[u8], length: usize) -> Vec<u8> {
    if bytes.len() >= length {
        return bytes[bytes.len() - length..].to_vec();
    }
    let mut out = vec![0u8; length];
    out[length - bytes.len()..].copy_from_slice(bytes);
    out
}

pub fn bytes_to_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        s.push(HEX[(byte >> 4) as usize] as char);
        s.push(HEX[(byte & 0xf) as usize] as char);
    }
    s
}

pub fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, String> {
    let hex = hex.trim().trim_start_matches("0x");
    let hex = if hex.len() % 2 == 1 {
        format!("0{hex}")
    } else {
        hex.to_string()
    };
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("invalid hex".into());
    }
    let mut out = Vec::with_capacity(hex.len() / 2);
    let bytes = hex.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let hi = (bytes[i] as char).to_digit(16).unwrap();
        let lo = (bytes[i + 1] as char).to_digit(16).unwrap();
        out.push(((hi << 4) | lo) as u8);
        i += 2;
    }
    Ok(out)
}

fn sub_mod(a: &BigUint, b: &BigUint, n: &BigUint) -> BigUint {
    let b = b % n;
    let a = a % n;
    if a >= b {
        a - b
    } else {
        n - (b - a)
    }
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

pub struct SrpSession {
    should_use_base64: bool,
    pub username: String,
    client_private: BigUint,
    server_public: Option<BigUint>,
    salt: Option<Vec<u8>>,
    shared_key: Option<BigUint>,
}

impl SrpSession {
    pub fn new(should_use_base64: bool) -> Result<Self, String> {
        let username_bytes = random_bytes(16)?;
        let private_bytes = random_bytes(32)?;
        Ok(Self::from_parts(should_use_base64, username_bytes, private_bytes))
    }

    pub fn from_parts(should_use_base64: bool, username_bytes: Vec<u8>, private_bytes: Vec<u8>) -> Self {
        let username = Self::encode(should_use_base64, &username_bytes, true);
        Self {
            should_use_base64,
            username,
            client_private: bytes_to_bigint(&private_bytes),
            server_public: None,
            salt: None,
            shared_key: None,
        }
    }

    fn encode(should_use_base64: bool, bytes: &[u8], prefix: bool) -> String {
        if should_use_base64 {
            B64.encode(bytes)
        } else if prefix {
            format!("0x{}", bytes_to_hex(bytes))
        } else {
            bytes_to_hex(bytes)
        }
    }

    pub fn serialize(&self, bytes: &[u8], prefix: bool) -> String {
        Self::encode(self.should_use_base64, bytes, prefix)
    }

    pub fn deserialize(&self, value: &str) -> Result<Vec<u8>, String> {
        if self.should_use_base64 {
            B64.decode(value).map_err(|e| format!("base64: {e}"))
        } else {
            hex_to_bytes(value)
        }
    }

    pub fn has_server(&self) -> bool {
        self.server_public.is_some() && self.salt.is_some()
    }

    pub fn clear_challenge(&mut self) {
        self.server_public = None;
        self.salt = None;
        self.shared_key = None;
    }

    pub fn client_public_key_bytes(&self) -> Vec<u8> {
        let n = group_prime();
        bigint_to_bytes(&generator().modpow(&self.client_private, &n))
    }

    pub fn set_server_public_key(&mut self, server_public: BigUint, salt: Vec<u8>) -> Result<(), String> {
        let n = group_prime();
        if server_public == BigUint::from(0u8) || server_public >= n || (&server_public % &n) == BigUint::from(0u8) {
            return Err("invalid server public key".into());
        }
        if salt.is_empty() {
            return Err("invalid salt".into());
        }
        self.server_public = Some(server_public);
        self.salt = Some(salt);
        Ok(())
    }

    pub fn set_shared_key(&mut self, pin: &str) -> Result<(), String> {
        let n = group_prime();
        let server_public = self.server_public.as_ref().ok_or("missing server public key")?;
        let salt = self.salt.as_ref().ok_or("missing salt")?;
        let a = self.client_public_key_bytes();
        let b = bigint_to_bytes(server_public);
        let u = bytes_to_bigint(&sha256(&[&pad_bytes(&a, GROUP_PRIME_BYTES), &pad_bytes(&b, GROUP_PRIME_BYTES)]));
        if u == BigUint::from(0u8) {
            return Err("invalid SRP parameter: u == 0".into());
        }
        let k = bytes_to_bigint(&sha256(&[
            &bigint_to_bytes(&n),
            &pad_bytes(&bigint_to_bytes(&generator()), GROUP_PRIME_BYTES),
        ]));
        let identity = format!("{}:{pin}", self.username);
        let inner = sha256(&[identity.as_bytes()]);
        let x = bytes_to_bigint(&sha256(&[salt, &inner]));
        let gx = generator().modpow(&x, &n);
        let base = sub_mod(server_public, &((&k * &gx) % &n), &n);
        let exp = &self.client_private + &u * &x;
        let s = base.modpow(&exp, &n);
        self.shared_key = Some(bytes_to_bigint(&sha256(&[&bigint_to_bytes(&s)])));
        Ok(())
    }

    fn shared_key_bytes(&self) -> Result<Vec<u8>, String> {
        let key = self.shared_key.as_ref().ok_or("missing shared key")?;
        Ok(pad_bytes(&bigint_to_bytes(key), 32))
    }

    pub fn compute_m(&self) -> Result<Vec<u8>, String> {
        let n = group_prime();
        let server_public = self.server_public.as_ref().ok_or("missing server public key")?;
        let salt = self.salt.as_ref().ok_or("missing salt")?;
        let hn = sha256(&[&bigint_to_bytes(&n)]);
        let hg = sha256(&[&pad_bytes(&bigint_to_bytes(&generator()), GROUP_PRIME_BYTES)]);
        let mut xored = [0u8; 32];
        for i in 0..32 {
            xored[i] = hn[i] ^ hg[i];
        }
        let hi = sha256(&[self.username.as_bytes()]);
        let k = self.shared_key_bytes()?;
        Ok(sha256(&[
            &xored,
            &hi,
            salt,
            &self.client_public_key_bytes(),
            &bigint_to_bytes(server_public),
            &k,
        ])
        .to_vec())
    }

    pub fn compute_hamk(&self, m: &[u8]) -> Result<Vec<u8>, String> {
        let k = self.shared_key_bytes()?;
        Ok(sha256(&[&self.client_public_key_bytes(), m, &k]).to_vec())
    }

    pub fn hamk_matches(&self, m: &[u8], remote: &[u8]) -> Result<bool, String> {
        Ok(ct_eq(&self.compute_hamk(m)?, remote))
    }

    fn aes_key(&self) -> Result<[u8; 16], String> {
        let padded = self.shared_key_bytes()?;
        let mut key = [0u8; 16];
        key.copy_from_slice(&padded[..16]);
        Ok(key)
    }

    /// ciphertext+tag || iv. Inbound frames are the other way around.
    pub fn encrypt(&self, obj: &serde_json::Value) -> Result<Vec<u8>, String> {
        let mut key = self.aes_key()?;
        let mut iv = random_bytes(16)?;
        let cipher = Aes128Gcm16::new(GenericArray::from_slice(&key));
        let plaintext = serde_json::to_vec(obj).map_err(|e| e.to_string())?;
        let ct = cipher
            .encrypt(GenericArray::from_slice(&iv), plaintext.as_ref())
            .map_err(|_| "encrypt failed".to_string())?;
        let mut out = ct;
        out.append(&mut iv);
        key.zeroize();
        Ok(out)
    }

    /// Inbound layout is iv || ciphertext+tag, the reverse of `encrypt`.
    pub fn decrypt(&self, bytes: &[u8]) -> Result<Vec<u8>, String> {
        if bytes.len() < 16 {
            return Err("ciphertext too short".into());
        }
        let key = self.aes_key()?;
        let (iv, ct) = bytes.split_at(16);
        let cipher = Aes128Gcm16::new(GenericArray::from_slice(&key));
        let pt = cipher
            .decrypt(GenericArray::from_slice(iv), ct)
            .map_err(|_| "decrypt failed".to_string())?;
        let mut key = key;
        key.zeroize();
        Ok(pt)
    }
}

impl Drop for SrpSession {
    fn drop(&mut self) {
        if let Some(salt) = self.salt.as_mut() {
            salt.zeroize();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Server {
        pin: String,
        salt: Vec<u8>,
        username: String,
        a: BigUint,
        b: BigUint,
        big_b: BigUint,
    }

    impl Server {
        fn start(pin: &str, salt: Vec<u8>, username: &str, a_bytes: &[u8], b_private: &[u8]) -> Self {
            let n = group_prime();
            let inner = sha256(&[format!("{username}:{pin}").as_bytes()]);
            let x = bytes_to_bigint(&sha256(&[&salt, &inner]));
            let v = generator().modpow(&x, &n);
            let b = bytes_to_bigint(b_private);
            let k = bytes_to_bigint(&sha256(&[
                &bigint_to_bytes(&n),
                &pad_bytes(&bigint_to_bytes(&generator()), GROUP_PRIME_BYTES),
            ]));
            let big_b = (&((&k * &v) % &n) + &generator().modpow(&b, &n)) % &n;
            Self {
                pin: pin.to_string(),
                salt,
                username: username.to_string(),
                a: bytes_to_bigint(a_bytes),
                b,
                big_b,
            }
        }

        fn shared_key(&self) -> BigUint {
            let n = group_prime();
            let inner = sha256(&[format!("{}:{}", self.username, self.pin).as_bytes()]);
            let x = bytes_to_bigint(&sha256(&[&self.salt, &inner]));
            let v = generator().modpow(&x, &n);
            let u = bytes_to_bigint(&sha256(&[
                &pad_bytes(&bigint_to_bytes(&self.a), GROUP_PRIME_BYTES),
                &pad_bytes(&bigint_to_bytes(&self.big_b), GROUP_PRIME_BYTES),
            ]));
            let base = (&self.a * &v.modpow(&u, &n)) % &n;
            let s = base.modpow(&self.b, &n);
            bytes_to_bigint(&sha256(&[&bigint_to_bytes(&s)]))
        }

        fn expected_m(&self) -> Vec<u8> {
            let n = group_prime();
            let k = pad_bytes(&bigint_to_bytes(&self.shared_key()), 32);
            let hn = sha256(&[&bigint_to_bytes(&n)]);
            let hg = sha256(&[&pad_bytes(&bigint_to_bytes(&generator()), GROUP_PRIME_BYTES)]);
            let mut xored = [0u8; 32];
            for i in 0..32 {
                xored[i] = hn[i] ^ hg[i];
            }
            let hi = sha256(&[self.username.as_bytes()]);
            sha256(&[
                &xored,
                &hi,
                &self.salt,
                &bigint_to_bytes(&self.a),
                &bigint_to_bytes(&self.big_b),
                &k,
            ])
            .to_vec()
        }

        fn hamk(&self, m: &[u8]) -> Vec<u8> {
            let k = pad_bytes(&bigint_to_bytes(&self.shared_key()), 32);
            sha256(&[&bigint_to_bytes(&self.a), m, &k]).to_vec()
        }
    }

    fn fixed_client(salt: Vec<u8>, server_b: &[u8], pin: &str) -> (SrpSession, Server) {
        let username = vec![0x11u8; 16];
        let private = vec![0x22u8; 32];
        let mut client = SrpSession::from_parts(false, username.clone(), private);
        let a = client.client_public_key_bytes();
            let server = Server::start(pin, salt.clone(), &client.username, &a, server_b);
        client.set_server_public_key(server.big_b.clone(), salt).unwrap();
        client.set_shared_key(pin).unwrap();
        (client, server)
    }

    #[test]
    fn group_prime_is_3072_bits() {
        assert_eq!(GROUP_PRIME_HEX.len(), 768);
        assert_eq!(bigint_to_bytes(&group_prime()).len(), 384);
    }

    #[test]
    fn plain_salt_client_matches_server() {
        let salt = vec![0x7f, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        let (client, server) = fixed_client(salt, &[0x33u8; 32], "123456");
        let m = client.compute_m().unwrap();
        assert_eq!(m, server.expected_m());
        assert!(client.hamk_matches(&m, &server.hamk(&m)).unwrap());
    }

    #[test]
    fn leading_zero_salt_client_matches_server() {
        let mut salt = vec![0x00, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        salt[0] = 0x00;
        let (client, server) = fixed_client(salt, &[0x44u8; 32], "123456");
        let m = client.compute_m().unwrap();
        assert_eq!(m, server.expected_m());
        assert!(client.hamk_matches(&m, &server.hamk(&m)).unwrap());
    }

    #[test]
    fn leading_zero_shared_key_hashes_at_full_32_bytes() {
        let salt = vec![0x7f, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        let username = vec![0x11u8; 16];
        let mut client = SrpSession::from_parts(false, username, vec![0x22u8; 32]);
        client.set_server_public_key(BigUint::from(2u8), salt.clone()).unwrap();
        client.shared_key = Some(bytes_to_bigint(&[0x00, 0x11, 0x22]));
        let m = client.compute_m().unwrap();
        let n = group_prime();
        let hn = sha256(&[&bigint_to_bytes(&n)]);
        let hg = sha256(&[&pad_bytes(&bigint_to_bytes(&generator()), GROUP_PRIME_BYTES)]);
        let mut xored = [0u8; 32];
        for i in 0..32 {
            xored[i] = hn[i] ^ hg[i];
        }
        let k = pad_bytes(&bigint_to_bytes(&bytes_to_bigint(&[0x00, 0x11, 0x22])), 32);
        assert_eq!(k.len(), 32);
        assert_eq!(k[0], 0);
        assert_eq!(&k[30..], &[0x11, 0x22]);
        let expected = sha256(&[
            &xored,
            &sha256(&[client.username.as_bytes()]),
            &salt,
            &client.client_public_key_bytes(),
            &bigint_to_bytes(&BigUint::from(2u8)),
            &k,
        ]);
        assert_eq!(m, expected);
    }

    #[test]
    fn hex_prefix_and_aes_roundtrip() {
        let mut client = SrpSession::from_parts(false, vec![0x0a, 0x0b], vec![1]);
        assert_eq!(client.serialize(&[0x0a, 0x0b], true), "0x0a0b");
        assert_eq!(client.serialize(&[0x0a, 0x0b], false), "0a0b");
        assert_eq!(client.deserialize("0x0a0b").unwrap(), vec![0x0a, 0x0b]);
        client.shared_key = Some(bytes_to_bigint(&[0x05; 32]));
        let blob = client.encrypt(&serde_json::json!({"USR": "a"})).unwrap();
        let pt = client.decrypt(&blob_as_inbound(&blob)).unwrap();
        assert_eq!(pt, serde_json::to_vec(&serde_json::json!({"USR": "a"})).unwrap());
    }

    fn blob_as_inbound(outbound: &[u8]) -> Vec<u8> {
        let iv = &outbound[outbound.len() - 16..];
        let ct = &outbound[..outbound.len() - 16];
        let mut inbound = iv.to_vec();
        inbound.extend_from_slice(ct);
        inbound
    }
}
