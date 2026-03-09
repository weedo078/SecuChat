# SecuChat Android Port - Sprint Plan

**Repository:** https://github.com/weedo078/SecuChat  
**Branch:** `feature/android-port`  
**Ziel:** Pragmatische Portierung der SecuChat Desktop-App auf Android  
**Sprint-Dauer:** 2 Wochen pro Sprint  
**Gesamtdauer:** ~10 Wochen (5 Sprints)

---

## 0. CI/CD & Build-Infrastruktur (Voraussetzung für alle Sprints)

**Ziel:** Von Anfang an automatisierte Builds, Tests und Qualitäts-Checks für Android – analog zur bestehenden Electron-CI.

### 0.1 GitHub Actions Workflow für Android

**Neue Workflow-Datei:** `.github/workflows/android-ci.yml`

```yaml
name: Android CI

on:
  push:
    branches: [ main, develop, feature/android-port, feature/android-* ]
  pull_request:
    branches: [ main, develop, feature/android-port ]

jobs:
  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: |
            app/package-lock.json
            android/package-lock.json
      
      - name: Install dependencies (App)
        working-directory: ./app
        run: npm ci
      
      - name: Run Unit Tests
        working-directory: ./app
        run: npm run test
      
      - name: Run Lint
        working-directory: ./app
        run: npm run lint

  build-web:
    name: Build Web App
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: app/package-lock.json
      
      - name: Install dependencies
        working-directory: ./app
        run: npm ci
      
      - name: Build for Capacitor
        working-directory: ./app
        run: npm run build:android  # oder npm run build mit Capacitor-Ziel
      
      - name: Upload Web Build
        uses: actions/upload-artifact@v4
        with:
          name: web-build
          path: app/dist

  build-android:
    name: Build Android APK
    runs-on: ubuntu-latest
    needs: build-web
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: android/package-lock.json
      
      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
      
      - name: Setup Android SDK
        uses: android-actions/setup-android@v3
      
      - name: Install Capacitor dependencies
        working-directory: ./android
        run: npm ci
      
      - name: Download Web Build
        uses: actions/download-artifact@v4
        with:
          name: web-build
          path: android/dist
      
      - name: Sync Capacitor
        working-directory: ./android
        run: npx cap sync android
      
      - name: Build Debug APK
        working-directory: ./android/android
        run: ./gradlew assembleDebug
      
      - name: Upload APK
        uses: actions/upload-artifact@v4
        with:
          name: android-debug-apk
          path: android/android/app/build/outputs/apk/debug/app-debug.apk

  android-emulator-test:
    name: Test on Emulator
    runs-on: macos-latest  # Emulator braucht macOS für HVM
    needs: build-android
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      
      - name: Download APK
        uses: actions/download-artifact@v4
        with:
          name: android-debug-apk
          path: ./apk
      
      - name: Run Emulator Tests
        uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: 30
          arch: x86_64
          script: |
            adb install ./apk/app-debug.apk
            adb shell am start -n com.secuchat.app/.MainActivity
            sleep 10
            adb shell screencap -p /sdcard/screenshot.png
            adb pull /sdcard/screenshot.png
      
      - name: Upload Screenshot
        uses: actions/upload-artifact@v4
        with:
          name: emulator-screenshot
          path: screenshot.png

  claude-review:
    name: Claude Code Review
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      
      - name: Run Claude Review
        uses: ./.github/actions/claude-review
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          pr-number: ${{ github.event.pull_request.number }}
```

### 0.2 Branch-Protection Rules

Für `feature/android-port` und alle `feature/android-*` Branches:

- [ ] **Require status checks:**
  - Test
  - Build Web App
  - Build Android APK
  - Test on Emulator (ab Sprint 2)
  - Claude Code Review (für PRs)

- [ ] **Require pull request reviews:**
  - 1 Approval erforderlich
  - Stale reviews dismissen bei neuen Commits

- [ ] **Require linear history:**
  - Keine Merge-Commits, nur Rebase/Squash

### 0.3 Lokale Build-Validierung

**Pre-Commit Hooks:**
```bash
# .husky/pre-commit oder git-hooks
npm run lint
npm run test:unit
npm run build:android:check  # Build testen ohne APK
```

### 0.4 CI/CD Integration in Sprints

