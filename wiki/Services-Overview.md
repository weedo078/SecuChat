# Services Overview

All business logic lives in five singleton services under `app/src/services/`. They are plain TypeScript classes, independent of React.

## Service Map

| Service | File | Singleton export | Responsibility |
|---------|------|-----------------|---------------|
| `cryptoService` | `services/crypto.ts` | `cryptoService` | PGP key generation, encrypt/decrypt/sign/verify |
| `storageService` | `services/storage.ts` | `storageService` | IndexedDB (+ localStorage fallback) CRUD |
| `i2pService` | `services/i2p.ts` | `i2pService` | High-level I2P: identity, peers, send/receive |
| `samService` | `services/i2pSam.ts` | `samService` | SAM v3.1 protocol client over WebSocket |
| `platformService` | `services/platform.ts` | `platformService` | Platform detection + i2pd install instructions |

---

## cryptoService

`CryptoService` (singleton via `getInstance()`)

Uses **OpenPGP.js** with ECC curve25519Legacy keys.

### Key methods

```ts
generateKeyPair(username, passphrase)          // → { publicKey, privateKey, fingerprint }
importKeyPair(privateKey, publicKey, passphrase) // loads keys into memory
encryptMessage(message, recipientPublicKey)    // → armored PGP ciphertext
decryptMessage(encryptedMessage)               // → plaintext
signMessage(message, passphrase)               // → armored signed message
verifySignature(signedMessage, senderPublicKey) // → { valid, data }
validatePublicKey(armoredKey)                  // → { valid, fingerprint? }
```

Messages are encrypted for **both** recipient and sender (dual encryption) so the sender can read their own history.

The decrypted private key (`decryptedPrivateKey`) is held in memory. On `clearKeyPair()` (app lock), it is cleared.

---

## storageService

`StorageService` (singleton via `getInstance()`)

Wraps IndexedDB. Falls back to `localStorage` on `file://` protocol.

### Object stores (IndexedDB: `SecureChatDB` v2)

| Store | Key | Indexes | Content |
|-------|-----|---------|---------|
| `user` | `id` | — | Single user record |
| `contacts` | `id` | `fingerprint` (unique) | Contact list |
| `chats` | `id` | `contactId` | Chat threads |
| `messages` | `id` | `chatId`, `timestamp`, `sequenceNumber` | Encrypted messages |
| `settings` | `key` | — | App + security settings |
| `devices` | `deviceId` | `i2pAddress` (unique) | Multi-device records |

### Sensitive data encryption

When `setEncryptionPassphrase(passphrase)` is called (on unlock), `saveUser()` / `getUser()` transparently encrypt/decrypt `pgpPrivateKey` and `i2pPrivateKey` using AES-256-GCM (key derived via PBKDF2).

`decryptedContent` is **never** persisted — it is stripped from messages before `saveMessage()`.

### Key methods

```ts
storageService.init()                        // open DB
storageService.saveUser(user)                // upsert user
storageService.getUser()                     // → User | null
storageService.getAllContacts()              // → Contact[]
storageService.getContactByFingerprint(fp)  // → Contact | null
storageService.getMessagesByChatId(chatId)  // → Message[]
storageService.createBackup()               // → BackupData (no plaintext)
storageService.restoreBackup(backup)        // clears + restores
```

---

## i2pService

`I2PService` (singleton instance)

High-level I2P API. Depends on `samService`.

See [I2P / SAM Stack](I2P-SAM-Stack) for the full protocol details.

### Key methods

```ts
i2pService.initialize(config)                   // connect to SAM, create session
i2pService.generateIdentity()                   // new Ed25519 + SAM destination
i2pService.restoreIdentity(pubB64, privB64, sam) // load from storage
i2pService.connectToPeer(b32Address)            // STREAM CONNECT
i2pService.sendMessage(to, message)             // JSON over stream (auto-connect)
i2pService.sendFile(to, file)                   // chunked file transfer (max 50 MB)
i2pService.onMessage(handler)                   // subscribe to incoming messages
i2pService.onStatusChange(handler)              // subscribe to I2PStatus changes
i2pService.getAddress()                         // → current b32 address
i2pService.exportIdentity()                     // → keys for backup
```

---

## samService

`SAMService` (singleton instance)

Low-level SAM v3.1 protocol. See [I2P / SAM Stack](I2P-SAM-Stack).

---

## platformService

`PlatformService` (singleton instance)

Detects the runtime environment and returns platform-specific I2P setup instructions.

### Platform types

| Type | Detection | I2P support |
|------|-----------|------------|
| `desktop` | Electron user-agent or `electronAPI` | `native` (bundled i2pd) |
| `android` | `Android` in user-agent | `native` (install i2pd from F-Droid) |
| `desktop` (browser) | Windows/Mac/Linux, non-mobile | `external-required` |
| `other` | iOS, tablets, etc. | `unsupported` |

### Key methods

```ts
platformService.getPlatformInfo()   // → PlatformInfo with instructions
platformService.isI2PSupported()    // → boolean
platformService.isPWA()             // → boolean (standalone display mode)
platformService.isElectron()        // → boolean
```

`PlatformInfo.instructions` contains localised step-by-step guidance shown during onboarding and in Settings.
