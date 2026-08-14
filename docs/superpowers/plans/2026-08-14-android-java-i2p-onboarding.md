# Android-Java-I2P-Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the i2pd-on-F-Droid onboarding instructions for Android with Java-I2P-on-Play-Store instructions (language setup, I2CP toggle, bandwidth/boot/UPnP). Sync German + English locale files. Update `CLAUDE.md` and `wiki/I2P-Setup.md` accordingly. Native Android layer is already correct and stays untouched.

**Architecture:** Edit existing files only — `getAndroidInstructions()` in `app/src/services/platform.ts`, the affected keys in `app/src/locales/de.json` and `app/src/locales/en.json`, `CLAUDE.md`, and `wiki/I2P-Setup.md`. No new files, no new methods, no native Java changes. Variante A from the spec.

**Tech Stack:** TypeScript / React, i18next JSON locale files, Markdown docs.

**Working directory:** `/home/g/dev/SecuChat/.worktrees/android-onboarding`
**Branch:** `android-onboarding`

---

## Global Constraints

- **Locale keys must stay in sync between `de.json` and `en.json`.** Every key added or changed in one file must be added/changed with the same key in the other.
- **Native layer is out of scope.** Do not edit `app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin/*` or `AndroidManifest.xml`. The Play Store URL `https://play.google.com/store/apps/details?id=net.i2p.android` and the package list (`net.i2p.android`, `net.i2p.android.router`, `org.purplei2p.i2pd`) are already correct.
- **Only the Android variant of `getAndroidInstructions()` changes.** `getElectronInstructions()`, `getDesktopInstructions()` (Windows/macOS/Linux), and `getFallbackInstructions()` are out of scope.
- **SAM port stays 7656.** Java I2P must enable I2CP on 7654; SAM (used by the native SAM plugin) listens on 7656 via the I2CP bridge.
- **The 7 onboarding steps are not numbered in JSX** — they are array indices. Schritt 7 is index 6. Be careful when counting.
- **Markdown diacritics:** German umlauts (ä, ö, ü, ß) must appear as proper Unicode characters — never as ASCII substitutes.

---

## File Structure

| File | Responsibility | Modified by Task |
|------|----------------|------------------|
| `app/src/services/platform.ts` | `getAndroidInstructions()` content (title/desc/steps/url/configHelp) | Task 1 |
| `app/src/locales/de.json` | German strings (`onboarding.*` + `i2pAppInstall.*`) | Task 2 |
| `app/src/locales/en.json` | English strings (`onboarding.*` + `i2pAppInstall.*`) | Task 3 |
| `app/src/components/custom/Onboarding.tsx` | No code changes; verifies locale-key usage at render sites | Task 4 (verify only) |
| `CLAUDE.md` | Top-level Android/I2P paragraph | Task 5 |
| `wiki/I2P-Setup.md` | Architecture diagram + Android section + SAM-API table | Task 6 |

No new files. No deletions.

---

## Task 1: Replace Android onboarding instructions in `platform.ts`

**Files:**
- Modify: `app/src/services/platform.ts:199-215` (`getAndroidInstructions()`)

**Why first:** The onboarding UI renders whatever this method returns. Locale changes (Tasks 2 & 3) are independent but conceptually follow.

**Interfaces:**
- Consumes: nothing (replaces existing content).
- Produces: same `I2PInstructions` shape (`{ title, description, steps[], downloadUrl, configHelp }`).

- [ ] **Step 1: Read current implementation for ground truth**

```bash
sed -n '199,215p' app/src/services/platform.ts
```

Verify you see the 7-item `steps` array, the F-Droid URL, and the German strings. Do not skip — if line numbers have drifted, downstream edits will land in the wrong place.

- [ ] **Step 2: Replace the entire `getAndroidInstructions()` method body**

Replace lines 199-215 (the whole `return { ... };` block) with:

