# Local Development

## Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- **i2pd** (optional, for I2P testing) — see [I2P Setup](I2P-Setup)

## Repository Structure

```
SecuChat/
├── app/               ← Main application (Vite + React + TypeScript)
│   ├── src/
│   │   ├── components/
│   │   │   ├── custom/    ← App-specific components
│   │   │   └── ui/        ← shadcn/ui primitives
│   │   ├── contexts/      ← AppContext (global state)
│   │   ├── services/      ← Business logic (crypto, storage, i2p, sam, platform)
│   │   ├── types/         ← TypeScript type definitions
│   │   └── utils/         ← Helpers (base32, logger, ...)
│   ├── package.json
│   └── vite.config.ts
├── sam-proxy/         ← Node.js WebSocket-to-TCP proxy for SAM
│   └── proxy.mjs
└── CLAUDE.md
```

`securechat-desktop/` at the root is an abandoned Electron wrapper — ignore it.

## Running the App

All commands run from `app/`:

```bash
cd app
npm install        # first time
npm run dev        # dev server with HMR at http://localhost:5173
```

## Running the SAM Proxy (for I2P)

```bash
cd sam-proxy
npm install        # first time
npm start          # WebSocket proxy on port 7657
```

The proxy forwards to i2pd SAM on `127.0.0.1:7656`. Run this alongside i2pd when testing I2P connectivity.

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Type-check + production build → `app/dist/` |
| `npm run lint` | ESLint |
| `npm run preview` | Serve the production build locally |
| `npx tsc --noEmit` | Type-check only (no output) |

## Full Local Stack for I2P Testing

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

- The app runs entirely in the browser. There is no Express server, no REST API, no database server.
- IndexedDB is the persistence layer. On `file://` protocol (e.g. opening `index.html` directly), it falls back to localStorage.
- The I2P connection is optional. The app loads and is usable without I2P; the status dot in the header shows the connection state.
