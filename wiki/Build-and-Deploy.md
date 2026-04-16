# Build & Deploy

## Browser PWA

### Production Build

All commands run from `app/`:

```bash
cd app
npm run build
```

This runs TypeScript type-checking first, then Vite builds the output into `app/dist/`.

```
app/dist/
├── index.html
├── assets/
│   ├── index-<hash>.js
│   └── index-<hash>.css
└── ...
```

The build is a fully static bundle — no server-side rendering, no Node.js runtime required at serving time.

### Type Checking Only

```bash
cd app
npx tsc --noEmit
```

### Linting

```bash
cd app
npm run lint
```

### Tests

```bash
cd app
npm run test          # run once (Vitest)
npm run test:watch    # watch mode
```

### Preview the Production Build

```bash
cd app
npm run preview
```

Serves `dist/` locally at `http://localhost:4173` using Vite's preview server.

## Android

### Prerequisites

- Android Studio with SDK
- Connected device or emulator

### Build & Run

```bash
cd app
npm run build:android    # build + Capacitor sync
npm run cap:open         # open in Android Studio
npm run cap:run          # run on connected device
```

Individual Capacitor commands:

| Command | Description |
|---------|-------------|
| `npm run cap:sync` | Sync web assets + plugins to Android project |
| `npm run cap:copy` | Copy web assets only |
| `npm run cap:open` | Open in Android Studio |
| `npm run cap:run` | Build and run on device/emulator |

## Desktop (Electron)

### Prerequisites

- Electron dependencies installed: `cd electron && npm install`

### Build

```bash
cd electron
npm run build          # compile TypeScript main process
npm run dist           # build + package with electron-builder
```

Platform-specific builds:

| Command | Output |
|---------|--------|
| `npm run dist` | Default platform (auto-detected) |
| `npm run dist:linux` | AppImage + deb (x64) |
| `npm run dist:win` | NSIS installer (x64, requires admin) |

The Electron build bundles:
- The compiled web app from `app/dist/` (as extraResource)
- i2pd binary from `electron/resources/i2pd/` (as extraResource)
- The SAM proxy (compiled into the main process)
- SQLite via better-sqlite3 for local storage

Build output goes to `electron/release/`.

## Deploying as a Static Site

Because the output is static HTML + JS + CSS, it can be served from any static host:

### Nginx example

```nginx
server {
    listen 443 ssl;
    server_name chat.example.com;

    root /var/www/secuchat/dist;
    index index.html;

    # SPA fallback — all routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Security headers
    add_header Content-Security-Policy "default-src 'self'; connect-src 'self' ws://127.0.0.1:7657 http://127.0.0.1:7070; script-src 'self'; style-src 'self' 'unsafe-inline';" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
}
```

### GitHub Pages

1. Build locally: `npm run build`
2. Push `app/dist/` to the `gh-pages` branch (or configure Pages to serve from `dist/`)

### Cloudflare Pages / Netlify / Vercel

Set the build command to `npm run build` and the output directory to `app/dist`.

## PWA Considerations

SecuChat is a PWA. The service worker and manifest are configured via Vite. For PWA install prompts and offline support to work:

- The app **must be served over HTTPS** (or `localhost`)
- The server must serve `manifest.webmanifest` with correct MIME type (`application/manifest+json`)

## sam-proxy Deployment

The sam-proxy must run on the **same machine as the user's browser**, not on the web server. It connects to the user's local i2pd instance.

There is no production deployment of the sam-proxy — it is a local helper process. Each user runs it on their own device.

```bash
# Users run this locally alongside i2pd
cd sam-proxy
npm start
```

## Content Security Policy Notes

The app makes two local connections that must be allowed in your CSP:

| Destination | Purpose |
|-------------|---------|
| `ws://127.0.0.1:7657` | SAM proxy WebSocket |
| `http://127.0.0.1:7070` | i2pd web console (tunnel readiness check) |

If you tighten the CSP in production, ensure these are included in `connect-src`.

## Vite Configuration

Key settings in `app/vite.config.ts`:

- Path alias: `@` → `src/`
- Output: `dist/`
- Base: `./` (relative paths — needed for Electron and Android)
- Plugin: `@vitejs/plugin-react`

No custom Vite plugins are required for I2P functionality.
