# SecuChat Security Audit Report

**Datum:** 2026-04-15  
**Branch:** `feat/android-port`  
**Version:** v1.0.9  
**Scope:** Android Port (Capacitor) + Desktop App (Electron)  
**Auditor:** Automated Security Audit (Droid)  

---

## Executive Summary

Der Audit deckte **16 kritische/high**, **12 mittlere** und **8 niedrige** Sicherheitslücken auf. Die schwerwiegendsten Probleme betreffen die Gruppenchat-Verschlüsselung (Klartext-Übertragung des AES-Schlüssels), unsichere Electron-Konfigurationen, fehlende Input-Sanitization im SAM-Proxy, und mehrere kritische Dependency-Schwachstellen.

**Gesamtbewertung: HOCHES RISIKO** — Behebung der kritischen Funde wird dringend empfohlen vor jedem Release.

---

## 1. CRITICAL Findings

### C-01: Gruppenchat-Schlüssel im Klartext über I2P übertragen
**Severity:** CRITICAL  
**File:** `app/src/services/groupChat.ts:235-245`  
**CWE:** CWE-319 (Cleartext Transmission of Sensitive Information)

Der symmetrische AES-256 Gruppenschlüssel wird beim Einladen neuer Mitglieder **unverschlüsselt** über I2P gesendet. Der Code enthält einen TODO-Kommentar (`In production: encrypt with member's PGP key`), aber die Verschlüsselung wurde nie implementiert.

```typescript
// Aktuell (INSECURE):
const invite: GroupInvite = {
  symmetricKey: group.symmetricKey, // Klartext AES-Key!
  ...
};
await i2pService.sendMessage(member.i2pAddress, invite);
```

**Impact:** Jeder I2P-Knoten, der den Traffic abfängt, kann den Gruppenschlüssel lesen und alle Gruppennachrichten entschlüsseln.

**Empfehlung:** Den symmetrischen Schlüssel mit dem PGP-Public-Key des Empfängers verschlüsseln bevor er gesendet wird:
```typescript
const encryptedKey = await cryptoService.encryptMessage(group.symmetricKey, member.publicKey);
```

### C-02: Gruppenchat-Schlüssel unverschlüsselt in localStorage
**Severity:** CRITICAL  
**File:** `app/src/services/groupChat.ts:399-405`  
**CWE:** CWE-312 (Cleartext Storage of Sensitive Information)

Gruppenchat-Schlüssel werden unverschlüsselt in `localStorage` gespeichert:
```typescript
localStorage.setItem('securechat_groups', JSON.stringify(groups));
```
Das `symmetricKey`-Feld jedes Groups-Objekts ist im Klartext im Browser-/WebView-Speicher zugreifbar.

**Impact:** Jede Schadsoftware mit Zugriff auf den Browser-Speicher (XSS, Malware) kann alle Gruppenschlüssel auslesen.

**Empfehlung:** Gruppenchat-Schlüssel in IndexedDB mit AES-GCM verschlüsselt speichern (wie bereits bei `pgpPrivateKey` implementiert).

### C-03: Kontaktverifizierung in localStorage statt verschlüsselter DB
**Severity:** HIGH  
**File:** `app/src/services/contactVerification.ts:155-165`  
**CWE:** CWE-312 (Cleartext Storage of Sensitive Information)

Die Kontaktverifizierungsdaten (`trustLevel`, `verificationMethod`) werden unverschlüsselt in `localStorage` gespeichert. Ein Angreifer könnte den Verifizierungsstatus manipulieren und "verified" setzen.

**Empfehlung:** Verifizierungsdaten in die verschlüsselte IndexedDB migrieren.

---

## 2. HIGH Findings

### H-01: Electron `sandbox: false` und ungeschütztes `storageInvoke` IPC
**Severity:** HIGH  
**File:** `electron/src/main.ts:68`  
**CWE:** CWE-265 (Privilege Issues)

```typescript
webPreferences: {
  sandbox: false,  // SCHWACHSTELLE
}
```

