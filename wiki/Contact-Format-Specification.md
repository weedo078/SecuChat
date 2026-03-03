# Contact Format Specification

SecuChat uses a JSON-based contact format for exchanging identity information between users. Two format versions exist.

## Current Format — v1.0

Used for file exports (`.secuchat` files) and clipboard sharing. Contains the full PGP public key.

```jsonc
{
  "version": "1.0",
  "metadata": {
    "timestamp": "2024-01-15T12:00:00.000Z",
    "username": "Alice",
    "deviceId": "uuid-v4"
  },
  "keys": {
    "pgpPublicKey": "-----BEGIN PGP PUBLIC KEY BLOCK-----\n...\n-----END PGP PUBLIC KEY BLOCK-----",
    "fingerprint": "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
  },
  "network": {
    "p2pIdentifier": "uuid-v4",
    "protocol": "i2p-webrtc",
    "i2pAddress": "xxxx...xxxx.b32.i2p"
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | `"1.0"` | yes | Format version |
| `metadata.timestamp` | ISO 8601 | yes | Export time |
| `metadata.username` | string | yes | Display name |
| `metadata.deviceId` | UUID | yes | Exporting device ID |
| `keys.pgpPublicKey` | string | yes | ASCII-armored OpenPGP public key |
| `keys.fingerprint` | string | yes | PGP fingerprint (uppercase hex) |
| `network.p2pIdentifier` | UUID | yes | User's internal ID |
| `network.protocol` | string | yes | `"i2p-webrtc"` if I2P address present, else `"webrtc"` |
| `network.i2pAddress` | string | yes | Full `.b32.i2p` address |

The file extension is `.secuchat`. The MIME type used for download is `application/json`.

---

## Legacy Format — v2 (compact)

The v2 format was designed for QR codes where size is constrained (max ~2.9 KB). It omits the PGP public key.

```jsonc
{
  "v": "2",
  "t": "sc",
  "n": "Alice",
  "i": "xxxx...xxxx.b32.i2p",
  "f": "ABCDEF0123456789ABCDEF0123456789ABCDEF01",
  "k": "-----BEGIN PGP PUBLIC KEY BLOCK-----\n...",   // optional
  "ts": 1705320000000
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `v` | `"2"` | yes | Version |
| `t` | `"sc"` | yes | Type identifier (SecuChat) |
| `n` | string | yes | Display name |
| `i` | string | yes | I2P address |
| `f` | string | yes | PGP fingerprint |
| `k` | string | no | PGP public key (omitted in QR codes) |
| `ts` | number | no | Unix timestamp (ms) |

---

## Legacy Format — v1 (historical)

An older file format with a different structure. Support may exist in the codebase for backwards compatibility but new exports never produce this format.

```jsonc
{
  "version": "1.0",
  "type": "securechat-contact",
  ...
}
```

---

## Parsing

`parseContactData()` in `AddContactDialog.tsx` handles all three formats:

1. Detects `version === "1.0"` + `metadata` + `keys` + `network` → v1.0
2. Detects `v === "2"` + `t === "sc"` → legacy v2, converts to v1.0 shape in memory
3. Anything else → parse error

v2 contacts without a PGP key (`k` field absent or empty) are saved but cannot send encrypted messages until the PGP key is exchanged separately.

---

## Validation

Before saving an imported contact, `cryptoService.validatePublicKey()` is called on the PGP key. An invalid or malformed key is rejected with an error.

The fingerprint field is stored as provided. Cross-checking the provided fingerprint against the parsed key fingerprint is left to the user (show the fingerprint in the UI and verify out-of-band).

---

## File Export

```ts
// AddContactDialog.tsx — exportContactFile()
const contactData = {
  version: '1.0',
  metadata: { timestamp, username, deviceId },
  keys: { pgpPublicKey, fingerprint },
  network: { p2pIdentifier, protocol, i2pAddress },
};
// → downloaded as <username>.secuchat
```

Export is blocked if `user.i2pSamDestination` is not set (i.e., the user has never connected to I2P). This prevents exporting an unusable address.
