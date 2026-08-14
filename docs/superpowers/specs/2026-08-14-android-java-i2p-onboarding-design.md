# Android-Onboarding auf Java I2P umstellen

**Datum:** 2026-08-14
**Branch:** `android-onboarding`
**Worktree:** `.worktrees/android-onboarding`
**Autor:** Superpowers Brainstorming

## Problem

Der Android-Onboarding-Schritt 4 ("I2P-Netzwerk") instruiert den User aktuell, **i2pd** über F-Droid zu installieren (`getAndroidInstructions()` in `app/src/services/platform.ts`). SecuChat nutzt auf Android inzwischen aber den **Java-I2P-Router** (`net.i2p.android` aus dem Play Store). Die Folge: User installieren i2pd, finden aber unter "Einstellungen → SAM → Aktivieren" nicht die korrekten Java-I2P-Menüpfade, und die SAM-Bridge liefert kein SAM, weil in Java I2P kein SAM, sondern **I2CP** als Schnittstelle aktiviert werden muss.

Der Native-Android-Layer (`PackagePresence.java`, `I2PPlugin.java`) prüft bereits korrekt auf `net.i2p.android`, `net.i2p.android.router` (F-Droid) und `org.purplei2p.i2pd` und nutzt die Play-Store-URL `https://play.google.com/store/apps/details?id=net.i2p.android`. Nur die **UI-Texte** im TypeScript- und i18n-Layer sind veraltet.

## Ziel

Android-User bekommen in Onboarding-Step 4 und im `I2PAppInstallModal` eine korrekte, vollständige Anleitung für den Java-I2P-Router. Andere Plattformen (Electron, Web-Desktop, Browser) bleiben unverändert.

## Scope

### In Scope

1. `app/src/services/platform.ts` — `getAndroidInstructions()`: Title, Description, Steps, Download-URL, configHelp auf Java I2P umschreiben.
2. `app/src/components/custom/Onboarding.tsx` — Anzeige-Texte der Status-Box (`i2pdAndroidRequired`, `i2pdAndroidRequiredDesc`) und des Verbindungstest-Buttons (`i2pdConnected`, `i2pdNotFound`) umbenennen auf "Java I2P".
3. `app/src/locales/de.json` und `app/src/locales/en.json` — Keys im Namespace `onboarding.*` und `i2pAppInstall.*` synchron anpassen.
4. `CLAUDE.md` — Passage "Native SAM plugin connects directly to i2pd on port 7656" auf Java I2P (I2CP auf 7654, SAM via Java I2P auf 7656) präzisieren.
5. `wiki/I2P-Setup.md` — Android-Abschnitt auf Java I2P umschreiben.

### Out of Scope

- `app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin/PackagePresence.java` und `I2PPlugin.java`: bereits korrekt, kein Eingriff.
- `app/android/app/src/main/AndroidManifest.xml` (intent-filter queries für `net.i2p.android` etc.): bereits korrekt.
- SAM-Plugin-Code (Capacitor, Java SAM-Sockets, Multi-Socket-Refactor): unverändert, Port 7656 bleibt.
- Electron-WebSocket-Proxy, `sam-proxy/`, `electron/src/i2p-manager.ts`: unverändert.
- Desktop-Variante (`getDesktopInstructions()` für Windows/macOS/Linux) und Fallback (`getFallbackInstructions()`): unverändert — Desktop-User behalten i2pd.
- Onboarding-Steps 1, 2, 3, 5: unverändert.
- Schlüsselgenerierung, Backup, Kontaktaustausch, QR-Scan, Lock-Flow: unverändert.

## Design-Entscheidungen

### Architektur: Variante A

`getAndroidInstructions()` in `platform.ts` wird direkt umgeschrieben. Keine neue Methode, keine neue Datei. Begründung: Es gibt nur eine Android-Variante; Web/Desktop teilen sich bereits denselben Funktionsrumpf, nur mit anderen Inhalten. YAGNI.

### Texte

#### `getAndroidInstructions()` (in `app/src/services/platform.ts`)

**Title**
- DE: "Java I2P auf Android einrichten"
- EN: "Set up Java I2P on Android"

**Description**
- DE: "SecuChat nutzt auf Android den Java-I2P-Router aus dem Google Play Store. Nach der Installation konfigurieren Sie Sprache, I2CP und Bandbreite."
- EN: "On Android, SecuChat uses the Java I2P router from the Google Play Store. After installation, configure language, I2CP and bandwidth."