Zusätzlich exponiert `preload.ts` eine generische `storageInvoke(channel, ...args)`-Methode, die jeden IPC-Channel aufrufen kann — ohne Validierung des Channel-Namens.

```typescript
storageInvoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
```

**Impact:** Wenn der Renderer-Prozess kompromittiert wird (z.B. durch XSS), kann ein Angreifer beliebige IPC-Channel aufrufen, inkl. Storage-Operationen, I2P-Steuerung und Auto-Update.

**Empfehlung:**
1. `sandbox: true` aktivieren
2. `storageInvoke` durch spezifische Methoden ersetzen (Allowlist-basiert)
3. IPC-Channel-Namen in einem Enum definieren und validieren

### H-02: Electron ASAR-Disabled — Dateisystem zugreifbar
**Severity:** HIGH  
**File:** `electron/electron-builder.json:4`

```json
"asar": false
```

Das Deaktivieren von ASAR bedeutet, dass der gesamte App-Code als Klartext-Dateien im Installationsverzeichnis liegt. Nutzer können den Quellcode lesen und modifizieren.

**Empfehlung:** `asar: true` setzen und `asarUnpack` nur für native Module nutzen.

### H-03: SAM WebSocket Proxy ohne Authentifizierung
**Severity:** HIGH  
**Files:** `sam-proxy/proxy.mjs`, `electron/src/sam-proxy.ts`  
**CWE:** CWE-306 (Missing Authentication)

Der SAM-WebSocket-Proxy auf Port 7657 akzeptiert Verbindungen von **jedem** — es gibt keine Authentifizierung, keinen Origin-Check und keine TLS-Verschlüsselung.

```javascript
// proxy.mjs — keine Validierung
wss.on('connection', (ws, req) => {
  // Jeder kann sich verbinden
});
```

**Impact:** Auf Multi-User-Systemen kann jeder lokale Prozess die SAM-Verbindung übernehmen, I2P-Identitäten auslesen, oder Man-in-the-Middle-Angriffe durchführen.

**Empfehlung:**
1. WebSocket-Verbindungen auf `127.0.0.1` binden (bereits implementiert)
2. Origin-Header prüfen
3. Session-Token-basierte Authentifizierung hinzufügen

### H-04: Private I2P-Schlüssel im Memory ohne Secure Wiping
**Severity:** HIGH  
**Files:** `app/src/services/i2p.ts`, `app/src/services/i2pSam.ts`  
**CWE:** CWE-316 (Cleartext Storage of Sensitive Information in Memory)

I2P Private Keys (`samDestination`, Ed25519 `secretKey`) werden als JavaScript-Strings/Uint8Arrays im Speicher gehalten. Es gibt keine Möglichkeit, den Speicher sicher zu überschreiben (`crypto.subtle` exportiert nur Kopien).

```typescript
private identity: I2PIdentity | null = null;
// identity.privateKey ist ein Uint8Array, wird nie nullified
```

**Impact:** Memory-Dump-Angriffe können I2P-Private-Keys exfiltrieren.

**Empfehlung:** Nach Gebrauch Speicher mit Nullen überschreiben, und CryptoKey-Objekte statt Raw-Keys verwenden wo möglich.

### H-05: PGP Private Key im Klartext im RAM (decryptedPrivateKey)
**Severity:** HIGH  
**File:** `app/src/services/crypto.ts:8`

```typescript
private decryptedPrivateKey: openpgp.PrivateKey | null = null;
```

Der entschlüsselte PGP-Private-Key wird dauerhaft im Speicher gehalten. `clearKeyPair()` muss explizit aufgerufen werden — passiert aber nur beim Logout/App-Lock.

**Empfehlung:** Private Key nur bei Bedarf entschlüsseln und sofort danach aus dem Speicher löschen (Caching mit Timeout).

### H-06: `electron-builder.json` — `perMachine: true` (NSIS)
**Severity:** HIGH  
**File:** `electron/package.json:84`

```json
"nsis": {
  "perMachine": true
}
```

