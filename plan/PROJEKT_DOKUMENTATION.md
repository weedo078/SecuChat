# SecureChat - Project Documentation

## Overview

SecureChat is a secure messaging web app with end-to-end encryption that works without central servers. The app was migrated from the Android app into a modern web application based on the technical specification.

**Live Demo:** https://psdt3z7ayegn6.ok.kimi.link

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Frontend Framework | React 19 + TypeScript |
| Build Tool | Vite 7 |
| Styling | Tailwind CSS 3.4 |
| UI Components | shadcn/ui (40+ components) |
| Cryptography | OpenPGP.js |
| P2P Communication | WebRTC |
| Local Storage | IndexedDB |
| QR Codes | qrcode + jsQR |

---

## Project Structure

```
/mnt/okcomputer/output/app/
├── src/
│   ├── components/
│   │   ├── ui/                    # shadcn/ui components
│   │   └── custom/                # Custom components
│   │       ├── Header.tsx         # App header with status
│   │       ├── Sidebar.tsx        # Chat list & navigation
│   │       ├── ChatView.tsx       # Chat interface
│   │       ├── ContactManager.tsx # Contact management
│   │       ├── QRCodeShare.tsx    # QR code share/scan
│   │       ├── Settings.tsx       # Settings
│   │       └── Onboarding.tsx     # First-time setup
│   ├── contexts/
│   │   └── AppContext.tsx         # Global state management
│   ├── services/
│   │   ├── crypto.ts              # PGP cryptography (OpenPGP.js)
│   │   ├── storage.ts             # IndexedDB wrapper
│   │   └── webrtc.ts              # WebRTC P2P communication
│   ├── types/
│   │   └── index.ts               # TypeScript type definitions
│   ├── App.tsx                    # Main app component
│   ├── main.tsx                   # Entry point
│   └── index.css                  # Global styles
├── public/                        # Static assets
├── dist/                          # Build output
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

---

## Core Features

### 1. PGP Encryption (OpenPGP.js)

**File:** `src/services/crypto.ts`

- RSA-4096 key generation
- End-to-end encryption of all messages
- Digital signatures
- Key validation
- Import/export of connection files

```typescript
// Key generation
const keys = await cryptoService.generateKeyPair(username, passphrase);

// Encrypt message
const encrypted = await cryptoService.encryptMessage(message, recipientPublicKey);