**Steps (DE)** — Reihenfolge wie vom User bestätigt:
1. Java I2P aus dem Google Play Store installieren und öffnen
2. Beim ersten Start: einmalig die **Sprache** festlegen (z. B. Deutsch)
3. In Java I2P: **Einstellungen → Erweitert** → Haken bei **I2CP aktivieren**
4. In Java I2P: **Einstellungen → Bandbreite und Netzwerk** → „Bei Booten aktivieren" einschalten
5. In Java I2P: **Einstellungen → Bandbreite und Netzwerk** → Up- und Download-Bandbreite auf **Maximum** stellen
6. In Java I2P: **Einstellungen → Bandbreite und Netzwerk** → **UPnP aktivieren**
7. Java I2P starten (lange drücken zum Starten) und hier auf „Verbindung testen" klicken

**Steps (EN)** — wörtliche Übersetzung der DE-Liste, Pfade originalsprachlich (Java I2P ist englisch lokalisiert):
1. Install Java I2P from the Google Play Store and open it
2. On first launch: set the **language** once (e.g. English)
3. In Java I2P: **Settings → Advanced** → tick **Enable I2CP**
4. In Java I2P: **Settings → Bandwidth and Network** → enable "Activate on boot"
5. In Java I2P: **Settings → Bandwidth and Network** → set upload and download bandwidth to **Maximum**
6. In Java I2P: **Settings → Bandwidth and Network** → enable **UPnP**
7. Start Java I2P (long-press to start) and click "Test connection" here

**Download-URL**
- `https://play.google.com/store/apps/details?id=net.i2p.android` (bereits im Native-Layer verwendet, jetzt auch im TS-Layer)

**configHelp**
- DE: "Java I2P muss laufen und I2CP auf Port 7654 bereitstellen. SecuChat verbindet sich direkt."
- EN: "Java I2P must be running and provide I2CP on port 7654. SecuChat connects directly."

#### `i18n` Keys (`app/src/locales/de.json` + `en.json`)

| Key | DE (alt → neu) | EN (alt → neu) |
|---|---|---|
| `onboarding.step4Subtitle` | "i2pd ist erforderlich" → "Java I2P ist erforderlich" | "i2pd required" → "Java I2P required" |
| `onboarding.i2pdConnected` | "i2pd verbunden!" → "Java I2P verbunden!" | "i2pd connected!" → "Java I2P connected!" |
| `onboarding.i2pdNotFound` | "i2pd nicht gefunden - bitte installieren" → "Java I2P nicht erreichbar — bitte prüfen" | "i2pd not found — please install" → "Java I2P not reachable — please check" |
| `onboarding.i2pdAndroidRequired` | "i2pd erforderlich (SAM TCP)" → "Java I2P erforderlich (I2CP)" | "i2pd required (SAM TCP)" → "Java I2P required (I2CP)" |
| `onboarding.i2pdAndroidRequiredDesc` | "...i2pd direkt über SAM TCP auf Port 7656..." → "...Java I2P direkt: I2CP-Haken unter Einstellungen → Erweitert aktivieren, SAM-Plugin spricht dann Port 7656 an..." | "...i2pd directly via SAM TCP on port 7656..." → "...Java I2P directly: enable the I2CP toggle under Settings → Advanced, then the SAM plugin talks to port 7656..." |
| `onboarding.i2pdNotReachableAndroid` | "...i2pd SAM TCP auf Port 7656 bereitstellt." → "...Java I2P läuft und der I2CP-Haken unter Einstellungen → Erweitert aktiviert ist (SAM via I2CP auf Port 7656)." | "...i2pd provides SAM TCP on port 7656." → "...Java I2P is running and the I2CP toggle under Settings → Advanced is enabled (SAM via I2CP on port 7656)." |
| `onboarding.i2pdAndroidTimeout` | "...i2pd auf dem Gerät oder im LAN?..." → "...Java I2P auf dem Gerät läuft und der I2CP-Haken aktiviert ist?..." | "...i2pd on device or LAN?..." → "...Java I2P is running on device and the I2CP toggle is enabled?..." |
| `onboarding.i2pdTestError` | "...die i2pd-Konfiguration." → "...die Java-I2P-Konfiguration (I2CP-Haken unter Einstellungen → Erweitert)." | "...the i2pd configuration." → "...the Java I2P configuration (I2CP toggle under Settings → Advanced)." |
| `i2pAppInstall.title` | "I2P-Router-App erforderlich" → "Java-I2P-Router erforderlich" | "I2P Router App required" → "Java I2P router required" |
| `i2pAppInstall.description` | "...aktiviere die I2CP-Tunnel-Freigabe in den Einstellungen der I2P-App." → "...aktiviere unter Einstellungen → Erweitert den I2CP-Haken und unter Einstellungen → Bandbreite und Netzwerk den Boot-Haken, Bandbreite auf Maximum und UPnP." | "...enable I2CP tunnel sharing in the I2P app settings." → "...enable the I2CP toggle under Settings → Advanced and, under Settings → Bandwidth and Network, the boot toggle, set bandwidth to Maximum, and enable UPnP." |
| `i2pAppInstall.steps` | 4 Schritte (I2P-App installieren, öffnen, I2CP, Retry) → 7 Schritte (analog zu Steps oben, kompakter formuliert) | analog |