Die Windows-Installation erfolgt systemweit mit Admin-Rechten. Wenn der i2pd-Prozess mit diesen Rechten läuft, erhöht das die Angriffsfläche.

**Empfehlung:** `perMachine: false` verwenden (User-Installation). i2pd sollte mit minimalen Rechten laufen.

---

## 3. MEDIUM Findings

### M-01: Keine Input-Sanitization im SAM-Proxy
**Severity:** MEDIUM  
**File:** `sam-proxy/proxy.mjs:60-64`  
**CWE:** CWE-20 (Improper Input Validation)

Eingehende WebSocket-Nachrichten werden ohne Validierung direkt an den SAM-TCP-Socket weitergeleitet:
```javascript
ws.on('message', (data) => {
  const message = data.toString();
  tcp.write(message.endsWith('\n') ? message : message + '\n');
});
```

Es gibt keine Prüfung auf maximale Nachrichtenlänge (nur Buffer-Overflow-Schutz auf TCP-Seite), keine Validierung des SAM-Befehlsformats, und keine Rate-Limiting.

**Empfehlung:** SAM-Befehle validieren, Rate-Limiting hinzufügen, maximale Nachrichtenlänge pro Frame begrenzen.

### M-02: Backup-Schlüssel im Klartext als JSON-Datei
**Severity:** MEDIUM  
**File:** `app/src/services/backup.ts:128-136`  
**CWE:** CWE-312 (Cleartext Storage of Sensitive Information)

Die Backup-Datei enthält den Age-Private-Key (`AGE-SECRET-KEY-1...`) im Klartext als JSON:
```json
{
  "magic": "SECUCHAT_BACKUP_KEY",
  "privateKey": "AGE-SECRET-KEY-1...",  // Klartext!
  ...
}
```

**Empfehlung:** Private Key mit einem Benutzer-Passwort verschlüsseln (z.B. via PBKDF2 + AES-GCM) bevor er gespeichert/geteilt wird.

### M-03: Contact Export enthüllt PGP Public Key + I2P-Adresse
**Severity:** MEDIUM  
**File:** `app/src/services/nativeFileSharing.ts:37-43`  
**CWE:** CWE-200 (Information Exposure)

Die Kontakt-Export-Datei enthält sowohl PGP Public Key als auch I2P-Adresse unverschlüsselt:
```json
{
  "v": "2", "t": "sc",
  "i": "<i2p-address>",
  "f": "<fingerprint>",
  "k": "<pgp-public-key>"
}
```

Jeder mit Zugriff auf die Datei hat alle kryptografischen Identitätsdaten des Nutzers.

**Empfehlung:** Export-Datei optional mit Passwort verschlüsseln oder zumindest vor Warnung anzeigen.

### M-04: Kein Certificate Pinning für Auto-Updater
**Severity:** MEDIUM  
**File:** `electron/src/main.ts` (autoUpdater)  
**CWE:** CWE-295 (Improper Certificate Validation)

`electron-updater` nutzt GitHub Releases. Es gibt kein Code-Signing-Zertifikat und kein Update-Verify-Handler:
```typescript
autoUpdater.autoDownload = false;
// Kein autoUpdater.verifyUpdate() oder signature check
```

**Empfehlung:** Code-Signing implementieren und `win.verifyUpdateCodeSignature` nutzen.

### M-05: Notification Content Leak auf Lock Screen
**Severity:** MEDIUM  
**File:** `app/src/services/notificationService.ts:170-180`  
**CWE:** CWE-200 (Information Exposure)

Je nach `showPreview`-Einstellung werden Nachrichteninhalte in Benachrichtigungen angezeigt:
```typescript
const body = notifSettings.showPreview
  ? truncateMessage(messageContent, 100)  // Nachrichteninhalt!
  : 'Neue Nachricht';
```

Auf Android können Benachrichtigungen auf dem Lock-Screen sichtbar sein.

**Empfehlung:** Visibility auf `PRIVATE` setzen und `showPreview` standardmäßig deaktivieren.