| Sprint | CI-Anforderung |
|--------|----------------|
| **Sprint 1** | Basic Workflow läuft, APK wird gebaut, Emulator-Test startet App |
| **Sprint 2** | Storage-Tests laufen auf Emulator, Permissions werden validiert |
| **Sprint 3** | I2P-Integration-Tests (Mock), SAM WebSocket Tests |
| **Sprint 4** | UI-Tests auf verschiedenen Screen-Größen, Screenshot-Regression |
| **Sprint 5** | Background-Tests, Notification-Tests auf Emulator |

### 0.5 Definition of Done für CI

Jeder PR in `feature/android-port` muss erfüllen:
- [ ] Alle GitHub Actions Checks grün
- [ ] Unit Tests passieren (>80% Coverage)
- [ ] Lint keine Fehler
- [ ] APK wird erfolgreich gebaut
- [ ] App startet auf Emulator (Screenshot als Proof)
- [ ] Keine neuen Security-Warnungen (GitGuardian)
- [ ] Code Review durch mindestens 1 Person

---

## 1. Architekturanalyse

### 1.1 Aktuelle Stack-Übersicht

| Komponente | Aktuelle Implementierung | Portierbarkeit |
|------------|-------------------------|----------------|
| **Frontend** | React 19 + TypeScript + Vite | ✅ Direkt portierbar |
| **UI Framework** | Tailwind CSS + shadcn/ui + Radix UI | ⚠️ Anpassung nötig |
| **State Management** | React Context + Hooks | ✅ Direkt portierbar |
| **Storage** | IndexedDB mit localStorage-Fallback | ✅ Direkt portierbar |
| **I2P Kommunikation** | SAM v3.1 via WebSocket | ✅ Direkt portierbar |
| **Kryptographie** | Web Crypto API + OpenPGP.js | ✅ Direkt portierbar |
| **Internationalisierung** | i18next | ✅ Direkt portierbar |
| **Electron-Shell** | Main/Preload/Renderer Prozess | ❌ Muss ersetzt werden |
| **i2pd Daemon** | Eingebettet in Electron | ⚠️ Externe App nötig |
| **Auto-Updater** | electron-updater | ❌ Muss ersetzt werden |

### 1.2 Was ist portierbar

**✅ Direkt übernehmbar (Web-Technologien):**
- Alle React-Komponenten und Hooks
- Geschäftslogik in Services (`crypto.ts`, `storage.ts`, `i2pSam.ts`)
- TypeScript-Typdefinitionen
- Test-Suite (Vitest)
- i18n-Übersetzungen

**⚠️ Anpassungen erforderlich:**
- UI-Komponenten für Touch-Optimierung
- Scroll-Areas und Resizable Panels (mobile-unfreundlich)
- Dialoge/Sheets für mobile Navigation anpassen
- CSS Breakpoints für mobile Layouts

**❌ Muss ersetzt werden:**
- Electron Hauptprozess (main.ts)
- IPC-Kommunikation (preload.ts)
- Eingebettetes i2pd → Externe i2pd-Android-App
- Auto-Updater → Capacitor App-Update oder PWA-Update

### 1.3 Empfohlener Technologie-Stack

| Option | Bewertung | Empfehlung |
|--------|-----------|------------|
| **Capacitor** | ⭐⭐⭐⭐⭐ **GEWÄHLTE LÖSUNG** | Native WebView, beste Plugin-Ökosystem, einfachste Migration |
| **Cordova** | ⭐⭐⭐ | Veraltet, weniger Support |
| **React Native** | ⭐⭐⭐ | Rewrite nötig, keine direkte WebView-Nutzung möglich |
| **TWA (Trusted Web Activity)** | ⭐⭐⭐⭐ | Nur für PWA, keine Native Features |
| **Flutter WebView** | ⭐⭐⭐ | Kompletter Rewrite notwendig |

**Entscheidung: Capacitor**

Gründe:
1. **Minimaler Rewrite:** App läuft direkt in WebView
2. **Native Bridge:** Zugriff auf Android-APIs via Plugins
3. **i2pd Integration:** Intent-basierte Kommunikation mit i2pd-Android-App
4. **Background Processing:** Capacitor Background Mode für Nachrichten
5. **Push Notifications:** Firebase/Local Notifications via Plugin
6. **App Store Ready:** Native APK/AAB-Build

