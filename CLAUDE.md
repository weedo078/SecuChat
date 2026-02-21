# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SecuChat is a privacy-focused web messaging app with end-to-end PGP encryption and I2P network routing for anonymity. It is a browser-based PWA. All active development is in `app/`. The `securechat-desktop/` folder is abandoned.

## Commands

All commands run from `app/`:

```bash
npm run dev       # Dev server (Vite)
npm run build     # Type-check + production build (output: app/dist/)
npm run lint      # ESLint
npm run preview   # Serve the built dist/
npx tsc --noEmit  # Type-check only
```

SAM proxy (required for I2P connectivity in the browser):

```bash
cd sam-proxy && npm start   # WebSocket proxy on port 7657 → SAM TCP 7656
```

## Architecture

### I2P Network Stack (Critical)

The browser cannot do raw TCP, so a WebSocket proxy bridges the gap:

```
Browser (WebSocket:7657) → sam-proxy → i2pd SAM (TCP:7656)
```

- `sam-proxy/proxy.mjs` — Node.js WebSocket-to-TCP bridge. Must run alongside i2pd.
- `samService` (`services/i2pSam.ts`) — SAM v3.1 protocol: HELLO handshake, DEST GENERATE, SESSION CREATE, STREAM CONNECT/ACCEPT. b32 addresses computed via SHA-256 + Base32.
- `i2pService` (`services/i2p.ts`) — High-level: Ed25519 identity, peer management, message routing. Sits on top of `samService`.

Default ports: SAM proxy **7657**, i2pd SAM **7656**.

### State Management

`AppContext.tsx` is the single global state provider. All components use the `useApp()` hook. The `connectionState` is derived from `i2pStatus` via a `useEffect`.

App startup sequence in `initialize()`:
1. `storageService.init()` → opens IndexedDB
2. Load user, contacts, chats, settings from storage
3. `cryptoService.importKeyPair()` → load PGP keys
4. `i2pService.restoreIdentity()` + `i2pService.initialize()` → connect to I2P

### Service Layer (singletons)

| Service | File | Responsibility |
|---------|------|----------------|
| `cryptoService` | `services/crypto.ts` | PGP via OpenPGP.js (ECC curve25519Legacy) |
| `storageService` | `services/storage.ts` | IndexedDB; stores: `user`, `contacts`, `chats`, `messages`, `settings`, `devices` |
| `i2pService` | `services/i2p.ts` | High-level I2P: identity, peers, send/receive |
| `samService` | `services/i2pSam.ts` | SAM v3.1 protocol client (via WebSocket proxy) |
| `platformService` | `services/platform.ts` | Platform detection + i2pd install instructions |

Legacy services (`webrtc.ts`, `qrSignaling.ts`) are not imported anywhere.

### Contact Exchange

Two formats:
- **QR code** (compact, v2): `{v:"2", t:"sc", n:name, i:i2pAddress, f:fingerprint}` — no PGP key (too large for QR, max ~2.9KB)
- **File export** (full): same fields plus `k:pgpPublicKey` — used for clipboard copy, file download, and contact file import

Both formats are parsed by `parseContactData()` in `AddContactDialog.tsx`. Legacy v1 format (`{version:"1.0", type:"securechat-contact", ...}`) is auto-converted.

### Path Alias

`@` resolves to `src/` (configured in `vite.config.ts`).

### UI Components

`src/components/ui/` — shadcn/ui primitives (regenerate via `npx shadcn@latest add <component>`).

`src/components/custom/` — app-specific:
- `Onboarding.tsx` — first-run: name + passphrase → PGP + I2P key generation. I2P setup optional (can be done later in Settings)
- `ChatView.tsx` — chat with I2P status indicator, message encryption
- `AddContactDialog.tsx` — QR scan, file import, manual I2P address entry
- `Settings.tsx` — includes I2P config dialog (SAM host/port/test)
- `Header.tsx` — I2P connection status (green/yellow/red dot)

### I2P Setup for Testing

```bash
# 1. Start i2pd with SAM enabled
i2pd --sam.enabled=true --sam.address=127.0.0.1 --sam.port=7656

# 2. Start the WebSocket proxy
cd sam-proxy && npm start

# 3. Start the app
cd app && npm run dev

# 4. In Settings → I2P: enable SAM, host 127.0.0.1, port 7657, test connection
```
