# Local Development

## Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- **i2pd** (optional, for I2P testing) — see [I2P Setup](I2P-Setup)
- **Android Studio** (for Android development)

## Repository Structure

```
SecuChat/
├── app/               ← Main application (Vite + React + TypeScript)
│   ├── src/
│   │   ├── components/
│   │   │   ├── custom/    ← App-specific components
│   │   │   └── ui/        ← shadcn/ui primitives
│   │   ├── contexts/      ← AppContext (global state)
│   │   ├── services/      ← Business logic (~18 services)
│   │   │   └── storage/   ← Storage abstraction (browser/, capacitor/, electron/)
│   │   ├── locales/       ← i18n translations (de.json, en.json)
│   │   ├── types/         ← TypeScript type definitions
│   │   └── utils/         ← Helpers (base32, logger, ...)
│   ├── package.json
│   └── vite.config.ts
├── electron/          ← Active Electron desktop app
│   ├── src/           ← Main process (SAM proxy, storage IPC, auto-update)
│   ├── resources/     ← Bundled i2pd binary
│   └── package.json
├── sam-proxy/         ← Node.js WebSocket-to-TCP proxy for SAM (browser PWA)
│   └── proxy.mjs
└── CLAUDE.md
```

> `securechat-desktop/` at the root is an **abandoned** Electron wrapper — ignore it. Use `electron/` instead.

## Running the App

### Browser

All commands run from `app/`:

```bash
cd app
npm install        # first time
npm run dev        # dev server with HMR at http://localhost:5173
```

### Electron Desktop

```bash
cd electron
npm install        # first time
npm run dev        # builds main process + launches Electron window
```

### Android

```bash
cd app
npm install                           # first time
npm run build:android                 # build + sync Capacitor
npm run cap:open                      # open in Android Studio
npm run cap:run                       # run on connected device/emulator
```

## Running the SAM Proxy (for I2P, browser only)

```bash
cd sam-proxy
npm install        # first time
npm start          # WebSocket proxy on port 7657
```

The proxy forwards to i2pd SAM on `127.0.0.1:7656`. Not needed for Android (native plugin) or Electron (bundled).

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Type-check + production build → `app/dist/` |
| `npm run lint` | ESLint |
| `npm run preview` | Serve the production build locally |
| `npm run test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode (Vitest) |
| `npm run build:android` | Build + sync for Android |
| `npm run cap:sync` | Sync Capacitor assets to Android project |
| `npm run cap:open` | Open Android project in Android Studio |
| `npx tsc --noEmit` | Type-check only (no output) |

## i18n

The app uses i18next with German and English locales. Translation files are in `app/src/locales/` (`de.json`, `en.json`). Language auto-detects from the system, defaulting to English. See `app/src/locales/TRANSLATING.md` for contribution guidelines.

## Full Local Stack for I2P Testing (Browser)

```bash
# Terminal 1 — i2pd
i2pd --sam.enabled=true --sam.address=127.0.0.1 --sam.port=7656

# Terminal 2 — SAM proxy
cd sam-proxy && npm start

# Terminal 3 — App
cd app && npm run dev

# Browser
# Open http://localhost:5173
# Settings → I2P → Enable SAM, host 127.0.0.1, port 7657 → Test connection
```

## Adding UI Components

shadcn/ui components can be added with:

```bash
cd app
npx shadcn@latest add <component-name>
```

Generated files land in `src/components/ui/`.

## Path Alias

`@` maps to `app/src/`. Use it for all non-relative imports:

```ts
import { storageService } from '@/services/storage';
import { Button } from '@/components/ui/button';
```

## Logging

A custom logger (`@/utils/logger`) is used throughout the services. In production builds, log levels are suppressed. In development, full output appears in the browser console prefixed with `[SAM]`, `[I2P]`, `[Storage]`, etc.

## Environment Notes

- The app runs entirely client-side. There is no Express server, no REST API, no database server.
- Storage is platform-specific: IndexedDB (browser), SQLite (Electron), Capacitor Preferences + IndexedDB (Android).
- The I2P connection is optional. The app loads and is usable without I2P; the status dot in the header shows the connection state.
- The Vite config uses `base: './'` for relative paths (needed for Electron and Android asset loading).