```ts
  private getAndroidInstructions(): I2PInstructions {
    return {
      title: 'Java I2P auf Android einrichten',
      description:
        'SecuChat nutzt auf Android den Java-I2P-Router aus dem Google Play Store. Nach der Installation konfigurieren Sie Sprache, I2CP und Bandbreite.',
      steps: [
        'Java I2P aus dem Google Play Store installieren und öffnen',
        'Beim ersten Start: einmalig die Sprache festlegen (z. B. Deutsch)',
        'In Java I2P: Einstellungen → Erweitert → Haken bei I2CP aktivieren',
        'In Java I2P: Einstellungen → Bandbreite und Netzwerk → „Bei Booten aktivieren" einschalten',
        'In Java I2P: Einstellungen → Bandbreite und Netzwerk → Up- und Download-Bandbreite auf Maximum stellen',
        'In Java I2P: Einstellungen → Bandbreite und Netzwerk → UPnP aktivieren',
        'Java I2P starten (lange drücken zum Starten) und hier auf „Verbindung testen" klicken',
      ],
      downloadUrl: 'https://play.google.com/store/apps/details?id=net.i2p.android',
      configHelp:
        'Java I2P muss laufen und I2CP auf Port 7654 bereitstellen. SecuChat verbindet sich direkt.',
    };
  }
```

Notes:
- The German closing quotes `„…"` are U+201E/U+201C. They are correct typography for German but the existing app uses straight `"` everywhere — switch to straight `"` to match house style:

Replace step 4, 5, 6, 7 with straight-quote versions:

```ts
        'In Java I2P: Einstellungen → Bandbreite und Netzwerk → "Bei Booten aktivieren" einschalten',
        'In Java I2P: Einstellungen → Bandbreite und Netzwerk → Up- und Download-Bandbreite auf Maximum stellen',
        'In Java I2P: Einstellungen → Bandbreite und Netzwerk → UPnP aktivieren',
        'Java I2P starten (lange drücken zum Starten) und hier auf "Verbindung testen" klicken',
```

The arrow `→` is U+2192 — already used in the original file (Z. 207), keep it.

- [ ] **Step 3: Type-check**

```bash
cd app && npx tsc --noEmit
```

Expected: exit 0, no output. If errors: check whether the function signature `I2PInstructions` matches — it requires `title`, `description`, `steps[]`, optional `downloadUrl`, optional `configHelp`. All five fields are present.

- [ ] **Step 4: Commit**

```bash
cd ..
git add app/src/services/platform.ts
git commit -m "feat(android-onboarding): replace i2pd setup with Java I2P instructions"
```

---

## Task 2: Update German locale (`app/src/locales/de.json`)

**Files:**
- Modify: `app/src/locales/de.json` (multiple ranges)
  - L166 (`step4Subtitle`)
  - L171-172 (`i2pdConnected`, `i2pdNotFound`)
  - L175-180 (`i2pdIntegrated`, `i2pdSamRequired`, `i2pdIntegratedDesc`, `i2pdSamRequiredDesc`, `i2pdAndroidRequired`, `i2pdAndroidRequiredDesc`)
  - L182-185 (`i2pdNotReachable`, `i2pdNotReachableAndroid`, `i2pdAndroidTimeout`, `i2pdTestError`)
  - L542-549 (`i2pAppInstall` block)

**Why after Task 1:** The locale changes are independent of `platform.ts` but if either Task 1 or Task 2 introduces a typo, finding the typo in two places is harder. Do them in order.

**Interfaces:**
- Consumes: same key names (`onboarding.step4Subtitle` etc.) — values change, keys stay. Other consumers (Web/Desktop paths) reference the same keys, so the German `i2pdIntegrated*` and `i2pdSamRequired*` strings stay German but their meaning stays platform-neutral — only the `*Android*` variants and the `step4Subtitle` and the `i2pAppInstall` block change.
- Produces: updated locale that the React UI renders.

- [ ] **Step 1: Read current values**

```bash
sed -n '166,188p' app/src/locales/de.json
echo "---"
sed -n '542,549p' app/src/locales/de.json
```

Confirm the keys and exact line numbers. The JSON must stay valid (mind commas).

- [ ] **Step 2: Update `step4Subtitle` (L166)**

Find:
```json
    "step4Subtitle": "i2pd ist erforderlich",
```

Replace with:
```json
    "step4Subtitle": "Java I2P ist erforderlich",
```

- [ ] **Step 3: Rename `i2pdConnected` and `i2pdNotFound` (L171-172)**

