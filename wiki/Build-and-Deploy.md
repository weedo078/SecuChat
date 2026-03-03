# Build & Deploy

## Production Build

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

## Type Checking Only

```bash
cd app
npx tsc --noEmit
```

Useful in CI to catch type errors without producing build output.

## Linting

```bash
cd app
npm run lint
```

Uses ESLint with the project's config. Fix issues before committing.

## Preview the Production Build

```bash
cd app
npm run preview
```

Serves `dist/` locally at `http://localhost:4173` using Vite's preview server. Useful to verify the production build works correctly before deploying.

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
- Plugin: `@vitejs/plugin-react`

No custom Vite plugins are required for I2P functionality.
