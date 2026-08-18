# SecuChat — I2CP-Client-Desktop (External Java-I2P Router)

**Status:** Entwurf v0.1
**Datum:** 2026-08-17
**Autor:** gianjaa
**Bezieht sich auf:** [2026-08-07-secuchat-i2cp-client-android-design](../specs/2026-08-07-secuchat-i2cp-client-android-design.md) (Android-Pendant, Vorbild)

## 1. Zusammenfassung & Motivation

SecuChat-Desktop (Linux/Windows, Electron) verwendet aktuell **i2pd** als externen Router und spricht SAM (7656) über die WebSocket-Bridge `sam-proxy.ts`. Wir portieren auf **Java I2P** als externen Router und sprechen direkt **I2CP (7654)** — analog zur Android-Architektur.

**Warum diese Migration:**
- **Plattform-Konsistenz:** Android spricht bereits I2CP gegen Java-I2P-App. Desktop soll identisch sein (gleiche Crypto-Properties, gleiche Identitäts-Kodierung, gleiche Cross-Plattform-Chats).
- **Signatur-Problem i2pd Windows:** i2pd ist auf Windows unsigniert → Anwenderprobleme bei Installation. Java I2P bietet offizielle signierte Installer (z.B. `i2pinstall_2.13.0_windows.exe`).
- **i2pd-Bug-Risiko:** siehe `secuchat-i2pd-socket-binds-stream-2026-08-05` — i2pd#1255-Blocker (STREAM-Berechtigung an Socket gebunden) trifft SAM-only Setups. Java I2P (`streaming.jar`) multiplexed sauber über eine Session.
- **Spec-konformes Streaming-Protokoll:** Java I2P implementiert die offizielle I2P-Streaming-Lib. Identisch zum Android-Code.

**Was fällt weg:**
- `electron/resources/i2pd/` (Linux-Binary + Zertifikate)
- `electron/src/i2p-manager.ts` (i2pd-Spawn)
- `electron/src/sam-proxy.ts` (WS↔SAM-Bridge, da I2CP direkt)
- `electron/scripts/setup-i2pd.{sh,ps1}`
- `sam-proxy/` Standalone-Tool

**Was bleibt:**
- SAM-Bridge bleibt als **Fallback für Browser-Use** (Desktop-Browser kann nicht via IPC, braucht WS-Bridge — aber i2pd wird nicht mehr gebundled)
- Plattform-Detection (`platform.ts`, `storage/platform.ts`)
- SQLite-Storage, PGP-Crypto, UI-Komponenten

## 2. Architektur

### 2.1 Prozess-Topologie

```
┌─ Electron-Main (Node.js) ─────────────────────────────┐
│  ┌─ BrowserWindow (Vite-React) ────────────────────�   │
│  │  app/src/services/i2p.ts (TS-Frontend)          │   │
│  │  ▲                                              │   │
│  │  │ IPC via contextBridge                        │   │
│  │  ▼                                              │   │
│  │  electron/src/preload.ts (electronAPI.i2p.*)    │   │
│  └────────────────────�─────────────────────────┘   │
│                       │ ipcRenderer.invoke/on        │
│                       ▼                              │
│  electron/src/i2p/i2p-plugin.ts                      │
│    ├─ I2CPSocketManager (1 pro Session)              │
│    ├─ I2PSocketHandle (N pro Stream)                 │
│    └─ IdentityStore (Disk-Persistence)               │
└─────────────────────────┬────────────────────────────┘
                          │ TCP 127.0.0.1:7654 (I2CP, binary)
                          │ Node.js implementiert I2CP-Protokoll direkt
                          │ (kein streaming.jar — wir parsen selber)
         ┌────────────────▼──────────────────────────┐
         │ Java I2P Router (extern installiert)       │
         │ - Linux: i2p (Debian/Ubuntu via PPA/Repo) │
         │ - Windows: i2pinstall_2.13.0_windows.exe  │
         │ - I2CP-Server auf 127.0.0.1:7654          │
         └────────────────┬───────────────────────────┘
                          │
                       I2P-Netz
```

### 2.2 Design-Entscheidungen