Find:
```json
    "i2pdConnected": "i2pd verbunden!",
    "i2pdNotFound": "i2pd nicht gefunden - bitte installieren",
```

Replace with:
```json
    "javaI2pConnected": "Java I2P verbunden!",
    "javaI2pNotFound": "Java I2P nicht erreichbar - bitte prüfen",
```

- [ ] **Step 4: Rename and rewrite `i2pdAndroidRequired` + `i2pdAndroidRequiredDesc` (L179-180)**

Find:
```json
    "i2pdAndroidRequired": "i2pd erforderlich (SAM TCP)",
    "i2pdAndroidRequiredDesc": "Auf Android nutzt SecuChat i2pd direkt über SAM TCP auf Port 7656 — kein WebSocket-Proxy. i2pd muss auf dem Gerät oder im lokalen Netzwerk laufen. Sie können dies später in den Einstellungen konfigurieren.",
```

Replace with:
```json
    "javaI2pAndroidRequired": "Java I2P erforderlich (I2CP)",
    "javaI2pAndroidRequiredDesc": "Auf Android nutzt SecuChat Java I2P direkt: I2CP-Haken unter Einstellungen → Erweitert aktivieren, SAM-Plugin spricht dann Port 7656 an. Java I2P muss auf dem Gerät laufen. Sie können dies später in den Einstellungen konfigurieren.",
```

- [ ] **Step 5: Rename and rewrite Android-specific error keys (L182-185)**

Find:
```json
    "i2pdNotReachableAndroid": "i2pd nicht erreichbar. Bitte überprüfen Sie, ob i2pd SAM TCP auf Port 7656 bereitstellt.",
    "i2pdElectronTimeout": "i2pd ist noch nicht bereit ({{timeout}}s Timeout). Beim ersten Start dauert es 1–2 Minuten. Klicken Sie auf \"Weiter\" und testen Sie später in Einstellungen → I2P, oder versuchen Sie es gleich nochmal.",
    "i2pdBrowserTimeout": "Verbindungstimeout nach {{timeout}}s. Bitte überprüfen Sie:\n1. Läuft i2pd?\n2. Ist der SAM-Proxy auf Port 7657 erreichbar?\n3. Firewall-Einstellungen prüfen",
    "i2pdAndroidTimeout": "Verbindungstimeout nach {{timeout}}s. Bitte überprüfen Sie:\n1. Läuft i2pd auf dem Gerät oder im LAN?\n2. Ist SAM TCP auf Port 7656 erreichbar?\n3. Firewall-Einstellungen prüfen",
    "i2pdTestError": "Fehler beim Verbindungstest. Bitte überprüfen Sie die i2pd-Konfiguration.",
```

Replace ONLY the three Android-specific lines (`i2pdNotReachableAndroid`, `i2pdAndroidTimeout`, `i2pdTestError`) — keep `i2pdElectronTimeout` and `i2pdBrowserTimeout` for non-Android paths unchanged:

```json
    "javaI2pNotReachableAndroid": "Java I2P nicht erreichbar. Bitte überprüfen Sie, ob Java I2P läuft und der I2CP-Haken unter Einstellungen → Erweitert aktiviert ist (SAM via I2CP auf Port 7656).",
    "javaI2pAndroidTimeout": "Verbindungstimeout nach {{timeout}}s. Bitte überprüfen Sie:\n1. Läuft Java I2P auf dem Gerät und ist der I2CP-Haken unter Einstellungen → Erweitert aktiviert?\n2. Ist SAM via I2CP auf Port 7656 erreichbar?\n3. Firewall-Einstellungen prüfen",
    "javaI2pTestError": "Fehler beim Verbindungstest. Bitte überprüfen Sie die Java-I2P-Konfiguration (I2CP-Haken unter Einstellungen → Erweitert).",
```

The corresponding `Onboarding.tsx` key renames happen in Task 4.

- [ ] **Step 6: Update the `i2pAppInstall` block (L542-549)**