**Begründung für neue Texte:** Wo der User im Fehlerfall ohnehin auf die I2P-App schaut, müssen die Schritte konsistent sein. `i2pAppInstall.steps` darf nicht nur 3 Schritte zeigen, wenn die Hauptanleitung 7 verlangt.

### CLAUDE.md

Aktuell (Z. 13-14):
> Native SAM plugin connects directly to i2pd on port 7656 (no WebSocket proxy).

Neu:
> Native SAM plugin connects to the Java I2P router via I2CP. Java I2P must enable the I2CP toggle under Settings → Advanced; the SAM plugin then talks to port 7656 (no WebSocket proxy).

### wiki/I2P-Setup.md

Den Android-Abschnitt mit derselben Schritt-für-Schritt-Liste wie `getAndroidInstructions()` aktualisieren. Falls weitere Abschnitte i2pd-spezifisch sind, Cross-References prüfen.

## Risiken

- **Port-Diskrepanz:** I2CP läuft auf Port 7654, SAM auf 7656. User könnten glauben, sie müssten manuell einen Port einstellen. Texte adressieren das (configHelp + i2pdAndroidRequiredDesc).
- **Erstkonfiguration-Wizard:** Beim ersten Start zeigt Java I2P einen Wizard. Schritt 2 ("Sprache festlegen") muss klar als "während des Erststarts" markiert sein, sonst sucht der User sie in den Settings.
- **UI-Pfad-Unsicherheit:** Die exakten Menüpfade ("Einstellungen → Erweitert", "Bandbreite und Netzwerk") basieren auf plausiblen Übersetzungen. Wenn die Java-I2P-Lokalisierung anders lautet, müssen die Texte nachkorrigiert werden — dafür ist der `verification-before-completion`-Schritt im Plan vorgesehen.
- **Native `I2CP`-Toggle:** Die `PackagePresence.java` prüft nur, ob die App installiert ist, nicht ob I2CP aktiviert ist. Der Verbindungstest schlägt fehl, wenn I2CP aus ist. Aktueller Error-Pfad zeigt `i2pdAndroidRequiredDesc` — wird auf den neuen Text geändert, der klar sagt "I2CP-Haken aktiviert?".

## Tests / Verifikation

1. `cd app && npx tsc --noEmit` — TypeScript muss grün sein.
2. `cd app && npm run lint` — ESLint muss grün sein.
3. `cd app && npm run build` — Production-Build muss durchlaufen.
4. Android-Build: `cd app && npx cap sync android && cd android && ./gradlew assembleDebug`.
5. Manuelle Verifikation auf A50/A52/A54: Onboarding durchspielen, alle Texte müssen korrekt angezeigt werden, Verbindungstest muss gegen ein laufendes Java I2P grün werden.
6. `i2pAppInstall`-Modal: Verifikation, dass die 7-Schritt-Version korrekt dargestellt wird, wenn Java I2P nicht installiert ist.

## Out-of-Band-Folge-Arbeit (nicht im Plan)

- Falls `wiki/Getting-Started.md`, `wiki/Services-Overview.md` oder `wiki/I2P-SAM-Stack.md` ebenfalls i2pd-spezifische Android-Inhalte enthalten: nach Plan-Completion in einem Folge-PR anpassen.
- Falls `app/ANDROID_SETUP.md` Onboarding-Texte zitiert: synchron halten.
