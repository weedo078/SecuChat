# Architecture Overview

SecuChat is a browser-based PWA (Progressive Web App). All application logic runs client-side. There is no backend server.

## High-Level Stack

```
┌─────────────────────────────────────────────────────┐
│                   Browser (PWA)                     │
│                                                     │
│  React UI ──► AppContext (global state)             │
│                    │                                │
│                    ▼                                │
│  cryptoService   storageService   i2pService        │
│  (PGP/OpenPGP)  (IndexedDB)      (high-level I2P)  │
│                                    │                │
│                                    ▼                │
│                               samService            │
│                           (SAM v3.1 client)         │
│                                    │                │
│                           WebSocket (port 7657)     │
└────────────────────────────────────┼────────────────┘
                                     │
                               sam-proxy
                           (Node.js WS↔TCP bridge)
                                     │
                              TCP (port 7656)
                                     │
                                  i2pd
                           (SAM API + I2P router)
                                     │
                              I2P network
```

## Component Responsibilities

### React UI (`app/src/`)

Built with React + TypeScript + Vite. Styling via Tailwind CSS and shadcn/ui components.

Key components:

| Component | File | Role |
|-----------|------|------|
| `Onboarding` | `components/custom/Onboarding.tsx` | First-run wizard: name, passphrase, key gen, I2P setup |
| `ChatView` | `components/custom/ChatView.tsx` | Message thread with I2P status indicator |
| `AddContactDialog` | `components/custom/AddContactDialog.tsx` | Contact import (file/manual), contact export |
| `Settings` | `components/custom/Settings.tsx` | App settings including I2P config and SAM test |
| `Header` | `components/custom/Header.tsx` | Connection status dot (green/yellow/red) |

### AppContext (`contexts/AppContext.tsx`)

Single global state provider. All components consume it via the `useApp()` hook. Owns:

- User, contacts, chats, messages state
- `connectionState` (derived from `i2pStatus`)
- App initialization sequence
- Auth: lock/unlock, passphrase lifecycle

See [State Management](State-Management) for details.

### Service Layer

Five singleton services handle all business logic. See [Services Overview](Services-Overview).

### sam-proxy (`sam-proxy/proxy.mjs`)

A minimal Node.js process that bridges WebSocket (browser side) to TCP (i2pd SAM side). It is stateless — it simply forwards bytes in both directions. Must run alongside i2pd.

## App Startup Sequence

`initialize()` in `AppContext.tsx` runs on mount:

1. `storageService.init()` — opens IndexedDB (or localStorage fallback)
2. Load user, contacts, chats, settings from storage
3. Check if private keys are encrypted (need unlock) or plaintext (load directly)
4. `cryptoService.importKeyPair()` — load PGP keys into memory
5. `i2pService.restoreIdentity()` — load Ed25519 keypair from storage
6. `i2pService.initialize()` — connect to SAM proxy (fire-and-forget; UI updates via status callbacks)

I2P connection is non-blocking. The UI is fully usable while I2P connects in the background.

## Path Alias

`@` resolves to `app/src/` (configured in `vite.config.ts`).

```ts
import { storageService } from '@/services/storage';
```

## Storage

IndexedDB database: `SecureChatDB` (version 2)

Object stores: `user`, `contacts`, `chats`, `messages`, `settings`, `devices`

See [Services Overview](Services-Overview) for the full schema.