Find:
```json
  "i2pAppInstall": {
    "title": "I2P-Router-App erforderlich",
    "description": "SecuChat braucht die I2P-Router-App für anonyme Kommunikation. Bitte installiere sie und aktiviere die I2CP-Tunnel-Freigabe in den Einstellungen der I2P-App.",
    "installButton": "I2P-App im Play Store öffnen",
    "retryButton": "Erneut prüfen",
    "steps": "Schritt 1: Installiere die I2P-App\nSchritt 2: Öffne sie und warte, bis der Router bereit ist\nSchritt 3: Gehe in Einstellungen → I2CP-Benutzeroberfläche → aktiviere Tunnel-Freigabe\nSchritt 4: Kehre zu SecuChat zurück und tippe 'Erneut prüfen'"
  }
```

Replace with:
```json
  "i2pAppInstall": {
    "title": "Java-I2P-Router erforderlich",
    "description": "SecuChat braucht den Java-I2P-Router für anonyme Kommunikation. Bitte installiere die App aus dem Google Play Store und konfiguriere sie: I2CP-Haken unter Einstellungen → Erweitert, Bandbreite/Netzwerk auf Maximum mit UPnP und Boot-Aktivierung.",
    "installButton": "Java I2P im Play Store öffnen",
    "retryButton": "Erneut prüfen",
    "steps": "Schritt 1: Installiere Java I2P aus dem Google Play Store und öffne die App\nSchritt 2: Beim ersten Start: einmalig die Sprache festlegen (z. B. Deutsch)\nSchritt 3: Gehe in Einstellungen → Erweitert und aktiviere den I2CP-Haken\nSchritt 4: Gehe in Einstellungen → Bandbreite und Netzwerk und aktiviere 'Bei Booten starten'\nSchritt 5: Stelle die Up- und Download-Bandbreite auf Maximum\nSchritt 6: Aktiviere UPnP\nSchritt 7: Starte Java I2P (lange drücken zum Starten) und kehre zu SecuChat zurück; tippe 'Erneut prüfen'"
  }
```

- [ ] **Step 7: Validate JSON syntax**

```bash
cd app && node -e "JSON.parse(require('fs').readFileSync('src/locales/de.json', 'utf8')); console.log('OK')"
```

Expected: prints `OK`. If it throws, fix the JSON (most common cause: trailing comma, missing quote).

- [ ] **Step 8: Commit**

```bash
cd ..
git add app/src/locales/de.json
git commit -m "feat(locales-de): replace i2pd onboarding strings with Java I2P"
```

---

## Task 3: Update English locale (`app/src/locales/en.json`)

