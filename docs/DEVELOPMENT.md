# Development Guide

Diese Datei enthält Informationen für Entwickler, die an SecuChat mitwirken möchten.

---

## Tech Stack

| Area | Technology |
|------|------------|
| Frontend | React 19 + TypeScript |
| Build | Vite 7 |
| Styling | Tailwind CSS + shadcn/ui |
| Desktop | Electron 33 |
| Cryptography | OpenPGP.js (ECC curve25519) |
| Anonymization | I2P via SAM v3.1 protocol (bundled i2pd) |
| Storage | IndexedDB (local, encrypted at rest) |
| Contact exchange | `.secuchat` file import/export |

---

## Architecture

```
SecuChat (Electron)
├── main process
│   ├── i2pd (bundled binary, started on app launch)
│   └── SAM proxy (inline WebSocket :7657 → TCP :7656)
└── renderer (React app)
    ├── cryptoService   — PGP key generation, encrypt/decrypt
    ├── i2pService      — Identity, peer management, send/receive
    ├── samService      — SAM v3.1 protocol client
    └── storageService  — IndexedDB, AES-GCM encrypted keys
```

The browser renderer cannot do raw TCP, so the Electron main process runs an inline WebSocket-to-TCP bridge for the SAM protocol:

```
Renderer (WebSocket :7657) → Electron main → i2pd SAM (TCP :7656)
```

---

## Project Structure

```
SecuChat/
├── app/                        # React/Vite frontend source
│   └── src/
│       ├── components/custom/  # App components
│       ├── services/           # crypto, i2p, storage, sam
│       └── contexts/           # AppContext (global state)
├── electron/                   # Electron wrapper
│   └── src/
│       ├── main.ts             # App lifecycle, i2pd, SAM proxy
│       └── preload.ts          # Context bridge
├── resources/
│   └── i2pd/
│       ├── win/i2pd.exe        # i2pd Binary (CI-downloaded, not in repo)
│       ├── linux/i2pd          # i2pd Binary (CI-downloaded, not in repo)
│       └── certificates/       # I2P network certificates (in repo)
├── sam-proxy/                  # Standalone SAM proxy (dev use only)
└── plan/                       # Project docs & architecture notes
```

---

## Local Development

### Prerequisites

- Node.js 20+
- i2pd (für lokale Entwicklung: manuell installieren oder aus CI-Release kopieren)

### Run with Electron

```bash
# 1. Build the frontend
cd app && npm install && npm run build

# 2. Run Electron (starts bundled i2pd + SAM proxy automatically)
cd ../electron && npm install && npm run dev
```

### Run frontend standalone (browser)

```bash
# Terminal 1 — i2pd
i2pd --sam.enabled=true --sam.address=127.0.0.1 --sam.port=7656

# Terminal 2 — SAM proxy
cd sam-proxy && npm start

# Terminal 3 — frontend dev server
cd app && npm run dev
# → http://localhost:5173
```

### Build installer

```bash
cd electron
npm run dist:win    # Windows .exe
npm run dist:linux  # Linux .AppImage + .deb
```

### Other commands

```bash
cd app
npm run build      # Type-check + production build (→ app/dist/)
npm run lint       # ESLint
npx tsc --noEmit   # TypeScript check only
```

---

## CI/CD

Every push to `main` automatically:
1. Bumps the patch version (`0.0.x`) and creates a git tag
2. Triggers a release build for Linux x64 and Windows x64
3. Publishes a GitHub Release with the installers attached

Workflows: `.github/workflows/`

---

## Security Details

- Messages leave the device only PGP-encrypted
- I2P Garlic routing hides both sender and receiver
- No central server, no user accounts, no logs
- Private key is passphrase-protected and AES-GCM encrypted at rest (PBKDF2, 100k iterations)

---

## License

GNU Affero General Public License v3.0 (AGPL-3.0)

Any use, modification, or distribution of this code — including over a network — requires the source to be disclosed under the same license. Commercial closed-source use is not permitted.

See [LICENSE](LICENSE) for the full license text.