### 1.4 Architektur Android-Port

```
┌─────────────────────────────────────────────────────────────┐
│                    Android App (APK)                         │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │   WebView    │  │ Capacitor    │  │ Background       │  │
│  │   (React)    │◄─┤ Bridge       │  │ Service          │  │
│  │              │  │              │  │                  │  │
│  └──────────────┘  └──────┬───────┘  └────────┬─────────┘  │
│                           │                   │            │
│                   ┌───────┴───────┐  ┌────────┴────────┐   │
│                   │   Plugins     │  │  Notifications  │   │
│                   │ • Storage     │  │  • Local        │   │
│                   │ • App         │  │  • Push         │   │
│                   │ • Background  │  │                 │   │
│                   └───────────────┘  └─────────────────┘   │
│                            │                               │
│  ┌─────────────────────────┴─────────────────────────────┐  │
│  │              Android System Services                   │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │  │
│  │  │ Intent   │  │ File     │  │ SharedPreferences  │  │  │
│  │  │ (i2pd)   │  │ System   │  │                    │  │  │
│  │  └──────────┘  └──────────┘  └────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Externe Apps                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ i2pd Android (aus F-Droid)                            │  │
│  │ • SAM Bridge auf localhost:7656                       │  │
│  │ • WebSocket Proxy auf localhost:7657                  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Sprint Plan

### Sprint 1: Projekt-Setup & Capacitor-Integration (Woche 1-2)

**Ziel:** Funktionsfähige Android-App mit geladener WebView

#### Aufgaben:

| # | Aufgabe | Story Points | Assignee |
|---|---------|--------------|----------|
| 1.1 | Capacitor-Projekt initialisieren (`npx cap init`) | 2 | - |
| 1.2 | Android-Plattform hinzufügen (`npx cap add android`) | 2 | - |
| 1.3 | Build-Pipeline anpassen für Capacitor-Build | 3 | - |
| 1.4 | Splash Screen und App-Icon erstellen | 3 | - |
| 1.5 | Erste APK erstellen und auf Emulator testen | 2 | - |
| 1.6 | Deep-Linking für `app://` Protocol Handler | 3 | - |
| 1.7 | Capacitor App-Plugin für App-Infos integrieren | 2 | - |

#### Definition of Done:
- [ ] APK läuft auf Android Emulator (API 28+)
- [ ] App zeigt React-UI korrekt an
- [ ] Splash Screen und Icon vorhanden
- [ ] `app://` Protocol wird korrekt gehandhabt
- [ ] Build-Skript erstellt automatisch APK
- [ ] **CI:** GitHub Actions Workflow läuft durch (Test → Build → APK)
- [ ] **CI:** APK wird als Artifact hochgeladen
- [ ] **CI:** Emulator-Test startet App erfolgreich

#### Risiken:
- **Risiko:** WebView-Version zu alt auf älteren Android-Geräten
  - **Mitigation:** minSdkVersion 28 (Android 9), moderne WebView sicherstellen

---

### Sprint 2: Storage & Platform-Integration (Woche 3-4)

**Ziel:** Persistenter Speicher und native Plattform-Features

#### Aufgaben:

| # | Aufgabe | Story Points | Assignee |
|---|---------|--------------|----------|
| 2.1 | Capacitor Preferences Plugin für Settings | 3 | - |
| 2.2 | Capacitor Filesystem Plugin für Backups | 5 | - |
| 2.3 | IndexedDB in WebView testen und optimieren | 3 | - |
| 2.4 | Platform Detection für Android erweitern | 2 | - |
| 2.5 | Android-Permissions (Storage, Internet) | 2 | - |
| 2.6 | Intent-Filter für i2pd-Integration | 3 | - |
| 2.7 | Biometric Auth Plugin evaluieren | 2 | - |

#### Definition of Done:
- [ ] Settings werden persistent gespeichert
- [ ] Backup/Export funktioniert mit nativem Dateisystem
- [ ] IndexedDB speichert Daten korrekt
- [ ] App erkennt sich als "native Android"
- [ ] Alle benötigten Permissions werden korrekt angefordert
- [ ] Integration mit i2pd-App via Intent möglich
- [ ] **CI:** Storage-Integration-Tests laufen durch
- [ ] **CI:** Emulator-Tests validieren Permissions
- [ ] **CI:** Keine Regressions in bestehenden Tests

