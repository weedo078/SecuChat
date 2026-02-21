# SecuChat – Distribution & Plattform-Architektur

## Übersicht

SecuChat wird auf zwei Plattformen ausgeliefert:

| Plattform | Technologie | Status |
|-----------|-------------|--------|
| Desktop (Linux, Windows) | Electron | Phase 1 – nächster Schritt |
| Android | Capacitor + nodejs-mobile | Phase 2 – nach Desktop |

Distribution ausschließlich über **GitHub Releases** (kein App Store, kein Play Store).

---

## Desktop (Electron)

### Zielplattformen
- **Linux**: AppImage + `.deb`
- **Windows**: NSIS Installer (`.exe`, x64)
- macOS: nicht geplant

### Architektur

```
SecuChat.exe / SecuChat.AppImage
└── Electron Main Process (src/main.ts)
    ├── startet i2pd (gebündelt, plattformspezifisch)
    │     resources/i2pd/linux/i2pd
    │     resources/i2pd/win/i2pd.exe
    ├── startet sam-proxy (sam-proxy/proxy.mjs via Node.js)
    ├── wartet bis SAM-WebSocket auf :7657 antwortet
    └── BrowserWindow lädt app/dist/index.html
```

### Startsequenz

1. Electron startet
2. `main.ts` prüft ob i2pd extern läuft (Port 7656)
3. Falls nicht: gebündeltes i2pd starten mit Flags:
   ```
   --sam.enabled true
   --sam.address 127.0.0.1
   --sam.port 7656
   --http.enabled false
   --httpproxy.enabled false
   --socksproxy.enabled false
   ```
4. sam-proxy als Child-Process starten (verbindet :7657 → :7656)
5. Warten bis :7657 antwortet (max. 30s, danach Fehlermeldung)
6. BrowserWindow öffnen → `app/dist/index.html`

### i2pd Binaries

i2pd muss pro Plattform gebündelt werden. Bezugsquellen:
- Linux: Build aus Quellen oder offizielles Release von https://github.com/PurpleI2P/i2pd/releases
- Windows: i2pd-win32 Release (gleiche Quelle)

Binaries landen in `electron/resources/i2pd/{linux,win}/`.
Sie werden **nicht** ins Git-Repository eingecheckt (`.gitignore`), sondern beim Build-Prozess heruntergeladen (Download-Script geplant).

### Projektstruktur (geplant)

```
electron/
├── src/
│   └── main.ts          ← Electron Main Process
├── resources/
│   └── i2pd/
│       ├── linux/i2pd   ← nicht in Git
│       └── win/i2pd.exe ← nicht in Git
├── package.json
└── electron-builder.json
```

Der bestehende `securechat-desktop/` Ordner ist veraltet und wird nicht verwendet.

### Build & Release

```bash
# App bauen
cd app && npm run build

# Electron paketieren
cd electron && npm run dist

# Ausgabe:
# electron/release/SecuChat-x.x.x.AppImage  (Linux)
# electron/release/SecuChat-Setup-x.x.x.exe (Windows)
```

GitHub Release enthält beide Binaries + SHA256-Checksums.

---

## Android (Capacitor)

### Abhängigkeiten für den Nutzer

Der Nutzer muss **einmalig** installieren:
1. **i2pd** aus F-Droid: https://f-droid.org/packages/org.purplei2p.i2pd/
   - Muss mit aktiviertem SAM auf Port 7656 laufen
   - i2pd läuft als Android-Hintergrunddienst und gibt Tunnel für andere Apps frei
2. **SecuChat APK** (von GitHub Releases)

### Architektur

```
SecuChat.apk (Capacitor)
├── WebView
│   └── app/dist/index.html   ← identische Web-App wie Desktop
│       └── ws://localhost:7657 (sam-proxy)
├── nodejs-mobile-capacitor
│   └── sam-proxy/proxy.mjs   ← startet automatisch beim App-Start
│       └── TCP localhost:7656 (i2pd F-Droid)
└── AndroidManifest.xml
    └── android:usesCleartextTraffic="true" (für localhost-Verbindungen)
```

### Startsequenz

1. SecuChat APK startet
2. nodejs-mobile-capacitor startet `sam-proxy/proxy.mjs` im Hintergrund
3. WebView lädt `app/dist/index.html`
4. App verbindet sich auf `ws://localhost:7657`
5. sam-proxy bridget zu i2pd auf `127.0.0.1:7656`
6. Falls i2pd nicht läuft: App zeigt Hinweis mit Link zu F-Droid

### Nutzer-Onboarding (Android-spezifisch)

Die App muss erkennen ob i2pd läuft und entsprechend reagieren:
- i2pd nicht installiert/läuft nicht → Hinweisdialog mit F-Droid Link
- i2pd läuft aber SAM nicht aktiviert → Anleitung zur SAM-Aktivierung
- Alles OK → normaler Start

### Minimale Android-Version

Ziel: Android 8.0+ (API 26) — Minimum für nodejs-mobile-capacitor.

### Build & Release

```bash
cd app && npm run build
cd android-capacitor && npx cap sync
cd android-capacitor && ./gradlew assembleRelease
# APK signieren + zu GitHub Release hochladen
```

---

## Gemeinsame Punkte

### sam-proxy bleibt unverändert

`sam-proxy/proxy.mjs` wird auf beiden Plattformen unverändert verwendet:
- Desktop: Electron startet es als Child-Process
- Android: nodejs-mobile-capacitor führt es aus

### Web-App bleibt unverändert

`app/src/` (Vite/React) wird auf allen Plattformen identisch gebaut.
Plattformspezifische Anpassungen ausschließlich in den jeweiligen Wrappern.

### I2P Warm-up Zeit

I2P benötigt nach dem Start ~5–10 Minuten um Tunnel aufzubauen.
Die App zeigt währenddessen den Verbindungsstatus (bereits implementiert in `Header.tsx` + `AppContext.tsx`).

---

## Offene Aufgaben

### Phase 1 – Desktop
- [ ] `electron/` Ordner anlegen mit `main.ts`, `package.json`, `electron-builder.json`
- [ ] i2pd Binary Download-Script schreiben
- [ ] sam-proxy Start in Electron Main Process integrieren
- [ ] Build testen (Linux AppImage + Windows NSIS)
- [ ] GitHub Release Workflow (GitHub Actions) aufsetzen

### Phase 2 – Android
- [ ] Capacitor Projekt initialisieren (`android-capacitor/`)
- [ ] `nodejs-mobile-capacitor` Plugin integrieren
- [ ] i2pd-Erkennung + Onboarding-Dialog implementieren
- [ ] APK signieren + Release-Prozess definieren
- [ ] Testen mit i2pd F-Droid auf echtem Gerät
