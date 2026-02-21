# SecuChat - Fehleranalyse & Behebungsplan

## Kontext

SecuChat ist eine Privacy-fokussierte Messaging-App mit PGP-Verschlüsselung und I2P-Routing. Die umfassende Codebase-Analyse hat **58 Probleme** identifiziert: **7 kritisch, 12 hoch, 18 mittel, 7 niedrig**. Die schwerwiegendsten Probleme betreffen die Kernfunktion der App: Ende-zu-Ende-Verschlüsselung funktioniert nicht korrekt, und private Schlüssel werden ungeschützt gespeichert.

---

## Phase 1: KRITISCHE Fehler (Kernfunktionalität kaputt)

### 1.1 Nachrichten-Entschlüsselung funktioniert nicht
- **Datei:** `app/src/contexts/AppContext.tsx:213-223`
- **Problem:** Eingehende Nachrichten werden nie entschlüsselt. `message.decryptedContent` wird einfach auf `message.encryptedContent` gesetzt (Klartext-Kopie statt Entschlüsselung). Die Passphrase wird nach dem Login nicht gecacht, sodass `decryptMessage()` sie nie hat.
- **Auch betroffen:** `app/src/services/crypto.ts:102-125` - `decryptMessage()` braucht Passphrase als Parameter
- **Fix:** Passphrase nach erfolgreichem Login im Speicher cachen (z.B. via State oder SessionStorage). Alternativ: entschlüsselten Private Key im Speicher halten, sodass keine Passphrase mehr nötig ist.

### 1.2 SAM-Destination wird nicht persistiert
- **Datei:** `app/src/services/i2p.ts:84-89`
- **Problem:** Die SAM-Destination wird bei `generateDestination()` erzeugt, aber nur im Memory gehalten. Bei jedem App-Neustart entsteht eine neue I2P-Adresse, wodurch Kontakte den Nutzer nicht mehr erreichen können.
- **Fix:** Destination nach Generierung in IndexedDB speichern und beim Start wiederherstellen.

### 1.3 SAM-Session-Logik fehlerhaft
- **Datei:** `app/src/services/i2p.ts:92-94`
- **Problem:** Dead Code - beide Branches einer Bedingung setzen `sessionPrivKey = undefined`. Die Session nutzt daher immer `TRANSIENT`, obwohl sie die gespeicherte Identität verwenden sollte.
- **Fix:** `const sessionPrivKey = this.identity?.samDestination || undefined;` verwenden.

### 1.4 PGP Private Keys unverschlüsselt in IndexedDB
- **Datei:** `app/src/services/storage.ts`
- **Problem:** Alle Daten inkl. `pgpPrivateKey` liegen unverschlüsselt in IndexedDB. Jeder mit Browser-DevTools-Zugang kann alle Schlüssel und Nachrichten lesen. Das untergräbt das E2E-Versprechen komplett.
- **Fix:** IndexedDB-Inhalte mit einem von der Passphrase abgeleiteten Key (PBKDF2/Argon2) verschlüsseln, oder zumindest die Private Keys verschlüsselt speichern.

### 1.5 Backup enthält keine Nachrichten
- **Datei:** `app/src/services/storage.ts:398`
- **Problem:** `getMessagesByChatId('all')` sucht nach chatId='all', was nie existiert. Backups enthalten daher 0 Nachrichten.
- **Fix:** Eigene `getAllMessages()` Methode implementieren, die alle Nachrichten aus allen Chats sammelt.

### 1.6 SAM-Proxy TCP-Socket-Leak
- **Datei:** `sam-proxy/proxy.mjs:60-66`
- **Problem:** Bei TCP-Fehlern wird der Socket nicht zerstört, wenn der WebSocket nicht OPEN ist. Führt zu TCP-Connection-Leaks.
- **Fix:** `tcp.destroy()` immer aufrufen, unabhängig vom WebSocket-Status.

### 1.7 B32-Adress-Fallback ist falsch
- **Datei:** `app/src/services/i2pSam.ts:274-277`
- **Problem:** Wenn `crypto.subtle` fehlschlägt, wird Base64 auf 52 Zeichen gekürzt und `.b32.i2p` angehängt - das ist keine gültige b32-Adresse.
- **Fix:** Fehler korrekt propagieren statt ungültige Adresse zu generieren.

---

## Phase 2: HOHE Priorität (Stabilität & Sicherheit)

### 2.1 Event-Listener Memory Leak
- **Datei:** `app/src/contexts/AppContext.tsx:176, 190`
- **Problem:** `i2pService.onMessage()` und `onStatusChange()` registrieren bei jedem `initialize()`-Aufruf neue Listener ohne alte zu entfernen. Listener akkumulieren, Messages werden mehrfach verarbeitet.
- **Fix:** Listener-Deregistrierung implementieren (return cleanup function) oder prüfen ob bereits registriert.

### 2.2 Keine Validierung eingehender Nachrichten
- **Datei:** `app/src/contexts/AppContext.tsx:200-210`
- **Problem:** Eingehende I2P-Nachrichten werden ohne Validierung als `Message` übernommen. Kein Check auf gültige chatId, senderId, Timestamp etc. Angreifer können die lokale DB korrumpieren.
- **Fix:** Schema-Validierung (z.B. mit Zod) für eingehende Nachrichten implementieren.