| Entscheidung | Wahl | Begründung |
|---|---|---|
| I2CP vs. SAM | **I2CP direkt** | Konsistent mit Android (Capacitor-Plugin nutzt auch I2CP). Eine Protokoll-Schicht weniger. SAM-Bridge bleibt nur für Browser-Fallback. |
| Java-I2P-Library | **Nicht bundlen** | Linux: `apt install i2p`. Windows: `i2pinstall_*.exe`. Keine portable JRE nötig (User hat meist schon Java oder akzeptiert Installer). Spart ~70 MB Bundle-Size. |
| Streaming-Protokoll | **I2P-eigenes Streaming-Protokoll** (kein SAM-Wrapper) | Direkte Implementation in TypeScript. SAM würde nur zusätzlichen Wrapper-Layer bedeuten. |
| Identitäts-Persistenz | **Electron userData** | Statt `~/.i2p/` vermeidet Kollisionen mit anderen Apps. AES-256-GCM mit PBKDF2, identische Properties wie Android. |
| Bootstrap-Race | **64-Entry Ring-Buffer mit FIFO-Eviction + Drain-on-Lister-Attach** | 1:1 portiert von Java `I2PPlugin.java:38-66`. Verhindert verlorene Boot-Time-Messages. |

### 2.3 Modul-Übersicht

| Komponente | Datei | Prozess | Aufgabe |
|---|---|---|---|
| `I2PPlugin` (neu) | `electron/src/i2p/i2p-plugin.ts` | Electron-Main | IPC-Bridge zum Renderer. Methoden: `start()`, `connectTo()`, `acceptIncoming()`, `send()`, `close()`, `disconnect()`, `getB32Address()`, `isI2pAvailable()`. Events: `i2pStatus`, `i2pMessage`, `i2pStreamConnected`, `i2pStreamClosed`. |
| `I2CPSocketManager` (neu) | `electron/src/i2p/i2cp-socket-manager.ts` | Electron-Main | I2CP-Protokoll-Implementation. 1 Instanz pro Session. Singleton. |
| `I2PSocketHandle` (neu) | `electron/src/i2p/i2p-socket-handle.ts` | Electron-Main | Wrapper um Node-Stream-Socket. Reader-Loop auf Node-Streams-API. |
| `IdentityStore` (neu) | `electron/src/i2p/identity-store.ts` | Electron-Main | AES-256-GCM + PBKDF2 Identitäts-Persistence. Pfad: `<userData>/i2p_identity.bin`. |
| `I2CPProtocol` (neu) | `electron/src/i2p/i2cp-protocol.ts` | Electron-Main | Binary-Encoding/Decoding für I2CP-Messages (length-prefix, MessageId-Pairing). |
| `preload.ts` (modifiziert) | `electron/src/preload.ts` | Electron-Preload | `contextBridge.exposeInMainWorld('electronAPI', { i2p: { start, connectTo, ... } })`. |
| `i2p.ts` (modifiziert) | `app/src/services/i2p.ts` | Renderer | Capability-Discovery + Call-Forwarding an `window.electronAPI.i2p`. |

### 2.4 Identitäts-Kompatibilität mit Android

**File-Format identisch:**
```
[16-byte salt][12-byte IV][ciphertext (privKey)]
```
**Algorithmus identisch:** AES-256-GCM, PBKDF2 100_000 Iterations SHA-256, 256-bit Key.

**Cross-Plattform-Identität:** Da `EdDSA_SHA512_Ed25519`-Destinationen aus dem privaten Schlüssel deterministisch abgeleitet werden, ist die b32-Adresse auf Android und Desktop identisch (wenn gleicher privKey verwendet wird). Wir unterstützen Cross-Plattform-Export/Import der `i2p_identity.bin`-Datei.

## 3. I2CP-Protokoll-Implementation in Node

I2CP ist ein **binäres, length-prefixed Protokoll**. Spec: https://i2p.net/en/docs/specs/i2cp/

### 3.1 Message-Format

```
┌──────────────────────────────┐
│ 4-byte length (big-endian)   │
├──────────────────────────────┤
│ 1-byte message type          │
├──────────────────────────────┤
│ payload (variable)           │
└──────────────────────────────┘
```

### 3.2 Message-Typen (relevant für SecuChat)