#### Risiken:
- **Risiko:** IndexedDB Limitierungen in WebView
  - **Mitigation:** Quota Management, Fallback zu Capacitor Filesystem für große Daten
- **Risiko:** Android Permissions Änderungen in neueren Versionen
  - **Mitigation:** Target SDK 34, aber minSdk 28

---

### Sprint 3: I2P-Integration & Netzwerk (Woche 5-6)

**Ziel:** Volle I2P-Konnektivität via externer i2pd-App

#### Aufgaben:

| # | Aufgabe | Story Points | Assignee |
|---|---------|--------------|----------|
| 3.1 | i2pd Android App Detection | 3 | - |
| 3.2 | Intent zum Öffnen von i2pd implementieren | 2 | - |
| 3.3 | SAM WebSocket Verbindung testen (localhost:7657) | 3 | - |
| 3.4 | Connection-Status UI für i2pd | 3 | - |
| 3.5 | Auto-Start i2pd wenn nicht aktiv | 2 | - |
| 3.6 | SAM Service in WebView testen | 3 | - |
| 3.7 | Fehlerbehandlung für fehlende i2pd | 2 | - |

#### Definition of Done:
- [ ] App erkennt ob i2pd installiert ist
- [ ] i2pd kann aus der App heraus gestartet werden
- [ ] SAM WebSocket Verbindung funktioniert
- [ ] Connection-Status wird korrekt angezeigt
- [ ] Fehlermeldung wenn i2pd nicht verfügbar
- [ ] Message-Sending/Receiving funktioniert über I2P

#### Risiken:
- **Risiko:** i2pd Android unterstützt SAM nicht out-of-the-box
  - **Mitigation:** Dokumentation der Konfiguration, evtl. eigener SAM-Proxy in Android
- **Risiko:** WebSocket in WebView blockiert
  - **Mitigation:** Cleartext Traffic erlauben für localhost, Network Security Config

---

### Sprint 4: UI/UX Mobile-Optimierung (Woche 7-8)

**Ziel:** Optimierte mobile Benutzererfahrung

#### Aufgaben:

| # | Aufgabe | Story Points | Assignee |
|---|---------|--------------|----------|
| 4.1 | Mobile Navigation (Bottom Tabs statt Sidebar) | 5 | - |
| 4.2 | Touch-optimierte Chat-Eingabe | 3 | - |
| 4.3 | Swipe-Gesten für Chat-Actions | 3 | - |
| 4.4 | Responsive Layout für alle Screen-Größen | 5 | - |
| 4.5 | Dark Mode für Android System-Theme | 2 | - |
| 4.6 | Haptic Feedback bei wichtigen Actions | 2 | - |
| 4.7 | Onboarding für Android-Nutzer | 3 | - |
| 4.8 | QR-Code Scanner für Contact-Adding | 3 | - |

#### Definition of Done:
- [ ] Navigation funktioniert auf 5"-Screens
- [ ] Chat-View ist touch-optimiert
- [ ] Swipe-Actions funktionieren flüssig
- [ ] App sieht auf allen Gerätegrößen gut aus
- [ ] Dark Mode folgt System-Einstellung
- [ ] Haptic Feedback bei Senden/Empfangen
- [ ] Onboarding erklärt i2pd-Installation
- [ ] QR-Code kann gescannt werden

#### Risiken:
- **Risiko:** shadcn/ui Komponenten nicht mobile-optimiert
  - **Mitigation:** Custom Mobile-Komponenten oder native Android UI für kritische Flows

---

### Sprint 5: Background Processing & Notifications (Woche 9-10)

**Ziel:** App empfängt Nachrichten im Hintergrund

#### Aufgaben:

| # | Aufgabe | Story Points | Assignee |
|---|---------|--------------|----------|
| 5.1 | Capacitor Background Mode Plugin | 3 | - |
| 5.2 | Background I2P Connection halten | 5 | - |
| 5.3 | Local Notifications für neue Messages | 5 | - |
| 5.4 | Notification Tapping öffnet Chat | 2 | - |
| 5.5 | Battery Optimization Whitelist | 2 | - |
| 5.6 | Foreground Service für I2P | 3 | - |
| 5.7 | Badge Count für ungelesene Messages | 2 | - |
| 5.8 | Doze Mode Handling | 3 | - |