// Decrypt message
const decrypted = await cryptoService.decryptMessage(encryptedMessage, passphrase);
```

### 2. WebRTC P2P Communication

**File:** `src/services/webrtc.ts`

- Direct peer-to-peer connections
- DataChannels for message transmission
- ICE candidates for NAT traversal
- Connection status monitoring
- Signaling via WebSocket (extensible for I2P)

### 3. Local Data Storage (IndexedDB)

**File:** `src/services/storage.ts`

- Encrypted storage of all data
- Stores: user, contacts, chats, messages, settings
- Backup & restore functionality
- Complete data deletion possible

### 4. UI/UX Components

| Component | Function |
|-----------|----------|
| Header | Connection status, encryption status, user menu |
| Sidebar | Chat list, contact search, quick actions |
| ChatView | Message display, input, status indicators |
| ContactManager | Add/remove/manage contacts |
| QRCodeShare | Contact exchange via QR code |
| Settings | App settings, security, backup |
| Onboarding | First-time setup with key generation |

---

## Data Structures

### User
```typescript
interface User {
  id: string;
  username: string;
  deviceId: string;
  pgpPublicKey: string;
  pgpPrivateKey?: string;
  fingerprint: string;
  createdAt: string;
}
```

### Contact
```typescript
interface Contact {
  id: string;
  name: string;
  pgpPublicKey: string;
  fingerprint: string;
  p2pIdentifier: string;
  lastSeen?: string;
  status: 'online' | 'offline' | 'unknown';
}
```

### Message
```typescript
interface Message {
  id: string;
  chatId: string;
  senderId: string;
  recipientId: string;
  encryptedContent: string;
  decryptedContent?: string;
  timestamp: string;
  sequenceNumber: number;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  type: 'text' | 'file' | 'system';
}
```

### Connection File (contact exchange)
```json
{
  "version": "1.0",
  "metadata": {
    "timestamp": "ISO-8601-timestamp",
    "username": "username",
    "deviceId": "unique-device-identifier"
  },
  "keys": {
    "pgpPublicKey": "ASCII-armored-pgp-public-key",
    "fingerprint": "pgp-key-fingerprint"
  },
  "network": {
    "p2pIdentifier": "permanent-p2p-network-id",
    "protocol": "webrtc"
  }
}
```

---

## Security Features

### Implemented

| Feature | Status | Description |
|---------|--------|-------------|
| PGP Encryption | ✅ | RSA-4096, end-to-end |
| Local key storage | ✅ | Passphrase-protected |
| App lock | ✅ | Passphrase unlock |
| Screenshot protection | ✅ | UI indicator (browser limitation) |
| Auto-lock | ✅ | Configurable timeout |
| Duress PIN | ✅ | Emergency deletion |
| Backup encryption | ✅ | PGP-encrypted backups |
| Key export/import | ✅ | JSON format |
| Complete data deletion | ✅ | With confirmation |

### Planned (future)

| Feature | Status | Description |
|---------|--------|-------------|
| Biometric authentication | 🔄 | WebAuthn API |
| I2P integration | 🔄 | Anonymous routing |
| Forward secrecy | 🔄 | Ephemeral keys |
| Message self-destruct | 🔄 | Time-based deletion |

---

## Development phases

### Phase 1: Basics (implemented)
- ✅ PGP encryption with OpenPGP.js
- ✅ Basic UI with shadcn/ui
- ✅ Local data storage (IndexedDB)
- ✅ Contact management
- ✅ Chat interface

### Phase 2: Extended features (implemented)
- ✅ WebRTC integration
- ✅ QR code contact exchange
- ✅ Backup system
- ✅ Security settings
- ✅ Error handling

### Phase 3: Optimization (planned)
- 🔄 I2P integration for anonymous routing
- 🔄 Performance optimization
- 🔄 Mobile responsiveness
- 🔄 Push notifications
- 🔄 File transfer

---

## Installation & Development

### Prerequisites
- Node.js 20+
- npm or yarn

### Installation
```bash
cd /mnt/okcomputer/output/app
npm install
```

### Development server
```bash
npm run dev
```

### Build
```bash
npm run build
```

### Build output
```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js
│   └── index-[hash].css
```

---

## Deployment

The app was deployed on a static web server:

```bash
# Create build
npm run build

# Deploy (via tool)
# Output: /mnt/okcomputer/output/app/dist
```

**Live URL:** https://psdt3z7ayegn6.ok.kimi.link

---

## Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome/Edge | ✅ Full | All features |
| Firefox | ✅ Full | All features |
| Safari | ⚠️ Partial | WebRTC limitations |
| Mobile Chrome | ✅ Full | Touch-optimized |
| Mobile Safari | ⚠️ Partial | Camera access limited |

---

## Known limitations

1. **WebRTC signaling**: Currently via WebSocket, I2P integration planned
2. **Push notifications**: Not implemented (requires service worker)
3. **File transfer**: Not implemented
4. **Voice/video calls**: UI present, functionality planned
5. **Screenshot protection**: Only visual indicator, technical protection not possible

---

## Architecture decisions

### Why React + TypeScript?
- Type safety for cryptographic operations
- Large ecosystem for UI components
- Good performance with Vite

### Why OpenPGP.js?
- Industry standard for PGP encryption
- Well maintained and documented
| Supports RSA-4096

### Why IndexedDB?
- Native browser support
- Asynchronous API
- Large storage capacity
- Transaction-safe

### Why WebRTC?
- Direct P2P connections
- Built-in DTLS encryption
- Low latency

---

## License

This project was created as a demo implementation.

---

## Author

Developed based on the technical specification for a secure chat application.