### 2.3 SAM Timeout-Handler Race Condition
- **Datei:** `app/src/services/i2pSam.ts:371-375`
- **Problem:** Timeout-Handler sucht `resolve` im Array, aber es wurde `wrappedResolve` gepusht. `indexOf` findet nie den Eintrag, Resolver bleibt im Array = Memory Leak + stale Resolver.
- **Fix:** Referenz auf `wrappedResolve` im Timeout verwenden.

### 2.4 Pending Resolvers werden bei Disconnect nicht rejected
- **Datei:** `app/src/services/i2pSam.ts:323`
- **Problem:** Bei `disconnect()` wird `pendingResolvers = []` gesetzt, aber wartende Promises werden nie rejected. Code hängt ewig.
- **Fix:** Alle Resolver mit einem Error rejecten bevor Array geleert wird.

### 2.5 Keine React Error Boundaries
- **Problem:** Kein ErrorBoundary-Component existiert. Ein einzelner Fehler in einem Component crasht die gesamte App ohne Fallback-UI.
- **Fix:** Error Boundary um kritische Bereiche (Chat, Settings, etc.) wrappen.

### 2.6 SAM-Proxy unbegrenzter Buffer
- **Datei:** `sam-proxy/proxy.mjs:35, 44-49`
- **Problem:** `buffer` hat kein Größenlimit. Kann durch bösartige SAM-Antworten unbegrenzt wachsen.
- **Fix:** Max-Buffer-Size (z.B. 10MB) implementieren.

### 2.7 SAM-Proxy Reconnection fehlt
- **Datei:** `sam-proxy/proxy.mjs:98-101`
- **Problem:** Bei Server-Error `process.exit(1)` ohne Recovery. Proxy muss manuell neu gestartet werden.
- **Fix:** Graceful Recovery mit Reconnect-Logik statt hartem Exit.

### 2.8 Race Condition in SAM-Reconnection
- **Datei:** `app/src/services/i2pSam.ts:433-441`
- **Problem:** Mehrere Reconnect-Versuche können gleichzeitig laufen, da kein Lock existiert.
- **Fix:** Flag `isReconnecting` einführen.

### 2.9 I2P Config Save ohne Error-Handling
- **Datei:** `app/src/components/custom/Settings.tsx:632-649`
- **Problem:** `i2pService.initialize()` wird ohne try-catch aufgerufen. Fehler werden verschluckt.
- **Fix:** try-catch mit User-Feedback hinzufügen.

### 2.10 Keine Dateigrößen-Validierung bei sendFile
- **Datei:** `app/src/services/i2p.ts:282-330`
- **Problem:** Keine Prüfung auf `file.size`. User kann versehentlich Gigabyte-Dateien senden.
- **Fix:** Max-Dateigröße (z.B. 50MB) prüfen.

### 2.11 Backup-Restore unvollständig
- **Datei:** `app/src/services/storage.ts:412-446`
- **Problem:** Bestehende Nachrichten/Devices werden bei Restore nicht gelöscht. Duplikate möglich.
- **Fix:** Vollständiges Cleanup vor Restore.

### 2.12 Backup-Verschlüsselung ist Fake
- **Datei:** `app/src/components/custom/Settings.tsx:387-398`
- **Problem:** Restore macht einfach `JSON.parse()` - Backup ist unverschlüsseltes JSON, obwohl Verschlüsselung suggeriert wird.
- **Fix:** Echte Verschlüsselung implementieren oder Fake-Hinweis entfernen.

---

## Phase 3: MITTLERE Priorität (UX & Robustheit)

### 3.1 Service Worker deaktiviert
- **Datei:** `app/index.html:30-44`
- **Problem:** SW-Registrierung auskommentiert "for debugging". PWA funktioniert offline nicht.
- **Fix:** SW wieder aktivieren, Cache-Strategie implementieren.

### 3.2 SW Cache-Version hardcoded
- **Datei:** `app/public/sw.js:4`
- **Problem:** `CACHE_NAME = 'securechat-v1'` - Updates erreichen User nicht.
- **Fix:** Build-Hash oder Timestamp in Cache-Name einbauen.

### 3.3 connectionState unvollständig
- **Datei:** `app/src/contexts/AppContext.tsx:253-261`
- **Problem:** `connectionState` berücksichtigt nur `i2pStatus`, nicht `isLocked` oder `encryptionState`.
- **Fix:** Alle relevanten States in Ableitung einbeziehen.

### 3.4 Race Condition: Unmounted Component State Update
- **Datei:** `app/src/components/custom/Onboarding.tsx:70-98`
- **Problem:** `generateKeys` kann State nach Component-Unmount setzen.
- **Fix:** AbortController oder `isMounted`-Ref verwenden.

### 3.5 I2P-Test ohne Timeout
- **Datei:** `app/src/components/custom/Onboarding.tsx:151-163`
- **Problem:** `samService.isAvailable()` kann endlos hängen, kein User-Feedback bei Fehler.
- **Fix:** Timeout (10s) + detaillierte Fehlermeldung.

