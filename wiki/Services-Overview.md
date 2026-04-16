# Services Overview

All business logic lives in singleton services under `app/src/services/`. They are plain TypeScript classes, independent of React. Organized by category below.

## Core Services

| Service | File | Responsibility |
|---------|------|---------------|
| `cryptoService` | `services/crypto.ts` | PGP key generation, encrypt/decrypt/sign/verify (OpenPGP.js, ECC curve25519Legacy) |
| `storageService` | `services/storage.ts` | Storage facade — delegates to platform-specific provider (IndexedDB / SQLite / Capacitor) |
| `platformService` | `services/platform.ts` | Platform detection (browser/Android/Electron) + i2pd install instructions |
| `theme` | `services/theme.ts` | Dark/light mode management, synced with Android status bar |

### cryptoService

Key methods:

```ts
generateKeyPair(username, passphrase)          // → { publicKey, privateKey, fingerprint }
importKeyPair(privateKey, publicKey, passphrase) // loads keys into memory
encryptMessage(message, recipientPublicKey)    // → armored PGP ciphertext
decryptMessage(encryptedMessage)               // → plaintext
signMessage(message, passphrase)               // → armored signed message
verifySignature(signedMessage, senderPublicKey) // → { valid, data }
validatePublicKey(armoredKey)                  // → { valid, fingerprint? }
```

Messages are encrypted for **both** recipient and sender (dual encryption). The decrypted private key is held in memory; `clearKeyPair()` (on lock) wipes it.

### storageService

Wraps platform-specific providers via the `StorageProvider` interface. See [Architecture Overview](Architecture-Overview) for the storage layer details.

Key methods:

```ts
storageService.init()                        // detect platform, init appropriate provider
storageService.saveUser(user)                // upsert user
storageService.getUser()                     // → User | null
storageService.getAllContacts()              // → Contact[]
storageService.getMessagesByChatId(chatId)  // → Message[]
storageService.createBackup()               // → BackupData (no plaintext)
storageService.restoreBackup(backup)        // clears + restores
```

### platformService

Detects runtime environment and returns platform-specific setup instructions.

| Platform | Detection | I2P support |
|----------|-----------|------------|
| `desktop` (Electron) | `electronAPI` global | `native` (bundled i2pd) |
| `android` | `Android` in user-agent | `native` (install i2pd from F-Droid) |
| `desktop` (browser) | Desktop OS, non-mobile | `external-required` |
| `other` | iOS, etc. | `unsupported` |

## Communication Services

| Service | File | Responsibility |
|---------|------|---------------|
| `i2pService` | `services/i2p.ts` | High-level I2P: identity, peers, send/receive, incoming streams |
| `samService` | `services/i2pSam.ts` | SAM v3.1 protocol client over WebSocket |
| `samNative` | `services/samNative.ts` | Native SAM plugin for Android (direct TCP to i2pd, bypasses WebSocket proxy) |
| `fileTransfer` | `services/fileTransfer.ts` | P2P encrypted file transfer over I2P. 1MB chunks, AES-256, 500MB max, thumbnails, resume |
| `voiceMessages` | `services/voiceMessages.ts` | Voice recording via MediaRecorder API (Opus), waveform, playback with scrubbing |
| `statusMessages` | `services/statusMessages.ts` | Read receipts (read/delivered) and typing indicators over I2P |
| `groupChat` | `services/groupChat.ts` | Mesh-based group chat (max 10 members), fan-out delivery, admin functions |
| `groupKeyExchange` | `services/groupKeyExchange.ts` | X25519 ECDH key exchange for group invite/key rotation |

### i2pService

High-level I2P API. Depends on `samService` (browser/Electron) or `samNative` (Android).

Key methods:

```ts
i2pService.initialize(config)                   // connect to SAM, create session
i2pService.generateIdentity()                   // new Ed25519 + SAM destination
i2pService.connectToPeer(b32Address)            // STREAM CONNECT
i2pService.sendMessage(to, message)             // JSON over stream
i2pService.sendFile(to, file)                   // chunked file transfer
i2pService.onMessage(handler)                   // subscribe to incoming messages
i2pService.onStatusChange(handler)              // subscribe to I2PStatus changes
i2pService.startAcceptLoop()                    // start accepting incoming I2P streams
i2pService.getAddress()                         // → current b32 address
```

### fileTransfer

```ts
fileTransfer.send(peer, file)                   // encrypted P2P file transfer
fileTransfer.onProgress(handler)                // transfer progress tracking
fileTransfer.accept(transferId)                 // accept incoming transfer
fileTransfer.reject(transferId)                 // reject incoming transfer
```

### groupChat / groupKeyExchange

Group chat uses a symmetric AES-256 group key shared among members. X25519 ECDH for secure key exchange during invites and key rotation. Max 10 members per group.

## Platform Services

| Service | File | Responsibility |
|---------|------|---------------|
| `backgroundService` | `services/backgroundService.ts` | Android foreground service — keeps I2P alive when app is backgrounded |
| `capacitorApp` | `services/capacitorApp.ts` | Capacitor App lifecycle management |
| `nativeFileSharing` | `services/nativeFileSharing.ts` | Native file sharing via Capacitor Share/FileOpener plugins |
| `nativeStorage` | `services/nativeStorage.ts` | Capacitor Preferences + Filesystem for native storage |
| `powerManagement` | `services/powerManagement.ts` | Android Doze mode and wake lock handling |
| `notificationService` | `services/notificationService.ts` | Local push notifications via @capacitor/local-notifications (no FCM/GCM) |

### notificationService

All notifications are generated locally — no cloud messaging service (FCM/GCM). Privacy-focused by design.

```ts
notificationService.init()                      // request permissions, register channels
notificationService.schedule(notification)      // schedule a local notification
notificationService.cancel(id)                  // cancel a notification
```

## Security Services

| Service | File | Responsibility |
|---------|------|---------------|
| `backup` | `services/backup.ts` | Age-encrypted backups (v3.0-age format). Two-file system: backup file + separate key file |
| `contactVerification` | `services/contactVerification.ts` | Safety numbers for out-of-band contact verification (QR + 6-word phrase) |

### backup

Uses the `age-encryption` library. Exports produce two files: the encrypted backup and a separate decryption key. Version `3.0-age`.

```ts
backup.createBackup(passphrase)                 // → { backupFile, keyFile }
backup.restoreBackup(backupFile, keyFile, passphrase) // restore from backup
```

### contactVerification

Generates safety numbers from PGP fingerprints for out-of-band verification:

```ts
contactVerification.generateSafetyNumber(fingerprint, peerFingerprint)  // → SafetyNumber
contactVerification.getVerificationPhrase(safetyNumber)  // → 6-word human-readable phrase
contactVerification.generateQRCode(safetyNumber)         // → QR code data
```

## Key Files

| File | Description |
|------|-------------|
| `app/src/services/storage/` | Storage abstraction with `browser/`, `capacitor/`, `electron/` subdirectories |
| `app/src/services/storage/index.ts` | Re-exports all storage types and providers |
| `app/src/services/storage/types.ts` | `StorageProvider` interface, `StoragePlatform` type, IPC channels |
