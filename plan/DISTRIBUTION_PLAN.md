# SecuChat – Distribution & Platform Architecture

## Overview

SecuChat is delivered on two platforms:

| Platform | Technology | Status |
|----------|------------|--------|
| Desktop (Linux, Windows) | Electron | Phase 1 – next step |
| Android | Capacitor + nodejs-mobile | Phase 2 – after Desktop |

Distribution exclusively via **GitHub Releases** (no App Store, no Play Store).

---

## Desktop (Electron)

### Target platforms
- **Linux**: AppImage + `.deb`
- **Windows**: NSIS installer (`.exe`, x64)
- macOS: not planned

### Architecture

```
SecuChat.exe / SecuChat.AppImage
└── Electron Main Process (src/main.ts)
    ├── starts i2pd (bundled, platform-specific)
    │     resources/i2pd/linux/i2pd
    │     resources/i2pd/win/i2pd.exe
    ├── starts sam-proxy (sam-proxy/proxy.mjs via Node.js)
    ├── waits until SAM WebSocket responds on :7657
    └── BrowserWindow loads app/dist/index.html
```

### Startup sequence

1. Electron starts
2. `main.ts` checks if i2pd is running externally (Port 7656)
3. If not: start bundled i2pd with flags:
   ```
   --sam.enabled true
   --sam.address 127.0.0.1
   --sam.port 7656
   --http.enabled false
   --httpproxy.enabled false
   --socksproxy.enabled false
   ```
4. Start sam-proxy as child process (connects :7657 → :7656)
5. Wait until :7657 responds (max. 30s, then error message)
6. Open BrowserWindow → `app/dist/index.html`

### i2pd binaries

i2pd must be bundled per platform. Sources:
- Linux: Build from source or official release from https://github.com/PurpleI2P/i2pd/releases
- Windows: i2pd-win32 release (same source)

Binaries go into `electron/resources/i2pd/{linux,win}/`.
They are **not** checked into the Git repository (`.gitignore`), but downloaded during the build process (download script planned).

### Project structure (planned)

```
electron/
├── src/
│   └── main.ts          ← Electron Main Process
├── resources/
│   └── i2pd/
│       ├── linux/i2pd   ← not in Git
│       └── win/i2pd.exe ← not in Git
├── package.json
└── electron-builder.json
```

The existing `securechat-desktop/` folder is deprecated and not used.

### Build & Release

```bash
# Build app
cd app && npm run build

# Package Electron
cd electron && npm run dist

# Output:
# electron/release/SecuChat-x.x.x.AppImage  (Linux)
# electron/release/SecuChat-Setup-x.x.x.exe (Windows)
```

GitHub Release contains both binaries + SHA256 checksums.

---

## Android (Capacitor)

### Dependencies for the user

The user must install **once**:
1. **i2pd** from F-Droid: https://f-droid.org/packages/org.purplei2p.i2pd/
   - Must run with SAM enabled on port 7656
   - i2pd runs as Android background service and exposes tunnels for other apps
2. **SecuChat APK** (from GitHub Releases)

### Architecture

```
SecuChat.apk (Capacitor)
├── WebView
│   └── app/dist/index.html   ← identical web app as Desktop
│       └── ws://localhost:7657 (sam-proxy)
├── nodejs-mobile-capacitor
│   └── sam-proxy/proxy.mjs   ← starts automatically on app start
│       └── TCP localhost:7656 (i2pd F-Droid)
└── AndroidManifest.xml
    └── android:usesCleartextTraffic="true" (for localhost connections)
```

### Startup sequence

1. SecuChat APK starts
2. nodejs-mobile-capacitor starts `sam-proxy/proxy.mjs` in background
3. WebView loads `app/dist/index.html`
4. App connects to `ws://localhost:7657`
5. sam-proxy bridges to i2pd on `127.0.0.1:7656`
6. If i2pd is not running: App shows hint with link to F-Droid

### User onboarding (Android-specific)

The app must detect if i2pd is running and react accordingly:
- i2pd not installed/not running → Hint dialog with F-Droid link
- i2pd running but SAM not enabled → Instructions for SAM activation
- Everything OK → Normal start

### Minimum Android version

Target: Android 8.0+ (API 26) — Minimum for nodejs-mobile-capacitor.

### Build & Release

```bash
cd app && npm run build
cd android-capacitor && npx cap sync
cd android-capacitor && ./gradlew assembleRelease
# Sign APK + upload to GitHub Release
```

---

## Common points

### sam-proxy remains unchanged

`sam-proxy/proxy.mjs` is used unchanged on both platforms:
- Desktop: Electron starts it as child process
- Android: nodejs-mobile-capacitor executes it

### Web app remains unchanged

`app/src/` (Vite/React) is built identically on all platforms.
Platform-specific adjustments exclusively in the respective wrappers.

### I2P warm-up time

I2P needs ~5–10 minutes after start to build tunnels.
The app shows the connection status during this time (already implemented in `Header.tsx` + `AppContext.tsx`).

---

## Open tasks

### Phase 1 – Desktop
- [ ] Create `electron/` folder with `main.ts`, `package.json`, `electron-builder.json`
- [ ] Write i2pd binary download script
- [ ] Integrate sam-proxy start in Electron main process
- [ ] Test build (Linux AppImage + Windows NSIS)
- [ ] Set up GitHub Release workflow (GitHub Actions)

### Phase 2 – Android
- [ ] Initialize Capacitor project (`android-capacitor/`)
- [ ] Integrate `nodejs-mobile-capacitor` plugin
- [ ] Implement i2pd detection + onboarding dialog
- [ ] Sign APK + define release process
- [ ] Test with i2pd F-Droid on real device
