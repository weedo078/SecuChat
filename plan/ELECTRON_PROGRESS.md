# Electron Desktop Build – Fortschritt

## Ziel

Einen selbstständig lauffähigen Electron-Wrapper bauen, der:
- i2pd als gebündelten Prozess startet (kein separates Setup nötig)
- sam-proxy inline im Main Process betreibt
- die bestehende `app/dist/` als Renderer lädt
- als `.AppImage` (Linux) und `.exe` (Windows NSIS) ausgeliefert wird

---

## Architektur

```
electron/
├── src/
│   ├── main.ts         ← Hauptprozess: i2pd + sam-proxy + BrowserWindow
│   └── preload.ts      ← Context Bridge (minimal)
├── resources/
│   └── i2pd/
│       ├── linux/i2pd  ← Binary (nicht in Git)
│       └── win/i2pd.exe← Binary (nicht in Git)
├── package.json
├── tsconfig.json
└── electron-builder.json
```

### Startsequenz

```
1. Electron startet
2. Prüfen ob i2pd extern läuft (Port 7656)
3. Falls nicht: gebündeltes i2pd spawnen
4. SAM-Proxy WebSocket-Server inline starten (:7657 → :7656)
5. Warten bis :7657 antwortet (max. 30s)
6. BrowserWindow öffnen → app/dist/index.html
7. Bei App-Ende: i2pd beenden, sam-proxy stoppen
```

---

## Aufgaben

### Setup & Konfiguration
- [x] Verzeichnisstruktur `electron/` anlegen
- [x] `package.json` (Electron 33, electron-builder 25)
- [x] `tsconfig.json`
- [x] `electron-builder.json` (Linux AppImage+deb, Windows NSIS)
- [x] `.gitignore` um i2pd-Binaries ergänzt

### Implementierung
- [x] `src/preload.ts` (minimal)
- [x] `src/main.ts`
  - [x] i2pd starten (gebündelt oder System-Fallback)
  - [x] SAM-Proxy inline (WebSocket-Server in main process)
  - [x] `waitForPort()` mit Timeout
  - [x] `createWindow()` lädt `app/dist/index.html`
  - [x] Graceful shutdown (i2pd beenden bei App-Ende)

### Build & Test
- [x] `npm install` in `electron/`
- [x] TypeScript kompiliert fehlerfrei (`npm run build`)
- [ ] Lokaler Test (ohne i2pd-Binary, mit externem i2pd)
- [ ] i2pd-Binary Download-Script schreiben
- [ ] Paketieren: Linux AppImage
- [ ] Paketieren: Windows NSIS (via Wine oder CI)
- [ ] GitHub Actions Workflow für automatische Releases

### Offen
- [ ] App-Icon (512x512 PNG) für alle Plattformen
- [ ] Tray-Icon (App im Hintergrund laufen lassen)
- [ ] I2P Warm-up Splash Screen (5–10 Min Tunnel-Aufbau)
- [ ] Auto-Updater (electron-updater via GitHub Releases)

---

## Versionen

| Paket | Version |
|-------|---------|
| Electron | 33.x |
| electron-builder | 25.x |
| TypeScript | 5.x |
| ws (SAM-Proxy) | 8.18.x |
