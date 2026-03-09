# SecuChat Android Setup

Diese Dokumentation beschreibt die Android-Build-Einrichtung fuer SecuChat.

## Abgeschlossene Sprint 1 Aufgaben

### 1. Capacitor-Projekt initialisiert
- `capacitor.config.ts` erstellt mit:
  - appId: `com.secuchat.app`
  - appName: `SecuChat`
  - webDir: `dist`
  - Android-spezifische Einstellungen (cleartext fuer WebSocket, Splash Screen)

### 2. Android-Plattform hinzugefuegt
- `android/` Verzeichnis erstellt mit nativem Android-Projekt
- Gradle-Build-System konfiguriert

### 3. Build-Pipeline angepasst
Neue npm-Scripts in `package.json`:
```bash
npm run cap:sync      # Sync Web-Assets mit Android
npm run cap:copy      # Kopiere Assets zu Android
npm run cap:open      # Oeffne Android Studio
npm run cap:run       # Starte auf Geraet/Emulator
npm run build:android # Build + Sync
npm run android       # Build + Run
```

### 4. Splash Screen und Icons erstellt
- `@capacitor/assets` installiert
- Icons und Splash Screens aus `icon-512x512.png` generiert
- Adaptive Icons fuer Android API 26+ erstellt
- Unterstuetzung fuer Light/Dark Mode

### 5. Deep Linking implementiert
`AndroidManifest.xml` konfiguriert fuer:
- `app://secuchat/` Protocol Handler
- Intent-Filter fuer Contact-Import (`*.secuchat` Dateien)
- JSON-MIME-Type Support

### 6. Capacitor App Plugin integriert
- `@capacitor/app` installiert
- `capacitorApp.ts` Service erstellt fuer lazy loading
- App State Change Handling in `AppContext.tsx`:
  - Pause/Resume Events
  - Deep Link Handling (`app://secuchat/contact/import`)
  - Automatische I2P-Reconnect beim Resume

## Voraussetzungen fuer Build

### Java JDK 17
```bash
# Windows (Chocolatey)
choco install openjdk17

# Oder manuelle Installation von https://adoptium.net/
```

### Android SDK
Ueber Android Studio oder Command Line Tools:
```bash
# Setze Umgebungsvariablen
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android-sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin
```

### Build-Befehle
```bash
cd app

# Web-App bauen
npm run build

# Mit Android synchronisieren
npm run cap:sync

# Debug APK bauen
cd android
./gradlew assembleDebug

# Oder mit Android Studio oeffnen
npx cap open android
```

## Ausgabe
Die APK wird erstellt unter:
`android/app/build/outputs/apk/debug/app-debug.apk`

## Deep Link Testing
```bash
# Auf Emulator/Geraet testen
adb shell am start -W -a android.intent.action.VIEW -d "app://secuchat/contact/import?data=test"
```

## Bekannte Einschraenkungen
- i2pd muss separat auf Android installiert werden (F-Droid)
- SAM WebSocket-Verbindung zu localhost:7657 fuer I2P-Konnektivitaet