#### Definition of Done:
- [ ] App läuft im Hintergrund
- [ ] Neue Nachrichten trigger Notifications
- [ ] Notification öffnet korrekten Chat
- [ ] App ist in Battery Optimization Whitelist
- [ ] Badge Count zeigt ungelesene Messages
- [ ] Nachrichten werden auch nach Doze empfangen

#### Risiken:
- **Risiko:** Android killt Background-Service aggressiv
  - **Mitigation:** Foreground Service, Battery Optimization Whitelist, WorkManager für Polling-Fallback
- **Risiko:** Background I2P verbraucht zu viel Batterie
  - **Mitigation:** Konfigurierbare Polling-Intervalle, Smart Background Mode

---

### Optional: Sprint 6 - Polish & Release (Woche 11-12)

**Ziel:** Produktionsreife App für Play Store / F-Droid

#### Aufgaben:

| # | Aufgabe | Story Points | Assignee |
|---|---------|--------------|----------|
| 6.1 | App Signing für Release | 2 | - |
| 6.2 | Play Store Listing erstellen | 3 | - |
| 6.3 | F-Droid Metadata erstellen | 3 | - |
| 6.4 | Beta-Testing mit geschlossener Gruppe | 5 | - |
| 6.5 | Performance-Optimierung | 3 | - |
| 6.6 | Crashlytics Integration | 2 | - |
| 6.7 | App-Update Mechanismus | 3 | - |
| 6.8 | Finaler Release-Build | 2 | - |

#### Definition of Done:
- [ ] Release-signed APK/AAB vorhanden
- [ ] Play Store Listing vorbereitet
- [ ] F-Droid Metadaten erstellt
- [ ] Beta-Testing abgeschlossen
- [ ] Keine kritischen Crashes
- [ ] Update-Mechanismus funktioniert

---

## 3. Branch-Strategie

```
main
  │
  ├── feature/android-port (Integration Branch)
  │     │
  │     ├── feature/capacitor-setup
  │     ├── feature/android-storage
  │     ├── feature/i2p-android
  │     ├── feature/mobile-ui
  │     └── feature/background-notifications
  │
  └── develop
```

### Workflow:
1. **Feature Branches** von `feature/android-port` erstellen
2. **Pull Requests** für jeden Sprint-Abschnitt
3. **Sprint Review** am Ende jedes Sprints
4. **Merge** nach `feature/android-port` nach Review
5. **Finaler Merge** nach `main` nach Abschluss aller Sprints

### Naming Convention:
- Branches: `feature/android-{sprint}-{kurzbeschreibung}`
- Commits: `android: {beschreibung}` Prefix

---

## 4. Technische Spezifikation

### 4.1 Capacitor Konfiguration

```typescript
// capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.secuchat.app',
  appName: 'SecuChat',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true, // Für localhost WebSocket
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      releaseType: 'APK',
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#000000',
    },
  },
};

export default config;
```

### 4.2 Benötigte Capacitor Plugins

```json
{
  "@capacitor/app": "^6.0.0",
  "@capacitor/preferences": "^6.0.0",
  "@capacitor/filesystem": "^6.0.0",
  "@capacitor/local-notifications": "^6.0.0",
  "@capacitor/splash-screen": "^6.0.0",
  "@capacitor/status-bar": "^6.0.0",
  "@capacitor/clipboard": "^6.0.0",
  "@capacitor/share": "^6.0.0",
  "capacitor-plugin-safe-area": "^3.0.0",
  "@capacitor-community/keep-awake": "^4.0.0"
}
```

### 4.3 AndroidManifest.xml Anpassungen

```xml
<!-- Wichtige Permissions -->
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />

<!-- Für lokale Dateien/Backups -->
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" 
    android:maxSdkVersion="32" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
    android:maxSdkVersion="32" />
```

### 4.4 i2pd-Integration

```typescript
// services/i2pAndroid.ts
import { App } from '@capacitor/app';

export class I2PAndroidService {
  async checkI2PDInstalled(): Promise<boolean> {
    try {
      await App.openUrl({ url: 'i2pd://check' });
      return true;
    } catch {
      return false;
    }
  }

  async openI2PD(): Promise<void> {
    await App.openUrl({ 
      url: 'market://details?id=org.purplei2p.i2pd' 
    });
  }
}
```

