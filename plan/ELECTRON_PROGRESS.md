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
│   └── preload.ts      ← Context Bridge (isElectron, i2pdBundled, platform, version)
├── resources/
│   └── i2pd/
│       ├── linux/i2pd  ← Binary (nicht in Git, via build.sh heruntergeladen)
│       ├── win/i2pd.exe← Binary (nicht in Git, via build.ps1 heruntergeladen)
│       └── certificates/ ← i2pd-Zertifikate (in Git eingecheckt)
├── package.json
├── tsconfig.json
├── electron-builder.json
└── installer.nsh       ← NSIS-Makro: Defender-Ausnahme bei Installation
```

### Startsequenz

```
1. Electron startet
2. Prüfen ob i2pd extern läuft (Port 7656)
3. Falls nicht: gebündeltes i2pd spawnen
4. Warten bis Port 7656 offen ist (max. 20s)
5. SAM-Proxy WebSocket-Server inline starten (:7657 → :7656)
6. BrowserWindow öffnen → app/dist/index.html
7. Bei App-Ende: i2pd beenden, sam-proxy stoppen
```

---

## Aufgaben

### Setup & Konfiguration
- [x] Verzeichnisstruktur `electron/` anlegen
- [x] `package.json` (Electron 33, electron-builder 25)
- [x] `tsconfig.json`
- [x] `electron-builder.json` (Linux AppImage arm64, Windows NSIS x64)
- [x] `.gitignore` um i2pd-Binaries ergänzt
- [x] `installer.nsh` — NSIS-Makro für Defender-Ausnahme

### Implementierung
- [x] `src/preload.ts` — exposes `isElectron: true`, `i2pdBundled: true`, `platform`, `version`
- [x] `src/main.ts`
  - [x] i2pd starten (gebündelt oder System-Fallback)
  - [x] SAM-Proxy inline (WebSocket-Server in main process)
  - [x] `waitForPort()` mit Timeout (20s für Windows)
  - [x] `createWindow()` lädt `app/dist/index.html`
  - [x] Graceful shutdown (i2pd + sam-proxy bei App-Ende)
- [x] Korrekter i2pd-Pfad in gepackter App: `resources/i2pd/win/i2pd.exe`

### Build-Scripts
- [x] `build.sh` — Linux: lädt i2pd .deb, extrahiert Binary + Zertifikate
- [x] `build.ps1` — Windows: lädt i2pd .zip, Node.js via winget, Defender-Ausnahme für Repo-Ordner

### App-seitige Fixes (Electron-Integration)
- [x] `platform.ts`: Electron-Erkennung via `window.electronAPI.isElectron` + UA-Fallback (`Electron/`)
- [x] `platform.ts`: Electron-Branch gibt `i2pSupport: 'native'` zurück (kein "Install i2pd" mehr)
- [x] `Onboarding.tsx`: Auto-Test bei Schritt 4 in Electron, Timeout 30s statt 10s
- [x] `Onboarding.tsx`: Electron-spezifische Fehlermeldung ("i2pd startet noch, klicken Sie auf Weiter")
- [x] `Settings.tsx`: ScrollArea durch `div overflow-y-auto` ersetzt (Radix-Bug in Flex-Dialog)
- [x] `AppContext.tsx`: I2P-Init mit 15s Timeout — App hängt nie mehr auf "Wird geladen..."

### Windows Defender
- [x] `build.ps1`: permanente Ausnahme für Repo-Verzeichnis (verhindert Löschung beim Build)
- [x] `installer.nsh`: NSIS fügt `$INSTDIR` automatisch als Defender-Ausnahme hinzu (läuft als Admin)
- [x] Installer entfernt die Ausnahme beim Deinstallieren wieder

### Versionen
- [x] v0.0.1 — Erster funktionsfähiger Electron-Build (Linux AppImage)
- [x] v0.0.2 — Onboarding-Fix, Pfad-Fix, Defender-Fix, Lade-Timeout

### Offen
- [ ] Lokaler Test mit externem i2pd (ohne Packaging)
- [ ] GitHub Actions Workflow für automatische Releases
- [ ] Tray-Icon (App im Hintergrund laufen lassen)
- [ ] I2P Warm-up Splash Screen (5–10 Min Tunnel-Aufbau anzeigen)
- [ ] Auto-Updater (electron-updater via GitHub Releases)
- [ ] Code-Signing für SmartScreen-Reputation (EV-Zertifikat)

---

## Bekannte Eigenheiten

| Problem | Status | Lösung |
|---------|--------|--------|
| Windows Defender false positive auf i2pd.exe | Gelöst | Installer + build.ps1 fügen Defender-Ausnahme hinzu |
| i2pd braucht 5–10 Min für ersten Tunnel-Aufbau | Hinweis in UI | Onboarding erklärt Wartezeit |
| SAM-Handshake kann hängen | Gelöst | 15s Timeout in AppContext.initialize() |
| Electron-Erkennung schlug fehl | Gelöst | UA-Fallback `Electron/` zusätzlich zu contextBridge |
| Falscher i2pd-Pfad in gepackter App | Gelöst | `win/i2pd.exe` statt `i2pd.exe` |

---

## Versionen

| Paket | Version |
|-------|---------|
| Electron | 33.x |
| electron-builder | 25.x |
| TypeScript | 5.x |
| ws (SAM-Proxy) | 8.18.x |
| i2pd | 2.59.0 |