### M-06: Kontakt-Import ohne Signaturverifikation
**Severity:** MEDIUM  
**File:** `app/src/services/nativeFileSharing.ts:105-140`  
**CWE:** CWE-345 (Insufficient Verification of Data Authenticity)

Importierte Kontaktdaten werden nicht auf Authentizität geprüft. Ein Angreifer könnte eine manipulierte Kontaktdatei mit fremdem I2P-Public-Key einschleusen.

**Empfehlung:** Kontaktdateien mit dem PGP-Key des Senders signieren und beim Import verifizieren.

### M-07: `cleartext: true` in Capacitor Config
**Severity:** MEDIUM  
**File:** `app/capacitor.config.ts:8`

```typescript
server: {
  androidScheme: 'https',
  cleartext: true, // HTTP erlaubt
}
```

Dies erlaubt cleartext HTTP-Verbindungen in der Android-WebView, was für localhost-WebSocket-Verbindungen zu i2pd notwendig ist, aber auch andere HTTP-Verbindungen erlaubt.

**Empfehlung:** Kommentieren warum das notwendig ist. In einer Network Security Config nur localhost erlauben.

### M-08: File Transfer ohne Integritätsprüfung
**Severity:** MEDIUM  
**File:** `app/src/services/fileTransfer.ts`  
**CWE:** CWE-354 (Improper Integrity Check)

Dateitransfers werden in Chunks übertragen, aber es gibt keine Hash-Verification des vollständigen Files. Ein Angreifer könnte Chunks austauschen.

**Empfehlung:** SHA-256-Hash der vollständigen Datei im Metadaten senden und beim Empfänger verifizieren.

---

## 4. LOW Findings

### L-01: Ausführliche Logging-Ausgaben mit sensiblen Daten
**Severity:** LOW  
**Files:** Diverse  
**CWE:** CWE-532 (Insertion of Sensitive Information into Log File)

Mehrere Log-Ausgaben enthüllen sensible Informationen:
- `i2p.ts`: I2P-Adressen (erste 20-30 Zeichen) in Logs
- `i2pSam.ts`: SAM-Befehle/Responses in Logs
- `storage.ts`: User-IDs in Logs
- `main.ts`: Dateipfade und Konfiguration in Logs

**Empfehlung:** In Production alle `console.log`/`logger.log` auf `logger.debug` umstellen und nur `logger.error`/`logger.warn` aktivieren.

### L-02: Keine Rate-Limiting bei PGP-Key-Operationen
**Severity:** LOW  
**File:** `app/src/services/crypto.ts`  
**CWE:** CWE-770 (Allocation of Resources Without Limits)

PGP-Key-Generierung und -Entschlüsselung haben kein Rate-Limiting. Brute-Force-Angriffe auf die Passphrase sind möglich.

**Empfehlung:** Exponentielles Backoff bei fehlgeschlagenen Entschlüsselungsversuchen implementieren.

### L-03: `file://` Protocol PWA-Verhalten
**Severity:** LOW  
**File:** `app/index.html:38-42`

Service Worker wird für `file://`-Protokoll deaktiviert, was die Electron-App betrifft. Kein Security-Problem, aber erwähnenswert.

### L-04: Electron Dev Mode exposet DevTools
**Severity:** LOW  
**File:** `electron/src/main.ts:79`

```typescript
if (isDev && process.env.VITE_DEV_SERVER_URL) {
  mainWindow.webContents.openDevTools();
}
```

DevTools werden im Development-Mode automatisch geöffnet. Sollte in Production strikt verhindert werden.

### L-05: Kein Content Security Policy (CSP) Header
**Severity:** LOW  
**File:** `app/index.html`

Es gibt keinen CSP-Header, der die WebView vor XSS schützt.