---

## 5. Risiken und Mitigationen

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|--------|-------------------|--------|------------|
| **WebView hat keine IndexedDB** | Niedrig | Hoch | localStorage-Fallback bereits implementiert, Capacitor Preferences als Backup |
| **i2pd Android unterstützt SAM nicht** | Mittel | Hoch | i2pd-Build mit SAM-Bridge verwenden, alternativ eigener SAM-Proxy in Capacitor |
| **Background-Service wird gekillt** | Hoch | Mittel | Foreground Service, Battery Whitelist, WorkManager Polling |
| **WebSocket zu i2pd blockiert** | Niedrig | Hoch | Cleartext Traffic für localhost erlauben, Network Security Config |
| **UI nicht touch-freundlich** | Mittel | Mittel | Progressive Enhancement, native Bottom Navigation |
| **Datei-Export/Import funktioniert nicht** | Niedrig | Mittel | Capacitor Filesystem API, Share Sheet Integration |
| **App Store rejected** | Mittel | Mittel | Keine verbotenen APIs, korrekte Permissions erklären |
| **i18n nicht korrekt geladen** | Niedrig | Mittel | Static imports statt dynamic loading, Capacitor HTTP Plugin |

---

## 6. Definition of Done (Global)

Eine User Story gilt als fertig wenn:

- [ ] Code ist implementiert und reviewed
- [ ] Tests passieren (Unit + Integration)
- [ ] Auf Android Emulator (API 28, 33, 34) getestet
- [ ] Auf physischem Android-Gerät getestet
- [ ] Keine Konsole-Fehler in WebView
- [ ] Lighthouse Mobile Score > 80
- [ ] Dokumentation aktualisiert
- [ ] Keine neuen Security-Issues eingeführt
- [ ] i18n Strings vorhanden (de/en)

---

## 7. Sprint-Review Checklist

### Sprint 1:
- [ ] APK-Build erfolgreich
- [ ] App startet ohne Crash
- [ ] React-UI wird angezeigt

### Sprint 2:
- [ ] Settings persistieren nach App-Restart
- [ ] Backup funktioniert
- [ ] Permissions korrekt angefordert

### Sprint 3:
- [ ] i2pd Detection funktioniert
- [ ] SAM Verbindung aufgebaut
- [ ] Messages können gesendet/empfangen werden

### Sprint 4:
- [ ] Navigation ist touch-freundlich
- [ ] Alle Flows auf 5"-Screen nutzbar
- [ ] QR-Code Scanning funktioniert

### Sprint 5:
- [ ] Notifications werden angezeigt
- [ ] App empfängt im Hintergrund
- [ ] Battery Impact akzeptabel

---

## 8. Anhänge

### A. Build-Befehle

```bash
# Development
npm run dev                    # Vite Dev Server
npx cap open android          # Android Studio öffnen
npx cap run android           # Auf Gerät/Emulator starten

# Production
npm run build                 # Web-Build
npx cap sync android          # Capacitor sync
npx cap build android         # APK/AAB Build
```

### B. Test-Geräte

| Gerät | Android Version | Priorität |
|-------|-----------------|-----------|
| Pixel 7 Emulator | API 34 (Android 14) | Hoch |
| Pixel 4 Emulator | API 30 (Android 11) | Hoch |
| Samsung Galaxy A53 | API 33 (Android 13) | Mittel |
| Xiaomi Redmi Note | API 28 (Android 9) | Mittel |
| Tablet (10") | API 30+ | Niedrig |

### C. Nützliche Ressourcen

- [Capacitor Docs](https://capacitorjs.com/docs)
- [Android WebView Docs](https://developer.chrome.com/docs/multidevice/webview/)
- [i2pd Android GitHub](https://github.com/PurpleI2P/i2pd-android)
- [SAM v3.1 Spec](https://geti2p.net/en/docs/api/samv3)

---

**Dokument erstellt:** 2025-03-09  
**Letzte Aktualisierung:** 2025-03-09  
**Autor:** Subagent Sprint Planning  
**Status:** Draft - Bereit für Review