| Type | Name | Richtung | Bemerkung |
|---|---|---|---|
| 1 | `CreateSessionMessage` | Client→Router | Session-Init mit Properties |
| 20 | `SessionStatusMessage` | Router→Client | Status: Created/Destroyed |
| 30 | `SendMessageMessage` | Client→Router | Outbound data |
| 31 | `MessagePayloadMessage` | Router→Client | Inbound data |
| 33 | `FlushMessage` | Client→Router | Bestätigt Flush |
| 34 | `MessageStatusMessage` | Router→Client | ACK der Outbound-Messages |
| 37 | `GetDateMessage` | Client→Router | Router-Zeit (debug) |
| 41 | `CreateLeaseSetMessage` | Client→Router | LeaseSet für Inbound |
| 42 | `LeaseSetMessage` | Router→Client | LeaseSet-Bestätigung |
| 56 | `RequestLeaseSetMessage` | Client→Router | Lookup Remote-LeaseSet |
| 57 | `LeaseSetFoundMessage` | Router→Client | Lookup-Response |

### 3.3 Streaming-Layer

SecuChat nutzt das **I2P Streaming Protocol** (siehe `streaming.jar` in Android). Dies ist ein TCP-ähnliches Protokoll auf Top von I2CP. Wir implementieren es in Node:

- **Sliding-Window** mit konfigurierbarer Window-Size (Default: 6 Packets)
- **ACK + Retransmit** bei Packet-Loss
- **Hole-Punching** für NAT-Traversal
- **Idle-Timeout** 90s (Java I2P-Default, konservativ)

**Aufwand-Schätzung:** ~800-1200 LOC TypeScript für das Streaming-Protokoll (siehe [[secuchat-i2cp-port-analysis-2026-08-17]]). Wir orientieren uns am Java-Reference-Code in `streaming.jar` (Public Domain, i2p.i2p/apps/streaming/).

### 3.4 Destination-Generierung

```typescript
// Ed25519-Keypair generieren (Node.js native crypto)
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');

// I2P-Destination-Blob manuell konstruieren:
// [PublicKey 32B][SigningPublicKey 32B][Certificate]
// Certificate = NULL (= EdDSA-only, kein verschlüsselter LeaseSet)
```

**Aufwand:** ~50 LOC. Identisch zu Java's `I2PClient.createDestination(SigType.EdDSA_SHA512_Ed25519)`.

## 4. Setup & Distribution

### 4.1 Linux (Debian/Ubuntu)

`electron/scripts/setup-i2p.sh` führt die offizielle Anleitung aus:
```bash
# Ubuntu (PPA)
sudo apt-add-repository ppa:i2p-maintainers/i2p
sudo apt-get update
sudo apt-get install -y i2p

# Debian (Repo)
curl -fsSL https://i2p.net/installlinux.sh | sudo bash
```

Danach: `sudo dpkg-reconfigure i2p` setzt Service auf disabled (Electron verbindet sich nur auf `127.0.0.1:7654`, startet keinen Router).

**Validierung:** Polling auf TCP 7654 alle 2s, max 30s. Bei Fehler: klare UI-Hilfe mit Setup-Link.

### 4.2 Windows

`electron/scripts/setup-i2p.ps1` führt den Installer silent aus:
```powershell
$installer = "$env:TEMP\i2pinstall_2.13.0_windows.exe"
Invoke-WebRequest -Uri "https://files.i2p.net/2.13.0/i2pinstall_2.13.0_windows.exe" -OutFile $installer
Start-Process -FilePath $installer -ArgumentList "/S" -Wait
```

Konfiguration via `<userData>\i2p\router.config` mit gleichen Properties wie Android.

### 4.3 Plattform-Detection-Erweiterung

`platform.ts` wird erweitert:
```typescript
interface PlatformInfo {
  isElectron: boolean;
  isAndroidNative: boolean;
  i2pAvailable: boolean;  // NEU: TCP 7654 erreichbar?
  i2pRouterVersion: string | null;  // NEU: via I2CP GetDate
  platform: 'native' | 'external-required' | 'unsupported';
}
```

Renderer-Code:
```typescript
if (platformService.isElectron()) {
  if (await platformService.isI2pAvailable()) {
    // I2CP direkt
    await i2pPlugin.connectTo(...);
  } else {
    // Setup-Hinweis anzeigen
    showSetupInstructions('setup-i2p.sh');
  }
}
```

### 4.4 electron-builder-Konfiguration

**Was entfernt wird** (`electron/electron-builder.json`):
- `extraResources` für `resources/i2pd/` (komplett weg)
- NSIS `installer.nsh` Defender-Exclusions für `i2pd.exe`
- DEB `after-install.sh` chmod 755 i2pd
- DEB `after-remove.sh`

