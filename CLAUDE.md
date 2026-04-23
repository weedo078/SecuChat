# CLAUDE.md

SecuChat — Privacy-focused messaging with PGP encryption and I2P routing.

## Agent Context

Load project-specific context via memory-manager droid:
```
obsidian read file="GitHub-Projekte/SecuChat/droid-wiki/overview/index" vault="Business"
```

Project wiki (droid-wiki): `wiki/` directory in this repo.
Full vault wiki: `~/Dokumente/Business/GitHub-Projekte/SecuChat/droid-wiki/`

## Commands

```bash
cd app && npm run dev       # Dev server (Vite)
cd app && npm run build     # Type-check + production build
cd app && npm run lint      # ESLint
cd app && npx tsc --noEmit  # Type-check only
cd sam-proxy && npm start   # WebSocket proxy on port 7657 → SAM TCP 7656
```

## Android (Capacitor)

Native SAM plugin connects directly to i2pd on port 7656 (no WebSocket proxy).
Build: `cd app && npx cap sync android && cd android && ./gradlew assembleDebug`

## Platform Detection

Two independent systems — **both** check Capacitor first, Electron second:
- `services/platform.ts` (platformService) — general platform info
- `services/storage/platform.ts` — selects storage provider (capacitor/electron/browser)

`window.electronAPI` does NOT exist on Android. Capacitor is detected via `@capacitor/core`.

## Contact Exchange

- **Animated QR**: multi-frame encoding with PGP key, rendered via `toDataURL` + `<img>` (not `toCanvas`)
- **File export**: full v2 format with PGP key
- **Static QR**: compact v2 without PGP key