**Empfehlung:** CSP-Header hinzufügen:
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
```

### L-06: `window.electronAPI` global exponiert
**Severity:** LOW  
**File:** `electron/src/preload.ts`

Obwohl `contextIsolation: true` aktiv ist, wird eine breite API-Oberfläche über `contextBridge` exponiert. Die generische `storageInvoke`-Methode ist besonders problematisch (siehe H-01).

### L-07: Kein App-Integrity-Check bei Android-Start
**Severity:** LOW  
**File:** `app/src/App.tsx`

Die App prüft beim Start nicht, ob sie in einer vertrauenswürdigen Umgebung läuft (z.B. ob die WebView kompromittiert wurde).

### L-08: Keine automatische Session-Sperre bei Inaktivität
**Severity:** LOW  
**Files:** `app/src/contexts/AppContext.tsx`

Obwohl ein `lockTimeout` in den Settings existiert, gibt es Hinweise darauf, dass der Auto-Lock-Mechanismus nicht konsistent implementiert ist.

---

## 5. Dependency Audit

### 5.1 App Dependencies (`app/`)

| Paket | Severity | CVE | Beschreibung |
|-------|----------|-----|-------------|
| **handlebars** | CRITICAL | 1115538, 1115539, 1115544, 1115588, 1115589, 1115692, 1115693, 1115694 | JavaScript Injection, Prototype Pollution, XSS, DoS |
| **@capacitor/assets** | HIGH | via @trapezedev/project | Transitive Abhängigkeit mit XMl-Injection |
| **@xmldom/xmldom** | HIGH | 1115997 | XML Injection via CDATA (CVSS 7.5) |
| **lodash** | HIGH | 1115806, 1115810 | Code Injection via `_.template`, Prototype Pollution |
| **vite** | HIGH | 1116230, 1116232, 1116235 | Path Traversal, fs.deny Bypass, Arbitrary File Read |
| **picomatch** | HIGH | 1115549, 1115551, 1115552, 1115554 | Method Injection, ReDoS |
| **flatted** | HIGH | 1115357 | Prototype Pollution via parse() |
| **brace-expansion** | MODERATE | 1115540 | ReDoS / Memory Exhaustion |

**Gesamt:** 1 critical, 8 high, 1 moderate

**Empfehlung:**
- `handlebars` ist nur eine Dev-Dependency von `@capacitor/assets` und wird nicht zur Laufzeit verwendet. Dennoch aktualisieren oder entfernen.
- Vite auf >= 7.3.2 aktualisieren (fixes Path Traversal)
- `lodash` aktualisieren (falls nicht direkt verwendet, entfernen)

### 5.2 Electron Dependencies (`electron/`)

| Paket | Severity | CVE | Beschreibung |
|-------|----------|-----|-------------|
| **electron** | MODERATE | 1116043, 1116047, 1116051, 1116055, 1116062, 1116086, 1116110, 1116258, 1116319 | Service Worker Spoofing, IPC Issues, Registry Injection, Use-after-free |
| **lodash** | HIGH | 1115806, 1115810 | Code Injection, Prototype Pollution |
| **@xmldom/xmldom** | HIGH | 1115997 | XML Injection (CVSS 7.5) |
| **picomatch** | HIGH | 1115551, 1115554 | Method Injection, ReDoS |
| **tar** | HIGH | 1114200, 1114302 | Hardlink/Symlink Path Traversal |
| **brace-expansion** | MODERATE | 1115540, 1115541, 1115543 | ReDoS / Memory Exhaustion |

**Gesamt:** 0 critical, 4 high, 2 moderate

**Empfehlung:**
- Electron auf >= 40.8.5 aktualisieren
- `tar` auf >= 7.5.11 aktualisieren (bereits als Override in `app/package.json`, aber nicht in `electron/`)

---

## 6. Positive Security Practices

Folgende gute Security-Praktiken wurden identifiziert:

1. **E2E PGP-Verschlüsselung** — Nachrichten werden mit OpenPGP.js (ECC curve25519Legacy) verschlüsselt
2. **AES-GCM Verschlüsselung** — Sensible Storage-Daten werden mit PBKDF2 (100k Iterationen) + AES-256-GCM verschlüsselt
3. **Age-Verschlüsselung** — Backups nutzen `age-encryption` mit separatem Key-File
4. **Context Isolation** — Electron nutzt `contextIsolation: true` und `nodeIntegration: false`
5. **Local Notifications** — Android nutzt lokale Notifications statt FCM/GCM (Privacy-freundlich)
6. **WebSocket-Proxy Buffer Limits** — SAM-Proxy hat Buffer-Overflow-Schutz (10MB Limit)
7. **I2P Anonymity** — Netzwerk-Traffic läuft über I2P (anonym, verschlüsselte Tunnels)
8. **HTTPS Scheme** — Capacitor nutzt `https` als Android-Scheme
9. **File Size Limits** — Dateitransfers auf 500MB begrenzt, I2P-Dateitransfer auf 50MB
10. **Explicit Key Management** — Private Keys werden nicht in der SAM-Session als TRANSIENT erstellt

---

## 7. Platform-spezifische Risiken

### 7.1 Android (Capacitor)

| Risiko | Beschreibung |
|--------|-------------|
| WebView-Sicherheit | Kein CSP-Header; WebView kann durch Schadsoftware auf dem Gerät angegriffen werden |
| Backup-Sicherheit | `android:allowBackup` könnte standardmäßig aktiv sein — Prüfung in `AndroidManifest.xml` nötig |
| Screenshot-Protection | `screenshotProtection` in Settings erwähnt, aber keine Implementierung sichtbar |
| Root-Erkennung | Keine Prüfung, ob Gerät gerootet ist — Alle Storage-Daten sind auf gerooteten Geräten zugreifbar |
| Certificate Pinning | Kein Certificate Pinning für I2P-Verbindungen |
| Keystore-Nutzung | Kryptografische Schlüssel werden nicht im Android Keystore gespeichert |

### 7.2 Desktop (Electron)

| Risiko | Beschreibung |
|--------|-------------|
| Auto-Update ohne Signatur | Updates werden nicht kryptografisch verifiziert |
| ASAR deaktiviert | Quellcode liegt als Klartext-Dateien vor |
| i2pd mit User-Rechten | i2pd läuft mit den gleichen Rechten wie die App |
| Kein Prozess-Sandboxing | `sandbox: false` deaktiviert Chromium-Sandbox |
| IPC ohne Validierung | Generischer `storageInvoke` ohne Channel-Allowlist |

---

## 8. Priorisierter Remediation-Plan

| Priorität | Finding | Aufwand | Risiko-Reduktion |
|-----------|---------|---------|-------------------|
| P0 | C-01: Gruppenchat-Schlüssel verschlüsseln | 2h | Hoch |
| P0 | C-02: Gruppenchat-Schlüssel verschlüsselt speichern | 1h | Hoch |
| P0 | H-01: Electron IPC Allowlist + Sandbox | 4h | Hoch |
| P1 | H-02: ASAR aktivieren | 1h | Mittel |
| P1 | H-03: SAM-Proxy Auth | 4h | Mittel |
| P1 | M-01: SAM-Proxy Input Validation | 2h | Mittel |
| P1 | M-02: Backup-Key verschlüsseln | 2h | Mittel |
| P1 | Dependencies aktualisieren | 2h | Mittel |
| P2 | H-04/H-05: Secure Memory Wiping | 4h | Niedrig |
| P2 | M-03 bis M-08: Diverse | 8h | Niedrig |
| P3 | L-Fixes: CSP, Logging, Rate-Limiting | 4h | Niedrig |

**Geschätzter Gesamtaufwand:** ~34 Stunden

---

## 9. Methodik

- **Statische Code-Analyse:** Manuelle Überprüfung aller Service-Dateien in `app/src/services/` und `electron/src/`
- **Dependency Audit:** `npm audit --json` für `app/` und `electron/`
- **Secret Scanning:** Grep-basierte Suche nach API-Keys, Tokens, Credentials
- **Input Validation Review:** Analyse aller Benutzereingabe-Pfade
- **Crypto Review:** Überprüfung aller kryptografischen Operationen
- **Electron Security:** Überprüfung nach Electron Security Checklist

---

*Report generiert am 2026-04-15. Dieser Audit ersetzt keinen professionellen Penetration-Test.*