**Was bleibt:**
- `app/dist` wird weiterhin nach `resources/app` kopiert
- AppImage + DEB Targets für Linux
- NSIS für Windows (ohne i2pd-Spezifika)

**Bundle-Size-Reduktion:** ca. -10 MB (i2pd-Linux-Binary + Zertifikate).

## 5. Lifecycle & Error-Handling

### 5.1 Identitäts-Backup

Cross-Plattform-Identitäts-Export:
- `IdentityStore.export()` schreibt `<userData>/i2p_identity_export.bin` (Base64-encoded) plus b32-Adresse in `<userData>/i2p_identity_export.json`
- `IdentityStore.import()` liest diese Datei zurück
- Kompatibel mit Android-Export

### 5.2 Stream-Timeout-Watchdog

Java I2P-Default: 90s Idle-Timeout. Wir setzen Watchdog:
```typescript
socket.setTimeout(90_000);
socket.on('timeout', () => {
  this.close('idle-timeout');
});
```

### 5.3 SessionId-Collision-Handling

`streamIdCounter` monoton wachsend ab 1 (Java-Verhalten). Bei Wrap-around (>2^31) wird auf 1 zurückgesetzt; Kollisionen werden via `Map.has`-Check vermieden.

### 5.4 Edge-Cases (aus Android-Recherche)

| Bug | Fix in TS |
|---|---|
| Java `save()` swallow'd IOException | TS `save()` Promise-reject. I2PPlugin read-back-validation behalten. |
| Newline-Delimiter nicht im Receiver gesplittet | TS implementiert Newline-Splittung im Reader-Loop (Verbesserung ggü. Java). |
| Bootstrap-Race ohne Ring-Buffer | Ring-Buffer 1:1 portiert, FIFO-Eviction bei 64. |
| `disconnect()` während `connectTo()` Lookup | `AbortController` für Promise-Cancel. |

## 6. Test-Strategie

### 6.1 Phase 1 — Manuell (Linux-Test-VM)

```bash
# Auf Linux-Test-VM mit i2p-Paket installiert
sudo apt-add-repository ppa:i2p-maintainers/i2p
sudo apt-get install -y i2p
# I2CP-Tunnel freischalten via i2p Console
# SecuChat starten
./SecuChat-1.0.21.AppImage
```

**Test-Matrix:**
- Bidirektionaler Chat A50↔Linux
- Bidirektionaler Chat A52↔Linux
- Bidirektionaler Chat A54↔Linux
- Identitäts-Export Android → Linux
- Identitäts-Export Linux → Android

### 6.2 Phase 2 — Windows-VM

```powershell
# Windows-Test-VM
Invoke-WebRequest -Uri "https://files.i2p.net/2.13.0/i2pinstall_2.13.0_windows.exe" -OutFile "$env:TEMP\installer.exe"
Start-Process installer.exe -ArgumentList "/S" -Wait
# SecuChat installieren + starten
```

**Test-Matrix:**
- Bidirektionaler Chat A50↔Windows
- A52↔Windows
- A54↔Windows
- Identitäts-Export/Import Round-Trip

### 6.3 Phase 3 — CI (GitHub Actions)

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest]
steps:
  - name: Install Java I2P
    if: matrix.os == 'ubuntu-latest'
    run: |
      sudo apt-add-repository ppa:i2p-maintainers/i2p
      sudo apt-get install -y i2p
  - name: Install Java I2P (Windows)
    if: matrix.os == 'windows-latest'
    run: |
      Invoke-WebRequest ...
  - name: Smoke-Test
    run: |
      npm run build
      # Start SecuChat in headless mode, verify i2pAvailable