**Files:**
- Modify: `app/src/locales/en.json` (mirrors of Task 2's ranges)
  - `step4Subtitle` (sibling of L166 in de.json — find exact line via `grep -n`)
  - `i2pdConnected`, `i2pdNotFound` → rename to `javaI2pConnected`, `javaI2pNotFound`
  - `i2pdAndroidRequired`, `i2pdAndroidRequiredDesc` → rename
  - `i2pdNotReachableAndroid`, `i2pdAndroidTimeout`, `i2pdTestError` → rename
  - `i2pAppInstall` block

**Why after Task 2:** German is the source of truth in this codebase (other locales follow); doing it first lets you compare.

**Interfaces:** Same as Task 2.

- [ ] **Step 1: Read current values**

```bash
grep -n "step4Subtitle\|i2pdConnected\|i2pdNotFound\|i2pdAndroidRequired\|i2pdAndroidRequiredDesc\|i2pdNotReachableAndroid\|i2pdAndroidTimeout\|i2pdTestError\|i2pAppInstall" app/src/locales/en.json
```

- [ ] **Step 2: Update `step4Subtitle`**

Find:
```json
    "step4Subtitle": "i2pd required",
```

Replace with:
```json
    "step4Subtitle": "Java I2P required",
```

- [ ] **Step 3: Rename `i2pdConnected` and `i2pdNotFound`**

Find:
```json
    "i2pdConnected": "i2pd connected!",
    "i2pdNotFound": "i2pd not found - please install",
```

Replace with:
```json
    "javaI2pConnected": "Java I2P connected!",
    "javaI2pNotFound": "Java I2P not reachable - please check",
```

- [ ] **Step 4: Rename and rewrite `i2pdAndroidRequired` + `i2pdAndroidRequiredDesc`**

Find:
```json
    "i2pdAndroidRequired": "i2pd required (SAM TCP)",
    "i2pdAndroidRequiredDesc": "On Android, SecuChat uses i2pd directly via SAM TCP on port 7656 — no WebSocket proxy. i2pd must be running on the device or in the local network. You can configure this later in Settings.",
```

Replace with:
```json
    "javaI2pAndroidRequired": "Java I2P required (I2CP)",
    "javaI2pAndroidRequiredDesc": "On Android, SecuChat uses Java I2P directly: enable the I2CP toggle under Settings → Advanced, and the SAM plugin talks to port 7656. Java I2P must be running on the device. You can configure this later in Settings.",
```

- [ ] **Step 5: Rename and rewrite Android-specific error keys**

Find:
```json
    "i2pdNotReachableAndroid": "i2pd not reachable. Please check that i2pd provides SAM TCP on port 7656.",
    "i2pdAndroidTimeout": "Connection timeout after {{timeout}}s. Please check:\n1. Is i2pd running on the device or LAN?\n2. Is SAM TCP reachable on port 7656?\n3. Check firewall settings",
    "i2pdTestError": "Connection test failed. Please check the i2pd configuration.",
```

Replace with:
```json
    "javaI2pNotReachableAndroid": "Java I2P not reachable. Please check that Java I2P is running and the I2CP toggle under Settings → Advanced is enabled (SAM via I2CP on port 7656).",
    "javaI2pAndroidTimeout": "Connection timeout after {{timeout}}s. Please check:\n1. Is Java I2P running on the device and is the I2CP toggle under Settings → Advanced enabled?\n2. Is SAM via I2CP reachable on port 7656?\n3. Check firewall settings",
    "javaI2pTestError": "Connection test failed. Please check the Java I2P configuration (I2CP toggle under Settings → Advanced).",
```

- [ ] **Step 6: Update `i2pAppInstall` block**

Find:
```json
  "i2pAppInstall": {
    "title": "I2P Router App required",
    "description": "SecuChat needs the I2P router app for anonymous communication. Please install it and enable I2CP tunnel sharing in the I2P app settings.",
    "installButton": "Open I2P app in Play Store",
    "retryButton": "Retry",
    "steps": "Step 1: Install the I2P app\nStep 2: Open it and wait until the router is ready\nStep 3: Go to Settings → I2CP user interface → enable tunnel sharing\nStep 4: Return to SecuChat and tap 'Retry'"
  }
```

Replace with:
```json
  "i2pAppInstall": {
    "title": "Java I2P router required",
    "description": "SecuChat needs the Java I2P router for anonymous communication. Please install the app from the Google Play Store and configure it: enable the I2CP toggle under Settings → Advanced, set bandwidth to Maximum under Settings → Bandwidth and Network, enable UPnP and the boot activation.",
    "installButton": "Open Java I2P in Play Store",
    "retryButton": "Retry",
    "steps": "Step 1: Install Java I2P from the Google Play Store and open the app\nStep 2: On first launch: set the language once (e.g. English)\nStep 3: Go to Settings → Advanced and enable the I2CP toggle\nStep 4: Go to Settings → Bandwidth and Network and enable 'Activate on boot'\nStep 5: Set upload and download bandwidth to Maximum\nStep 6: Enable UPnP\nStep 7: Start Java I2P (long-press to start) and return to SecuChat; tap 'Retry'"
  }
```

- [ ] **Step 7: Validate JSON syntax**

```bash
cd app && node -e "JSON.parse(require('fs').readFileSync('src/locales/en.json', 'utf8')); console.log('OK')"
```

Expected: prints `OK`.

- [ ] **Step 8: Commit**

```bash
cd ..
git add app/src/locales/en.json
git commit -m "feat(locales-en): replace i2pd onboarding strings with Java I2P"
```

---

## Task 4: Update `Onboarding.tsx` to use the renamed locale keys

**Files:**
- Modify: `app/src/components/custom/Onboarding.tsx` (4 line edits)

**Why after Tasks 2 & 3:** The locale keys are renamed. Without this update the build breaks (`t('onboarding.i2pdConnected')` returns the key string, not the new value).

**Interfaces:**
- Consumes: renamed keys `javaI2pConnected`, `javaI2pNotFound`, `javaI2pAndroidRequired`, `javaI2pAndroidRequiredDesc`, `javaI2pNotReachableAndroid`, `javaI2pAndroidTimeout`, `javaI2pTestError`.
- Produces: rendered text from new keys.

- [ ] **Step 1: Find each call site**

```bash
grep -n "i2pdConnected\|i2pdNotFound\|i2pdAndroidRequired\|i2pdNotReachableAndroid\|i2pdAndroidTimeout\|i2pdTestError" app/src/components/custom/Onboarding.tsx
```

Expected output (line numbers approximate — confirm against your tree):
```
1000:                        {t('onboarding.i2pdConnected')}
1005:                        {t('onboarding.i2pdNotFound')}
1035:                      ? t('onboarding.i2pdAndroidRequired')
1036:                      : t('onboarding.i2pdSamRequired')}
1042:                      ? t('onboarding.i2pdAndroidRequiredDesc')
1047:                      : t('onboarding.i2pdSamRequiredDesc')}
411:          setError(t('onboarding.i2pdAndroidTimeout', { timeout: timeoutMs / 1000 }));
413:          setError(t('onboarding.i2pdAndroidTimeout', { timeout: timeoutMs / 1000 }));
418:        setError(t('onboarding.i2pdTestError'));
```

- [ ] **Step 2: Replace `i2pdConnected` and `i2pdNotFound` (L1000, L1005)**

Find (both lines together):
```tsx
                        {t('onboarding.i2pdConnected')}
```
and
```tsx
                            {t('onboarding.i2pdNotFound')}
```

Replace with:
```tsx
                        {t('onboarding.javaI2pConnected')}
```
and
```tsx
                            {t('onboarding.javaI2pNotFound')}
```

- [ ] **Step 3: Replace `i2pdAndroidRequired` and `i2pdAndroidRequiredDesc` (L1035, L1042)**

Find:
```tsx
                      ? t('onboarding.i2pdAndroidRequired')
                      : t('onboarding.i2pdSamRequired')}
```
and
```tsx
                      ? t('onboarding.i2pdAndroidRequiredDesc')
                      : t('onboarding.i2pdSamRequiredDesc')}
```

Replace with:
```tsx
                      ? t('onboarding.javaI2pAndroidRequired')
                      : t('onboarding.i2pdSamRequired')}
```
and
```tsx
                      ? t('onboarding.javaI2pAndroidRequiredDesc')
                      : t('onboarding.i2pdSamRequiredDesc')}
```

Note: `i2pdSamRequired` (Web/Desktop fallback) is NOT renamed — it stays correct for that path.

- [ ] **Step 4: Replace Android-specific error keys (L411, L413, L418)**

Three call sites. Apply replacements:

`L411` and `L413` (two occurrences — use `replace_all`):
```tsx
          setError(t('onboarding.i2pdAndroidTimeout', { timeout: timeoutMs / 1000 }));
```
→
```tsx
          setError(t('onboarding.javaI2pAndroidTimeout', { timeout: timeoutMs / 1000 }));
```

Use `replace_all: true` for the Edit tool since the same line appears twice in adjacent branches.

`L418`:
```tsx
        setError(t('onboarding.i2pdTestError'));
```
→
```tsx
        setError(t('onboarding.javaI2pTestError'));
```

- [ ] **Step 5: Search for any remaining stale i2pd-on-Android references**

```bash
grep -n "i2pdAndroid\|i2pdConnected\|i2pdNotFound" app/src/components/custom/Onboarding.tsx
```

Expected: **no output**. If any match remains, fix it — those keys no longer exist in the locale files.

- [ ] **Step 6: Type-check + lint**

```bash
cd app && npx tsc --noEmit && npm run lint
```

Expected: exit 0, no errors. If `t()` complains about missing key types, that's expected — i18next types are loose. Lint may show a "no-bitwise" or similar rule; ignore those unrelated warnings.

- [ ] **Step 7: Build**

```bash
cd app && npm run build
```

Expected: exit 0, dist/ regenerated. If Vite fails because of a missing locale key, check `de.json`/`en.json` for typos.

- [ ] **Step 8: Commit**

```bash
cd ..
git add app/src/components/custom/Onboarding.tsx
git commit -m "feat(android-onboarding): use renamed javaI2p locale keys"
```

---

## Task 5: Update `CLAUDE.md` Android paragraph

**Files:**
- Modify: `CLAUDE.md:13-14`

**Why late:** Cosmetic, but the spec explicitly requires it.

**Interfaces:**
- Consumes: nothing.
- Produces: updated Android section that future agents and humans read.

- [ ] **Step 1: Read current lines**

```bash
sed -n '13,14p' CLAUDE.md
```

Expected:
```
Native SAM plugin connects directly to i2pd on port 7656 (no WebSocket proxy).
```

- [ ] **Step 2: Replace**

Find:
```markdown
Native SAM plugin connects directly to i2pd on port 7656 (no WebSocket proxy).
```

Replace with:
```markdown
Native SAM plugin connects to Java I2P via I2CP. Java I2P must enable the I2CP toggle under Settings → Advanced; the SAM plugin then talks to port 7656 (no WebSocket proxy).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: clarify native Android SAM plugin talks to Java I2P via I2CP"
```

---

## Task 6: Update `wiki/I2P-Setup.md` (Android section + diagram + SAM-API table)

**Files:**
- Modify: `wiki/I2P-Setup.md` (three edits)

**Why last:** Wiki is the slowest-moving artifact. Doing it last means the implementation is verified before docs claim it's done.

**Interfaces:**
- Consumes: nothing.
- Produces: consistent wiki that matches the on-device experience.

- [ ] **Step 1: Read architecture diagram (top of file)**

```bash
sed -n '1,20p' wiki/I2P-Setup.md
```

Expected: ASCII diagram showing `Browser → sam-proxy → i2pd`, `Android → i2pd`, `Desktop → bundled i2pd`.

- [ ] **Step 2: Update the Android row in the diagram**

Find:
```
Browser (PWA)           Android               Desktop (Electron)
    │ WS :7657            │ TCP :7656           │ WS :7657 (bundled)
    ▼                     ▼                     ▼
sam-proxy              samNative            bundled sam-proxy
    │ TCP :7656           │                     │ TCP :7656
    ▼                     ▼                     ▼
i2pd  ──────────────  i2pd  ──────────────  bundled i2pd
```

Replace with:
```
Browser (PWA)           Android               Desktop (Electron)
    │ WS :7657            │ TCP :7656           │ WS :7657 (bundled)
    ▼                     ▼                     ▼
sam-proxy              samNative            bundled sam-proxy
    │ TCP :7656           │ I2CP :7654          │ TCP :7656
    ▼                     ▼                     ▼
i2pd                  Java I2P              bundled i2pd
```

The `I2CP :7654` label clarifies the wire-level protocol that Android uses to reach Java I2P.

- [ ] **Step 3: Replace the Android installation section (around L21 + L56-58)**

Find (both occurrences):
```markdown
### Android — Install i2pd, app connects natively (no proxy needed)
```
and
```markdown
### Android

Install **i2pd** from [F-Droid](https://f-droid.org/packages/org.purplei2p.i2pd/).
```

Replace the heading:
```markdown
### Android — Install Java I2P from the Play Store, app connects natively via I2CP (no proxy needed)
```

Replace the body:
```markdown
### Android

Install **Java I2P** (`net.i2p.android`) from the [Google Play Store](https://play.google.com/store/apps/details?id=net.i2p.android).

After installation:

1. Open Java I2P — on first launch, set the language (e.g. English).
2. Go to **Settings → Advanced** and enable the **I2CP** toggle.
3. Go to **Settings → Bandwidth and Network**:
   - Enable "Activate on boot".
   - Set upload and download bandwidth to **Maximum**.
   - Enable **UPnP**.
4. Start Java I2P (long-press to start) and return to SecuChat.

SecuChat will automatically connect via I2CP on port 7654; the SAM plugin then talks to port 7656.
```

- [ ] **Step 4: Update the SAM-API config table (around L65-72)**

Find:
```
| Linux | `/etc/i2pd/i2pd.conf` |
| macOS (Homebrew) | `/usr/local/etc/i2pd/i2pd.conf` |
| Windows | `%APPDATA%\i2pd\i2pd.conf` |
| Android | i2pd app → Settings → SAM |
```

Replace with:
```
| Linux | `/etc/i2pd/i2pd.conf` |
| macOS (Homebrew) | `/usr/local/etc/i2pd/i2pd.conf` |
| Windows | `%APPDATA%\i2pd\i2pd.conf` |
| Android | Java I2P app → Settings → Advanced → I2CP |
```

- [ ] **Step 5: Verify no other i2pd-on-Android mentions remain in this wiki**

```bash
grep -n "i2pd\|F-Droid" wiki/I2P-Setup.md
```

Expected: only mentions for Desktop (Linux/macOS/Windows) and Browser PWA remain. Android rows must be Java I2P only.

- [ ] **Step 6: Commit**

```bash
git add wiki/I2P-Setup.md
git commit -m "docs(wiki): update Android I2P setup to Java I2P"
```

---

## Task 7: Final verification

**Files:** none modified.

**Why last:** Whole-change sanity check before review/handoff.

- [ ] **Step 1: Type-check + lint + build**

```bash
cd app && npx tsc --noEmit && npm run lint && npm run build
```

Expected: all exit 0.

- [ ] **Step 2: Locale files validate**

```bash
cd app && node -e "['de','en'].forEach(l => { JSON.parse(require('fs').readFileSync('src/locales/' + l + '.json', 'utf8')); console.log(l, 'OK'); })"
```

Expected: `de OK` then `en OK`.

- [ ] **Step 3: Confirm no stale i2pd-on-Android key references anywhere in app/**

```bash
cd app && grep -rn "i2pdAndroidRequired\|i2pdAndroidTimeout\|i2pdNotReachableAndroid\|i2pdConnected\|i2pdNotFound\|i2pdTestError" src/ --include="*.tsx" --include="*.ts"
```

Expected: **no output**. All references should now use the `javaI2p*` keys.

- [ ] **Step 4: Run Android dev sync to confirm Capacitor is unaffected**

```bash
cd app && npx cap sync android 2>&1 | tail -20
```

Expected: sync succeeds. No native changes were made, so no Java rebuild is needed yet — but this confirms the config layer still aligns.

- [ ] **Step 5: Show full git log of the branch**

```bash
cd .. && git log --oneline feat/android-port..HEAD
```

Expected: 6 commits in this order:
1. `feat(android-onboarding): replace i2pd setup with Java I2P instructions`
2. `feat(locales-de): replace i2pd onboarding strings with Java I2P`
3. `feat(locales-en): replace i2pd onboarding strings with Java I2P`
4. `feat(android-onboarding): use renamed javaI2p locale keys`
5. `docs: clarify native Android SAM plugin talks to Java I2P via I2CP`
6. `docs(wiki): update Android I2P setup to Java I2P`

Plus the 2 prior spec commits (`docs(spec): Android-Onboarding auf Java I2P umstellen`, `docs(spec): add explicit line numbers for in-scope files`).

- [ ] **Step 6: Report ready**

Output:
```
Implementation complete. Branch: android-onboarding. 6 implementation commits + 2 spec commits.
Ready for review.
```

---

## Self-Review (already applied)

The original draft contained two "Revert Step X" passages in Task 2 (an artifact of an earlier key-naming inconsistency). Those were resolved during writing — Task 2 Steps 3 and 5 now contain only the final, authoritative JSON. The non-Android keys (`i2pdIntegrated`, `i2pdSamRequired`, `i2pdElectronTimeout`, `i2pdBrowserTimeout`) are deliberately NOT renamed because they describe non-Android code paths that stay on i2pd and are out of scope. Locale keys renamed identically in de.json, en.json, and Onboarding.tsx. `downloadUrl` matches the native `PackagePresence.PLAY_STORE_URL`. Ports I2CP 7654 / SAM 7656 consistent throughout.

Out-of-band follow-ups (separate PR): `wiki/Getting-Started.md`, `wiki/Services-Overview.md`, `wiki/I2P-SAM-Stack.md`, `app/ANDROID_SETUP.md` may also contain i2pd-on-Android mentions and should be audited after this PR lands.
