# Security Model

This page describes what SecuChat protects, what it does not protect, and the assumptions the security model rests on.

## What SecuChat Protects

### End-to-end message encryption

Every message is encrypted with OpenPGP (ECC curve25519Legacy via OpenPGP.js) before leaving the app. Only the recipient's private key can decrypt it.

- Messages are encrypted for **both** recipient and sender, so you can read your own sent messages later
- Encrypted ciphertext is stored locally; plaintext (`decryptedContent`) is never persisted
- No server ever sees plaintext

### Private key protection at rest

Your PGP and I2P private keys are encrypted at rest using AES-256-GCM. The encryption key is derived from your passphrase via PBKDF2 (SHA-256, 100,000 iterations, random salt).

When the app locks, the private key is cleared from memory. An attacker with access to the stored data but not your passphrase cannot read your keys.

### Network-level anonymity (with I2P)

When I2P is active, all traffic is routed through the I2P network:

- Your IP address is hidden from your contacts
- Your contacts' IP addresses are hidden from you
- Traffic is layered-encrypted end-to-end within I2P (separate from PGP)
- No central relay server knows who is talking to whom
- Both **outbound** and **incoming** I2P streams are supported (via `startAcceptLoop`)

### Local-only storage

All data (messages, contacts, keys) is stored locally using the platform-appropriate storage provider (IndexedDB / SQLite / Capacitor Preferences). Nothing is synchronized to any cloud service.

---

## What SecuChat Does Not Protect

### Metadata (without I2P)

Without I2P, SecuChat falls back to direct connections. In this mode, both parties can see each other's IP addresses, and any observer on the network can see connection timing and volume (but not message content, which remains PGP-encrypted).

### Your passphrase

If an attacker can observe your keyboard or has malware on your device, they can capture your passphrase and decrypt your stored keys. SecuChat cannot protect against a compromised device.

### Browser security

SecuChat inherits the security boundary of its host platform (browser, Android, or Electron). A malicious browser extension, a compromised app binary, or an XSS attack could compromise the app.

### I2P is not a silver bullet

I2P provides strong anonymity but has known limitations:
- Traffic analysis attacks are theoretically possible against a global passive adversary
- I2P is a small network; anonymity sets may be limited compared to Tor for some threat models

### Contact verification

Adding a contact via file import does not prove the file came from the real person. Use the built-in **safety number verification** to confirm identities out-of-band. Safety numbers generate a QR code and a human-readable 6-word phrase derived from both PGP fingerprints — verify these through a trusted channel (in-person, voice call, etc.).

### Forward secrecy

The current implementation uses static ECC keys. There is no ephemeral key exchange (e.g., Signal-style double ratchet). A future attacker who obtains your private key can decrypt all recorded ciphertext.

---

## Trust Model

| Party | Can they read your messages? |
|-------|------------------------------|
| Contacts | Yes (intended) |
| I2P router operators | No — PGP-encrypted before leaving the app |
| Network observers | No — PGP + I2P layered encryption |
| sam-proxy process | No — it sees only encrypted bytes |
| Group members | Yes (symmetric group key, shared via X25519 ECDH) |
| Browser / OS | Yes, if compromised |
| Anyone with your passphrase | Yes |

---

## Group Chat Security

Group chats (max 10 members) use a symmetric AES-256 group key:

- **Key exchange:** X25519 ECDH between inviter and invitee during the invite flow
- **Key rotation:** New group key distributed when members join or leave
- **Delivery:** Fan-out — each member sends to all others via existing I2P streams
- **Admin controls:** Only the group admin can add/remove members and trigger key rotation

---

## Backup Security

Backups use **Age encryption** (v3.0-age format) via the `age-encryption` library. The backup system produces two separate files:

1. **Backup file** — encrypted backup data (keys, contacts, messages)
2. **Key file** — decryption key

Both files are needed to restore. Store the key file separately from the backup for better security.

---

## Cryptographic Primitives

| Purpose | Algorithm |
|---------|-----------|
| Message encryption | OpenPGP ECC curve25519Legacy |
| Key derivation | PBKDF2-SHA-256 (100,000 iterations) |
| Storage encryption | AES-256-GCM |
| Backup encryption | Age (age-encryption library, v3.0-age format) |
| Group key exchange | X25519 ECDH |
| Group message encryption | AES-256 (symmetric group key) |
| I2P identity | Ed25519 (TweetNaCl) |
| I2P address | SHA-256 of SAM destination → Base32 |
| SAM destination | EdDSA_SHA512_Ed25519 |
| Contact verification | Safety numbers from PGP fingerprints |