```

## 7. Migrations-Reihenfolge (agent-driven)

Da dies ein agent-getriebenes Projekt ist, strukturieren wir die Implementierung als unabhängige, parallelisierbare Phasen. Jede Phase hat klar abgegrenzte Verantwortung und kann von separaten Subagenten umgesetzt werden.

| # | Phase | Verantwortlicher Agent | Deliverable | Parallelisierbar mit |
|---|---|---|---|---|
| 1 | **I2CP-Protokoll-Layer** | `code-architect` | `i2cp-protocol.ts` (length-prefix, Message-Encoding/Decoding) | 2, 3 |
| 2 | **IdentityStore** | `code-architect` | `identity-store.ts` (AES-GCM + PBKDF2, 1:1 von Java) | 1, 3 |
| 3 | **I2PSocketHandle** | `code-architect` | `i2p-socket-handle.ts` (Node-Streams-Wrapper) | 1, 2 |
| 4 | **Streaming-Protokoll** | `code-architect` | `streaming-protocol.ts` (Sliding-Window, ACK, Retransmit) | 5 |
| 5 | **I2CPSocketManager** | `code-architect` | `i2cp-socket-manager.ts` (Singleton, Session-Management) | 4 |
| 6 | **I2PPlugin IPC-Bridge** | `code-architect` | `i2p-plugin.ts` (Bootstrap-Race, alle 8 @PluginMethod-Methoden) | 7, 8 |
| 7 | **preload + electronAPI** | `code-architect` | `preload.ts` modifiziert (contextBridge.i2p) | 6, 8 |
| 8 | **Renderer-Anpassung** | `code-architect` | `i2p.ts`, `platform.ts` angepasst | 6, 7 |
| 9 | **Setup-Scripts** | `code-architect` | `setup-i2p.sh`, `setup-i2p.ps1` | 10 |
| 10 | **electron-builder Cleanup** | `code-architect` | `electron-builder.json` modifiziert (i2pd-Refs weg) | 9 |
| 11 | **E2E-Tests** | `general-purpose` | Test-Matrix gegen A50/A52/A54 | — |
| 12 | **CI-Integration** | `general-purpose` | GitHub-Actions-YAML | 11 |

**Sync-Points:**
- Nach Phase 5: TypeScript-Build muss grün sein (`npm run build`)
- Nach Phase 8: Smoke-Test `i2pAvailable`-Detection muss grün sein
- Nach Phase 10: Lokale Builds (AppImage, deb, nsis) müssen erstellt werden können
- Nach Phase 12: CI muss grün sein

## 8. Offene Fragen / Risiken

| # | Frage | Risiko | Mitigation |
|---|---|---|---|
| 1 | **Streaming-Protokoll in Node:** Aufwand & Korrektheit | Hoch — wir haben keine erprobte Node-Implementation | Wir orientieren uns an Java's `streaming.jar` (Public Domain). Spec: https://i2p.net/en/docs/specs/streaming/ |
| 2 | **Java-Runtime auf Desktop** | Mittel — User-Setup nötig | Setup-Scripts; klare UI-Hilfe bei `i2pAvailable === false` |
| 3 | **i2pd↔Java-I2P Identitäts-Kompatibilität** | Niedrig — verschiedene Crypto-Defaults | Migration erfordert neue Identität; UI-Hinweis |
| 4 | **A52/A54/A50-Reachability nach Java-I2P-Wechsel** | Mittel — A54 historisch mit i2p-android-App-Problemen | Validierung in Phase 1; ggf. Workaround wie bei A54 (siehe `secuchat-android-bugs-2026-08-11`) |
| 5 | **Ed25519-Signer-Type-Konsistenz** | Niedrig — SAM-Bridge könnte DSA-Default nutzen | Wir setzen explizit `SIGNATURE_TYPE=EdDSA_SHA512_Ed25519` (Properties) |

## 9. Anhang

### 9.1 Referenzierte Memory-Files

- [[secuchat-i2pd-socket-binds-stream-2026-08-05]] — i2pd#1255-Blocker (Begründung für Weggang)
- [[secuchat-i2cp-port-analysis-2026-08-17]] — Detail-Inventur Android → TS Portierung
- [[2026-08-07-secuchat-i2cp-client-android-design]] — Android-Pendant, Vorbild
- [[secuchat-android-bugs-2026-08-11]] — A54-b32-Stale-Contact-Bug (relevant für Cross-Plattform-Chats)

### 9.2 I2CP-Spec-Refs

- I2CP-Overview: https://i2p.net/en/docs/specs/i2cp-overview/
- I2CP-Messages: https://i2p.net/en/docs/specs/i2cp/
- Streaming-Protocol: https://i2p.net/en/docs/specs/streaming/
- Common-Structures: https://i2p.net/en/docs/specs/common-structures/

### 9.3 Setup-URLs

- Linux: https://i2p.net/en/docs/guides/installing-i2p-on-debian-and-ubuntu/
- Windows: https://files.i2p.net/2.13.0/i2pinstall_2.13.0_windows.exe