### 3.6 SAM-Befehlstimeout 30s zu lang
- **Datei:** `app/src/services/i2pSam.ts:376`
- **Problem:** 30-Sekunden-Timeout friert UI ein.
- **Fix:** Auf 10s reduzieren, mit User-Feedback.

### 3.7 Kein exponentielles Backoff bei Reconnect
- **Datei:** `app/src/services/i2pSam.ts:436-437`
- **Fix:** Exponentielles Backoff mit Jitter statt linearem.

### 3.8 Sequenznummer-Bug (falsy 0)
- **Datei:** `app/src/contexts/AppContext.tsx:207`
- **Problem:** `(data.sequenceNumber as number) || 0` - `||` ersetzt auch valide `0`.
- **Fix:** Nullish Coalescing `??` statt `||` verwenden.

### 3.9 Keine I2P-Adress-Validierung
- **Datei:** `app/src/components/custom/AddContactDialog.tsx:217-218`
- **Fix:** Regex-Check für `*.b32.i2p` Format.

### 3.10 Keine Port-Validierung
- **Datei:** `app/src/components/custom/Settings.tsx:696-705`
- **Fix:** Bereich 1-65535 validieren.

### 3.11 Fehlende ARIA-Labels
- **Dateien:** Header.tsx, ChatView.tsx, Sidebar.tsx
- **Fix:** ARIA-Labels für Status-Dots, Buttons, Icons hinzufügen.

### 3.12 Add-Contact-Button ohne Disabled-State
- **Datei:** `app/src/components/custom/AddContactDialog.tsx:470`
- **Fix:** Button während API-Call deaktivieren.

### 3.13 Kein User-Feedback bei Bild-Upload-Fehler
- **Datei:** `app/src/components/custom/ChatView.tsx:79-83`
- **Fix:** Toast/Alert bei Fehler statt nur console.error.

### 3.14 Debug-Plugin in Production
- **Datei:** `app/vite.config.ts:4`
- **Problem:** `kimi-plugin-inspect-react` sollte nur in Dev verwendet werden.
- **Fix:** Nur in `mode === 'development'` laden.

### 3.15 Exzessive console.log-Aufrufe
- **Dateien:** Alle Service-Dateien (52+ Stellen)
- **Fix:** Proper Logging-Framework oder console.log entfernen.

---

## Phase 4: NIEDRIGE Priorität (Cleanup & Polish)

### 4.1 Dead Code entfernen
- `app/src/services/webrtc.ts` (353 Zeilen) - unbenutzt
- `app/src/services/qrSignaling.ts` (367 Zeilen) - unbenutzt
- **Fix:** Dateien löschen, da nirgends importiert.

### 4.2 Unbenutzte Imports
- **Datei:** `app/src/components/custom/Onboarding.tsx` - mehrere Icons importiert aber nicht verwendet.
- **Fix:** Imports aufräumen.

### 4.3 Device-Import nicht implementiert
- **Datei:** `app/src/components/custom/Onboarding.tsx:673-710`
- **Problem:** `DeviceManualImport` validiert JSON aber importiert die Keys nicht tatsächlich.
- **Fix:** Tatsächlichen Import implementieren oder Feature als "coming soon" markieren.

### 4.4 Keine Lokalisierung trotz Language-Setting
- **Problem:** Alle UI-Strings sind hardcoded Deutsch, obwohl `language` in Settings existiert.
- **Fix:** i18n-Framework einführen oder Language-Setting entfernen.

### 4.5 PWA-Manifest unvollständig
- **Datei:** `app/public/manifest.json`
- **Fix:** `categories`, `screenshots`, `shortcuts` ergänzen.

### 4.6 Duplizierter Unlock-Dialog
- **Dateien:** `App.tsx` und `Header.tsx`
- **Fix:** In eine Komponente konsolidieren.

### 4.7 Outdated Dependencies
- **Datei:** `app/package.json`
- **Problem:** Mehrere Major-Versionen veraltet (tailwindcss 3→4, recharts 2→3, etc.)
- **Fix:** `npm audit` + schrittweise Updates.

---

## Empfohlene Reihenfolge

| Phase | Aufwand | Priorität | Anzahl Issues |
|-------|---------|-----------|---------------|
| 1: Kritisch | ~3-4 Tage | Sofort | 7 |
| 2: Hoch | ~3-4 Tage | Diese Woche | 12 |
| 3: Mittel | ~3-4 Tage | Nächste Woche | 15 |
| 4: Niedrig | ~1-2 Tage | Backlog | 7 |

## Verifikation

Nach jeder Phase:
1. `cd app && npx tsc --noEmit` - TypeScript-Fehler prüfen
2. `cd app && npm run lint` - ESLint-Fehler prüfen
3. `cd app && npm run build` - Build funktioniert
4. Manueller Test: App starten, Nachricht senden/empfangen, Backup erstellen/wiederherstellen
5. Browser DevTools: Keine Konsolen-Errors, kein Memory Leak in Performance Tab
