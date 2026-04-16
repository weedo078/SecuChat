# Architecture Overview

SecuChat is a cross-platform app running on **Browser (PWA)**, **Android (Capacitor)**, and **Desktop (Electron)**. All application logic runs client-side. There is no backend server.

## High-Level Stack

```
┌──────────────────────────────────────────────────────────────────┐
│                        React UI                                  │
│        AppContext (global state) · i18n (de/en)                 │
│                              │                                   │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│  Browser (PWA)      Android (Capacitor)   Desktop (Electron)   │
│              │               │               │                  │
│    BrowserStorage    CapacitorStorage   ElectronStorage         │
│    (IndexedDB)      (Native+IndexedDB)  (SQLite via IPC)        │
│              │               │               │                  │
│              ▼               ▼               ▼                  │
│         samService      samNative.ts      samService            │
│         (WebSocket)    (direct TCP)       (bundled proxy)       │
│              │               │               │                  │
│         WS → sam-proxy   TCP → i2pd     bundled sam-proxy      │
│              │               │               │                  │
│              └───────────────┼───────────────┘                  │
│                              ▼                                   │
│                           i2pd                                   │
│                    (SAM API + I2P router)                        │
│                              ▼                                   │
│                        I2P network                               │
└──────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### React UI (`app/src/`)

Built with React 19 + TypeScript 5.9 + Vite 8. Styling via Tailwind CSS and shadcn/ui components. i18n via i18next (German and English).

Key components:

| Component | File | Role |
|-----------|------|------|
| `Onboarding` | `components/custom/Onboarding.tsx` | First-run wizard: name, passphrase, key gen, I2P setup |
| `ChatView` | `components/custom/ChatView.tsx` | Message thread with I2P status indicator, encryption status |
| `AddContactDialog` | `components/custom/AddContactDialog.tsx` | Contact import (file/manual/QR), export, verification |
| `Settings` | `components/custom/Settings.tsx` | App settings including I2P config, backup, notifications |
| `Header` | `components/custom/Header.tsx` | Connection status dot (green/yellow/red), anonymity badge |
| `MobileChatList` | `components/custom/MobileChatList.tsx` | Mobile-optimized chat list |
| `MobileNav` | `components/custom/MobileNav.tsx` | Mobile bottom navigation |
| `GroupChatUI` | `components/custom/GroupChatUI.tsx` | Group chat management and messaging |
| `FileTransferUI` | `components/custom/FileTransferUI.tsx` | P2P file transfer with progress |
| `VoiceMessageUI` | `components/custom/VoiceMessageUI.tsx` | Voice recording and playback |
| `ContactVerificationDialog` | `components/custom/ContactVerificationDialog.tsx` | Safety number verification |
| `NotificationSettings` | `components/custom/NotificationSettings.tsx` | Local notification preferences |
| `ErrorBoundary` | `components/custom/ErrorBoundary.tsx` | React error boundary |
| `UnlockDialog` | `components/custom/UnlockDialog.tsx` | Passphrase unlock prompt |
| `UpdateNotification` | `components/custom/UpdateNotification.tsx` | App update notifications (Electron) |

Custom hooks: `useIsMobile`, `useScreenSize` for responsive design.

### AppContext (`contexts/AppContext.tsx`)

Single global state provider. All components consume it via the `useApp()` hook. Owns:

- User, contacts, chats, messages state
- Theme (dark/light, synced with system/Android status bar)
- `connectionState` (derived from `i2pStatus`)
- `effectiveSamConfig()` — adjusts SAM port by platform (Electron → 7657, Android native → 7656)
- App initialization sequence
- Auth: lock/unlock, passphrase lifecycle

See [State Management](State-Management) for details.

### Service Layer

~18 singleton services handle all business logic, organized by category. See [Services Overview](Services-Overview).

### sam-proxy (`sam-proxy/proxy.mjs`)

A Node.js process that bridges WebSocket (browser/Electron side) to TCP (i2pd SAM side). Features token auth, rate limiting, command whitelist, origin validation, and max frame size enforcement. Bundled internally by the Electron app; run standalone for browser PWA.

## App Startup Sequence

`initialize()` in `AppContext.tsx` runs on mount:

1. `storageService.init()` — detects platform and initializes the appropriate storage provider (IndexedDB / SQLite / Capacitor Preferences)
2. Load user, contacts, chats, settings from storage
3. Check if private keys are encrypted (need unlock) or plaintext (load directly)
4. `cryptoService.importKeyPair()` — load PGP keys into memory
5. `i2pService.restoreIdentity()` — load Ed25519 keypair from storage
6. `i2pService.initialize()` — connect to SAM (fire-and-forget; UI updates via status callbacks)

I2P connection is non-blocking. The UI is fully usable while I2P connects in the background.

## Path Alias

`@` resolves to `app/src/` (configured in `vite.config.ts`).

```ts
import { storageService } from '@/services/storage';
```

## Storage

Platform-specific providers behind a common `StorageProvider` interface:

| Platform | Provider | Backend |
|----------|----------|---------|
| Browser | `BrowserStorageProvider` | IndexedDB (localStorage fallback) |
| Electron | `ElectronStorageProvider` | SQLite via better-sqlite3, IPC bridge |
| Android | `CapacitorStorageProvider` | Capacitor Preferences + IndexedDB |

Storage abstraction lives in `app/src/services/storage/` with subdirectories `browser/`, `capacitor/`, `electron/`. The `storageService` facade in `services/storage.ts` delegates to the appropriate provider.

> **Note:** `securechat-desktop/` at the repository root is an **abandoned** Electron wrapper — ignore it. The active desktop app is in `electron/`.
