# SecuChat — I2CP LeaseSet-Authority (Spec G)

**Datum:** 2026-08-25
**Status:** Design approved (Brainstorming abgeschlossen, wartet auf Plan)
**Branch-Kontext:** baut auf `fix/electron-i2cp-startup-retry` (88d863e, gemerged) auf
**Vorgänger:** [[2026-08-17-secuchat-i2cp-client-desktop-design]] (Phasen A-F), [[2026-08-19-i2cp-createsession-fix-design]] (Phase F, gemerged als PR #209)
**Scope:** Spec G — LeaseSet-Authority. Spec H (DestReply + Stream-Bidirektionalität) und Spec I (Connected-State + Doku + identity-store) sind separate Folge-Specs.

## 1. Zusammenfassung & Motivation

### 1.1 Problem

Der Electron-`I2CPSocketManager` ([electron/src/i2p/i2cp-socket-manager.ts:425-454](electron/src/i2p/i2cp-socket-manager.ts#L425-L454)) ruft nach `SESSION_STATUS=Created` direkt `publishLeaseSet()` auf und sendet ein **selbstgebautes Placeholder-LeaseSet** an den Router:

```typescript
// AKTUELL (Bug):
const localHash = new Uint8Array(32);
Buffer.from(identity.encryptionPublicKey).copy(localHash, 0);  // ← eigener Pub-Key als Tunnel-Gateway
const lease = {
  tunnelGw: localHash,
  tunnelId: 0,                                                  // ← unsinnige ID
  endDateSeconds: publishedSeconds + 10 * 60,
};
```

Konsequenzen:

1. **LeaseSet-Publishing ist ungültig**: `tunnelGw` zeigt auf einen Hash, der nicht zu einem echten Inbound-Tunnel des Routers gehört. `tunnelId = 0` ist die Default-ID für „noch nicht zugewiesen".
2. **Bidirektionaler Chat blockiert**: Java-I2P akzeptiert das syntaktisch korrekte, aber semantisch falsche LeaseSet, publiziert es im DHT. Andere Peers können es via DestLookup finden, schlagen aber bei `STREAM CONNECT` fehl, weil der Tunnel-Gateway gar nicht existiert.
3. **Identische Symptomatik zu Android-Bug 3** (LeaseSet-Publish-Fix vom 2026-08-04, Commit `0071872`): kein Code-Pfad in Electron wartet auf die Router-seitige Tunnel-Bereitstellung, bevor das LeaseSet signiert und publiziert wird.

### 1.2 Ziel

Electron/Desktop soll exakt dem **Java-I2P-Spec-Flow** `RequestVariableLeaseSet` folgen:

1. Router baut Tunnel-Pool intern
2. **Router → Client**: `REQUEST_VARIABLE_LEASE_SET` (37) oder Legacy `REQUEST_LEASE_SET` (21) mit Lease-Material
3. **Client validiert** das Material (Destination-Match, Lease-Format, Clock-Skew)
4. **Client signiert** das LeaseSet2 mit seinem lokalen Destination-Signing-Key
5. **Client → Router**: `CREATE_LEASE_SET_2` (41) als Bestätigung
6. **Router akzeptiert + publiziert** im DHT (DatabaseStore)

### 1.3 Nicht-Ziele (Spec G)

- ❌ DestReply-Java-I2P-Format (Spec H)
- ❌ Stream-Bidirektionalität für eingehende Streams (Spec H)
- ❌ Connected-State-Semantik (Spec I)
- ❌ Doku-Konsolidierung cross-platform-chat.test.ts vs. i2p-electron.test.ts (Spec I)
- ❌ identity-store.test.ts permission-denied-Test-Fix (Spec I)
- ❌ i2pd-Kompatibilität — explizit **out-of-scope** wegen User-Direktive (siehe [[secuchat-i2pd-uninstalled-2026-08-19]]): i2pd hat große Bugs, die die Verwendung in diesem Projekt ausschließen
- ❌ Java-I2P-Versionen < 2.7.0 — wir testen gegen 2.13.0 (aktuelles Vanilla-Release)
- ❌ EncryptedLS (storeType=5) und MetaLS (storeType=7) — initial nur `storeType=3` (LeaseSet2)

## 2. Architektur

### 2.1 Message-Richtung (RequestVariableLeaseSet)

Per [Java-I2P-Doc §RequestLeaseSetMessage](https://eyedeekay.github.io/javadoc-i2p/net/i2p/data/i2cp/package-summary.html) und [i2p.net I2CP-Spec](https://i2p.net/en/docs/specs/i2cp-overview):

| Schritt | Richtung | Message-Type | Wer | Inhalt |
|---|---|---|---|---|
| 1 | (intern) | — | Router | Baut Tunnel-Pool (interner Schritt, kein Wire) |
| 2 | Router → Client | `REQUEST_VARIABLE_LEASE_SET` (37) **bevorzugt** oder `REQUEST_LEASE_SET` (21) Legacy | Router | Destination + Lease-Material + zu signierender Bereich |
| 3 | (intern) | — | Client | Plausibility-Checks (siehe 3.3) |
| 4 | (intern) | — | Client | Ed25519-Signatur über `0x03 \|\| LeaseSet2-Blob` mit `privKey[64..96]` |
| 5 | Client → Router | `CREATE_LEASE_SET_2` (41) | Client | Signiertes LeaseSet (Destination \|\| published \|\| expires \|\| flags \|\| options \|\| encKeys \|\| leases \|\| signature \|\| privateKeys) |
| 6 | (intern) | — | Router | Validiert Signatur + publiziert via DatabaseStore ins DHT |

### 2.2 Datentrennung `leaseSetBytesWithoutSignature` vs `databaseStoreSignableBytes`

Der Spec-konforme Signatur-Input ist `0x03 \|\| (LeaseSet2-alles-vor-signature)`. Wir trennen die beiden Stufen explizit im Parser-Output, um Doppelpräfix-Bugs zu vermeiden:

- `leaseSetBytesWithoutSignature: Buffer` — LeaseSet2-Body ohne die 64-Byte-Signatur
- `databaseStoreSignableBytes: Buffer` — `Buffer.concat([Buffer.from([0x03]), leaseSetBytesWithoutSignature])`

### 2.3 Aktueller Bug-Pfad

`i2cp-socket-manager.ts:316-326` (in `handleIncomingMessage` für `SESSION_STATUS=Created`):

```typescript
// AKTUELL (Bug):
if (status === 1 /* Created */) {
  this.sessionReady = true;
  // ...
  void this.publishLeaseSet();   // ← schickt Placeholder-LeaseSet
}
```

**Fix**: Statt `void this.publishLeaseSet()` setzen wir nur `this.leaseSetState = 'awaiting-router-request'` und starten den `leaseSetRequestTimeout`-Timer (60 s). Der LeaseSet-Flow wird durch den **Inbound-Handler für REQUEST_LEASE_SET / REQUEST_VARIABLE_LEASE_SET** angestoßen, nicht durch uns.

### 2.4 Aktualisierter Datenfluss (korrekt)

```
SESSION_STATUS=Created (eingehend)
  ↓
sessionReady = true
  ↓
leaseSetState = 'awaiting-router-request'
  ↓
leaseSetRequestTimeout = setTimeout(60s) — falls Router still bleibt → 'failed'
  ↓
(wartend)
  ↓
Router → Client: REQUEST_VARIABLE_LEASE_SET (37) [oder REQUEST_LEASE_SET (21)]
  ↓
parseRequestVariableLeaseSet(payload) → ParsedLeaseSetRequest
  ↓
validateParsedLeaseSetRequest(parsed, expectedIdentity, currentRouterTimeSeconds)
  ↓
leaseSetState = 'signing'
  ↓
Ed25519.sign(databaseStoreSignableBytes, privKey[64..96])
  ↓
leaseSetState = 'submitted'
  ↓
sende CREATE_LEASE_SET_2 (41) an Router
  ↓
lokal signatur-selbst-verify (sanity check)
  ↓
leaseSetState = 'published-assumed'
  ↓
currentLeases, currentPublished, currentExpires gesetzt
  ↓
startLeaseSetExpiryWatchdog(min(lease.endDateSeconds) - 60s)
```

## 3. Komponenten

### 3.1 Neue Datei `electron/src/i2p/i2cp-lease-set-request.ts`

Verantwortung: Parser + Validator für eingehende REQUEST_LEASE_SET (21) und REQUEST_VARIABLE_LEASE_SET (37). Getrennt von `i2cp-session-creator.ts` (das für **ausgehende** Frames zuständig ist).

```typescript
export type LeaseSetState =
  | 'idle'
  | 'awaiting-router-request'
  | 'validating'
  | 'signing'
  | 'submitted'
  | 'published-assumed'
  | 'failed';

export interface ParsedLeaseSetRequest {
  sessionId: number;
  storeType: 3;
  identity: IdentityEx;
  publishedSeconds: number;
  expiresSeconds: number;
  flags: number;
  options: Map<string, string>;
  encryptionKeys: Array<{ encryptionType: number; publicKey: Uint8Array }>;
  leases: Lease2[];
  leaseSetBytesWithoutSignature: Buffer;
  databaseStoreSignableBytes: Buffer;
}

export function parseRequestLeaseSet(payload: Buffer): ParsedLeaseSetRequest;
export function parseRequestVariableLeaseSet(payload: Buffer): ParsedLeaseSetRequest;
export function validateParsedLeaseSetRequest(
  parsed: ParsedLeaseSetRequest,
  expectedIdentity: IdentityEx,
  currentRouterTimeSeconds: () => number,
): void;
```

### 3.2 Änderungen in `i2cp-socket-manager.ts`

#### Neue Felder

```typescript
private leaseSetState: LeaseSetState = 'idle';
private currentLeases: Lease2[] = [];
private currentPublished = 0;
private currentExpires = 0;
private leaseSetExpiryWatchdog: NodeJS.Timeout | null = null;
private leaseSetRequestTimeout: NodeJS.Timeout | null = null;
private getDateRefreshTimer: NodeJS.Timeout | null = null;   // bestehender Bug: Handle speichern
private parseErrorCount = 0;
private static readonly MAX_PARSE_ERRORS = 5;
private static readonly LEASE_SET_REQUEST_TIMEOUT_MS = 60_000;
private static readonly LEASE_SET_WATCHDOG_MARGIN_SEC = 60;
private static readonly LEASE_SET_CLOCK_SKEW_FUTURE_SEC = 60;
private static readonly LEASE_SET_CLOCK_SKEW_PAST_SEC = 300;
private static readonly LEASE_SET_MIN_END_BUFFER_SEC = 30;
```

#### Entfernte Methode

`private async publishLeaseSet(): Promise<void>` — komplett entfernt. Der Placeholder-Build ist obsolet.

#### Neue Methoden

```typescript
private startLeaseSetRequestTimeout(): void { /* setTimeout 60s → 'failed' */ }
private clearLeaseSetRequestTimeout(): void { /* clearTimeout + null */ }
private startLeaseSetExpiryWatchdog(): void { /* siehe 3.4 */ }
private clearLeaseSetExpiryWatchdog(): void { /* clearTimeout + null */ }
private handleRequestLeaseSet(msg: { sessionId: number; payload: Buffer }): void { /* siehe 3.5 */ }
public getLeaseSetState(): LeaseSetState { return this.leaseSetState; }
public getLeaseSetInfo(): { state: LeaseSetState; published: number; expires: number; leases: number } | null;
```

#### Geänderte Methoden

- `handleIncomingMessage()` für `SESSION_STATUS=Created` (Z. 316-326): nur `leaseSetState = 'awaiting-router-request'` setzen + `startLeaseSetRequestTimeout()` aufrufen. **Kein** direkter `publishLeaseSet()`-Call mehr.
- `handleIncomingMessage()` für `REQUEST_LEASE_SET` (21) und `REQUEST_VARIABLE_LEASE_SET` (37): neuer Dispatcher-Branch → `handleRequestLeaseSet(msg)`.
- `disconnect()` (Z. 685-713): alle 3 Timer explizit mit `clearTimeout` / `clearInterval` clearet (nicht nur `.unref()`), State zurücksetzen, `currentLeases` leeren, `parseErrorCount` reset.
- `isSessionReady()` bleibt unverändert (separater TCP-Layer-Indikator).

### 3.3 Validation-Regeln (final)

`validateParsedLeaseSetRequest` prüft:

| Regel | Wert |
|---|---|
| Destination byte-exact | `parsed.identity.toByteArray() === expectedIdentity.toByteArray()` |
| Request-`sessionId` match | `parsed.sessionId === this.i2cpSessionId` |
| `storeType` Policy | `=== 3`; andere → explicit `unsupported` log + `throw` |
| `expiresSeconds` Range | `<= 65535` (~18,2 h) |
| `leases.length` Range | `[1, 16]` (Java-I2P-Cap: max 16 Leases pro LeaseSet2, sonst schlägt Router-Acceptance fehl) |
| `lease.tunnelGw.length` | `=== 32` |
| `publishedSeconds` Future-Skew | `<= currentRouterTimeSeconds() + 60` |
| `publishedSeconds` Past-Skew | `>= currentRouterTimeSeconds() - 300` |
| `lease.endDateSeconds > publishedSeconds` | für jede Lease |
| `lease.endDateSeconds > currentRouterTimeSeconds() + 30` | Mindestpuffer pro Lease |

### 3.4 Watchdog (kein Client-Trigger)

Java-I2P sendet LeaseSet-Updates automatisch vor Expiry. Der Client **triggert keinen Request**, sondern wartet passiv und hat nur einen Watchdog als Backup. Wenn der Watchdog anschlägt, **senden wir nichts** — wir markieren nur `leaseSetState = 'awaiting-router-request'` und warten weiter. Optional (Policy-Entscheidung nach 2. Watchdog-Tick): DESTROY_SESSION (3) + Reconnect.

```typescript
private startLeaseSetExpiryWatchdog(): void {
  this.clearLeaseSetExpiryWatchdog();
  if (this.currentLeases.length === 0) return;

  const now = this.currentRouterTimeSeconds();
  const minEndDate = Math.min(...this.currentLeases.map(l => l.endDateSeconds));
  const delayMs = Math.max(0, minEndDate - I2CPSocketManager.LEASE_SET_WATCHDOG_MARGIN_SEC - now) * 1000;

  this.leaseSetExpiryWatchdog = setTimeout(() => {
    if (this.disconnected || !this.socket) return;
    console.warn(`I2CPSocketManager: LeaseSet expires in ≤60s and no router refresh received (state=${this.leaseSetState})`);
    if (this.leaseSetState !== 'awaiting-router-request') {
      this.leaseSetState = 'awaiting-router-request';
    }
    // KEIN aktiver Client-Trigger. Router muss selbst REQUEST_LEASE_SET schicken.
    // Optional nach Policy: DESTROY_SESSION (3) + Reconnect.
  }, delayMs);
  this.leaseSetExpiryWatchdog.unref(); // zusätzlich, primär ist clearTimeout
}
```

### 3.5 Inbound-Handler REQUEST_LEASE_SET / REQUEST_VARIABLE_LEASE_SET

In `handleIncomingMessage()`:

```typescript
if (msg.type === I2CP_MSG.REQUEST_LEASE_SET || msg.type === I2CP_MSG.REQUEST_VARIABLE_LEASE_SET) {
  this.handleRequestLeaseSet({
    sessionId: msg.sessionId ?? 0,
    payload: msg.payload,
    type: msg.type,
  });
  return;
}
```

`handleRequestLeaseSet` führt aus:

1. `parseRequestLeaseSet` oder `parseRequestVariableLeaseSet` je nach `msg.type`
2. Bei Parse-Error: `parseErrorCount++`; bei `parseErrorCount > MAX_PARSE_ERRORS` → DESTROY_SESSION + Reconnect
3. `validateParsedLeaseSetRequest(parsed, thisIdentity, () => this.currentRouterTimeSeconds())` — wirft bei Validation-Error; gleiche Zähler-Logik
4. `leaseSetState = 'signing'`
5. `Ed25519.sign(parsed.databaseStoreSignableBytes, this.opts.privKey.subarray(64, 96))` → 64-Byte-Signatur
6. Baue `CREATE_LEASE_SET_2`-Frame mit den geparsten Daten + neuer Signatur + Private-Keys aus `this.opts.privKey.subarray(0, 32)` (encryptionType=0 für ElGamal-kompatibel)
7. Sende Frame via `this.socket.write(frame)`
8. Lokale Sanity-Verify: `Ed25519.verify(signature, parsed.databaseStoreSignableBytes, thisIdentity.signingPublicKey)` — bei Failure → DESTROY_SESSION + Reconnect
9. `leaseSetState = 'published-assumed'`
10. Setze `currentLeases`, `currentPublished = parsed.publishedSeconds`, `currentExpires = parsed.expiresSeconds`
11. `clearLeaseSetRequestTimeout()` + `startLeaseSetExpiryWatchdog()`

### 3.6 GET_DATE-Timer-Handle (bestehender Bug)

Der bestehende `setInterval` für GET_DATE-Refresh in `i2cp-socket-manager.ts:218-225` speichert keinen Timer-Handle. Wir fixen das im selben Patch, damit `disconnect()` ihn sauber clearet:

```typescript
this.getDateRefreshTimer = setInterval(() => { /* ... */ }, 30 * 60 * 1000);
this.getDateRefreshTimer.unref();
```

### 3.7 Cleanup in `disconnect()`

```typescript
async disconnect(): Promise<void> {
  this.disconnected = true;

  // Timer explizit mit clearTimeout/clearInterval (nicht nur .unref())
  if (this.leaseSetExpiryWatchdog) { clearTimeout(this.leaseSetExpiryWatchdog); this.leaseSetExpiryWatchdog = null; }
  if (this.leaseSetRequestTimeout) { clearTimeout(this.leaseSetRequestTimeout); this.leaseSetRequestTimeout = null; }
  if (this.getDateRefreshTimer)    { clearInterval(this.getDateRefreshTimer); this.getDateRefreshTimer = null; }

  // LeaseSet-State zurücksetzen
  this.leaseSetState = 'idle';
  this.currentLeases = [];
  this.currentPublished = 0;
  this.currentExpires = 0;
  this.parseErrorCount = 0;

  // ... existing stream/socket cleanup unverändert ...
}
```

## 4. Fehlerbehandlung

| Fehler | Verhalten |
|---|---|
| Router sendet kein REQUEST_LEASE_SET innerhalb 60 s nach SESSION_STATUS=Created | `leaseSetState = 'failed'`; nach 3 Reconnect-Versuchen via DESTROY_SESSION (3) → I2CP-Socket neu aufbauen |
| Parse-Fehler in REQUEST_LEASE_SET-Payload | `parseErrorCount++`; bei `> MAX_PARSE_ERRORS=5` → DESTROY_SESSION + Reconnect |
| Validation-Error (Destination-Mismatch, Clock-Skew, ungültige Lease-Daten) | `parseErrorCount++`; gleiche Eskalation |
| `storeType !== 3` | explicit `unsupported` log + ignore (kein Crash) |
| Eigene Signatur-Verify schlägt fehl | log error + DESTROY_SESSION + Reconnect |
| Destination-Mismatch (Sicherheit) | log error + `leaseSetState='failed'` + DESTROY_SESSION |
| TCP-Disconnect während pending LeaseSet-Reply | pending Promises rejecten, State zurücksetzen |
| Router-disconnect während `awaiting-router-request` | State → `idle` (vom nächsten `initialize()` überschrieben) |

## 5. Test-Strategie

### 5.1 Unit-Tests (`i2cp-lease-set-request.test.ts`, NEU)

- **Parser-Round-Trip**: Eingabe-Frame (manuell nach Java-I2P-Spec konstruiert) → Parse → rekonstruierter LeaseSet2-Blob → lokale Signatur-Verify
- **Validation**: alle 10 Regeln aus 3.3 als je ein Test, plus Negativ-Beispiele
- **Java-I2P-Body-Shapes**: variable Sub-Field-Größen (analog zu SESSION_STATUS-Bug aus PR #209 / [[secuchat-i2cp-wire-format-fix-2026-08-20]])
- **Edge-Cases**: leere Leases (sollte fail wegen `leases.length >= 1`), `expiresSeconds=65535` (max), `publishedSeconds` genau +60s (max-Skew)
- **storeType-Policy**: 1, 5, 7 → `throw`

### 5.2 State-Machine-Tests (Erweiterung `i2cp-socket-manager.test.ts`)

- `idle` → `awaiting-router-request` (nach SESSION_STATUS=Created)
- `awaiting-router-request` → `validating` (bei REQUEST_EMPFANG)
- `validating` → `signing` → `submitted` → `published-assumed` (Happy Path mit Mock-Frame)
- `awaiting-router-request` → `failed` (nach 60 s ohne Request)
- `parseErrorCount` Eskalation (5 Fehler → DESTROY_SESSION)
- **Cleanup-Tests**: nach `disconnect()` sind alle 3 Timer-Handles `null`, `leaseSetState === 'idle'`

### 5.3 Wire-Format-Reference-Frames

Strategy: **B (empfohlen) — Live-Aufzeichnung gegen Java-I2P 2.13.0**

Ablauf:

1. Einmaliger Live-Run von `electron/smoke-i2cp.mjs` gegen lokalen Java-I2P-Router (Installation per [[secuchat-i2pd-uninstalled-2026-08-19]]-Workaround: offizielles upstream-`i2p`-Paket aus `deb.i2p.net`)
2. Während `SESSION_STATUS=Created` → Antwort-Frames des Routers aufzeichnen (REQUEST_VARIABLE_LEASE_SET oder REQUEST_LEASE_SET inkl. Body)
3. In `electron/src/i2p/fixtures/i2cp-lease-set-recorded/` ablegen (BIN + HEX + JSON-Annotation)
4. Vitest-Round-Trip-Test parst die Live-Frames, baut CREATE_LEASE_SET_2 zurück, vergleicht gegen das, was Java-I2P tatsächlich akzeptiert hat

**Warum nicht A (Java-I2P-Source abgeleitet)**: Spec-Drift-Risiko (siehe Lessons-Learned in [[secuchat-i2cp-spec-compliance-2026-08-19]]). Live-Aufzeichnung ist byte-exact gegen den echten Router.

### 5.4 Live-Smoke (`electron/smoke-i2cp.mjs` Erweiterung)

Nach erfolgreichem SESSION_STATUS=Created:

1. Warten auf Router-Request (REQUEST_VARIABLE_LEASE_SET oder REQUEST_LEASE_SET)
2. Validieren: Electron sendet CREATE_LEASE_SET_2 mit den Router-Leases + Ed25519-Signatur
3. Validieren: LeaseSet ist im Netzwerk erreichbar (DestLookup von außen findet es via Java-I2P-Console `/i2p/?page=leasesets`)
4. Akzeptanz: bidirektionaler Chat A50↔Electron funktioniert mit echtem PGP-Key (siehe [[secuchat-android-bridge-e2e-2026-08-04]] für bewährtes Test-Setup)

### 5.5 Akzeptanzkriterien

1. ✅ Kein `publishLeaseSet()` mit Placeholder-Daten — `localHash` aus `encryptionPublicKey` und `tunnelId: 0` als Platzhalter eliminiert
2. ✅ Inbound-Dispatcher verarbeitet REQUEST_LEASE_SET (21) und REQUEST_VARIABLE_LEASE_SET (37)
3. ✅ CREATE_LEASE_SET_2 wird nur als Antwort auf Router-Material gesendet (nie selbst-initiiert)
4. ✅ Kein `tunnelId = 0` aus Placeholder-Logik im Code-Pfad (Router darf es schicken, dann wird es 1:1 zurückgesendet)
5. ✅ Alle 3 Timer-Typen mit gespeicherten Handles, `clearTimeout` / `clearInterval` in `disconnect()`
6. ✅ `storeType !== 3` → explicit `unsupported` log + throw (kein silent pass)
7. ✅ Pending-Promises werden bei Disconnect rejected
8. ✅ `parseErrorCount > 5` → DESTROY_SESSION + Reconnect
9. ✅ **LeaseSet-Korrektheit** (Spec-G-eigene Akzeptanz): Electron publiziert ein LeaseSet, das via Java-I2P-Console `/i2p/?page=leasesets` mit den exakten Tunnel-Gateways + Tunnel-IDs + Expiry sichtbar ist, die im REQUEST_VARIABLE_LEASE_SET standen. Bidirektionaler Chat A50↔Electron ist erst Akzeptanzkriterium **nach** Spec H (Stream-Bidirektionalität) — Spec G ermöglicht ihn nur.

## 6. Out-of-Scope (Spec G)

Explizit **nicht** in dieser Spec — separate Folge-Specs:

| Punkt | Spec |
|---|---|
| DestReply Java-I2P-Format (Body 0/32/387+ statt 2+4+387+) | Spec H |
| Stream-Bidirektionalität für eingehende Streams (Antworten auf server-initiierte Streams) | Spec H |
| `connected-state` Semantik (`tcpConnected` / `sessionCreated` / `leaseSetPublished` / `readyForPeerTraffic`) | Spec I |
| Doku-Konsolidierung `cross-platform-chat.test.ts` vs. `i2p-electron.test.ts` | Spec I |
| `identity-store.test.ts` permission-denied-Test-Fix (Container-Setup) | Spec I |
| i2pd-Kompatibilität | — (User-Direktive: ausgeschlossen) |
| EncryptedLS (storeType=5) / MetaLS (storeType=7) | — (später, wenn benötigt) |
| Java-I2P-Versionen < 2.7.0 | — (Legacy, out-of-scope) |

## 7. Offene Fragen / Risiken

### 7.1 Java-I2P-Setup auf Test-Host

Voraussetzung für Live-Smoke: externer I2CP-TCP-Server auf `127.0.0.1:7654`. Per [[secuchat-i2cp-debian-no-external-server]]: Debian `i2p-router 2.12.1-1~ubuntu2` hat **keinen** externen I2CP-Server (nur loopback-intern). Workaround: offizielles upstream-`i2p`-Paket aus `deb.i2p.net` installieren (siehe i2p.net-Installations-Guide) **vor** Implementation-Beginn.

### 7.2 i2pd-Kompatibilität explizit ausgeschlossen

Per User-Direktive vom 2026-08-25: i2pd hat große Bugs, die die Verwendung in diesem Projekt ausschließen. Wir testen **nur** gegen Java-I2P. Frühere Empfehlungen, i2pd als Live-Test-Router zu nutzen (siehe Memory-Notes vor 2026-08-19), sind obsolet.

### 7.3 Mock-only-Tests sind kein Go-Signal

Lessons-Learned aus PR #209 ([[secuchat-i2cp-spec-compliance-2026-08-19]]): 160 vitest grün + 4 Task-Reviewer-Approvals waren broken — erst der Live-Smoke gegen Java-I2P hat die 295B/391B-Destination-Drift aufgedeckt. Für Spec G gilt: **Wire-Format-Round-Trip gegen Live-Frames ist Pflicht-Akzeptanzkriterium**, nicht Mock-only-Tests.

### 7.4 Timer-Handle-Speicherung im bestehenden GET_DATE-Interval

Der bestehende 30-Min-GET_DATE-Refresh speichert seinen Timer-Handle nicht, was bedeutet: bei `disconnect()` läuft der Callback potenziell noch ein Mal. Das ist nicht kritisch (Handler prüft `socket.destroyed`), aber unschön. Wir fixen das im selben Patch.

## 8. Anhang

### 8.1 Referenzierte Memory-Files

- [[secuchat-i2cp-spec-compliance-2026-08-19]] — Phase F abgeschlossen, 160 vitest grün, Live-Smoke verifiziert
- [[secuchat-i2cp-wire-format-fix-2026-08-20]] — Post-Merge-Fix (391B-Destination-Form + 3B/5B/6B-SESSION_STATUS)
- [[secuchat-i2cp-createsession-spec-mismatch]] — ursprünglicher Wire-Format-Bug-Befund
- [[secuchat-i2cp-leaseset2-wire-format]] — LeaseSet2-Wire-Format-Spec-Detail
- [[secuchat-android-bridge-e2e-2026-08-04]] — Bug 3 LeaseSet-Publish-Fix als Vorlage (Android-SAM, ähnliche Symptomatik)
- [[secuchat-i2cp-debian-no-external-server]] — Workaround für Live-Smoke-Setup
- [[secuchat-i2pd-uninstalled-2026-08-19]] — i2pd-Verbot, korrekte Java-I2P-Installation
- [[secuchat-electron-i2cp-startup-retry-2026-08-25]] — Vorgänger-Branch mit Retry-Backoff in `isI2pAvailable()`
- [[secuchat-linux-i2p-cleanup-2026-08-25]] — Linux Vanilla-Java-I2P 2.13.0 als Grundlage

### 8.2 Spec-Referenzen

- [Java-I2P-Doc: I2CP Package Summary](https://eyedeekay.github.io/javadoc-i2p/net/i2p/data/i2cp/package-summary.html) — RequestLeaseSetMessage, CreateLeaseSetMessage2, SESSION_STATUS-Body-Shapes
- [i2p.net I2CP-Spec Overview](https://i2p.net/en/docs/specs/i2cp-overview/) — §RequestVariableLeaseSet, §CreateLeaseSetMessage2
- [i2p.net Common-Structures](https://i2p.net/en/docs/specs/common-structures/) — §LeaseSet2 (387-Byte-IdentityEx, 40-Byte-Lease2)
- [i2p.net LeaseSet-Spec](https://i2p.net/en/docs/specs/leasesets/) — §LeaseSet2-Format

### 8.3 Setup-URLs

- [i2p.net Debian/Ubuntu-Installation](https://i2p.net/en/docs/guides/installing-i2p-on-debian-and-ubuntu/) — Workaround gegen Debian-Pkg-Limitation
- [i2p.net Debian-Repo](https://deb.i2p.net/) — offizielles upstream-Paket-Repository
- [Java-I2P Source: Destination.java](https://github.com/i2p/i2p.i2p/blob/master/core/java/src/net/i2p/data/Destination.java) — 391B-Wire-Format-Referenz
- [Java-I2P Source: SigningPublicKey.java](https://github.com/i2p/i2p.i2p/blob/master/core/java/src/net/i2p/data/SigningPublicKey.java) — `getPadding(cert)`-Mechanik
- [Java-I2P Source: PrivateKey.java](https://github.com/i2p/i2p.i2p/blob/master/core/java/src/net/i2p/data/PrivateKey.java) — 384→128-Byte-Migration-Referenz

### 8.4 Vorhandene Code-Anker

| Datei | Zeilen | Rolle |
|---|---|---|
| `electron/src/i2p/i2cp-socket-manager.ts` | 425-454 | Placeholder-`publishLeaseSet()` (zu entfernen) |
| `electron/src/i2p/i2cp-socket-manager.ts` | 316-326 | `SESSION_STATUS=Created`-Branch (zu ändern) |
| `electron/src/i2p/i2cp-socket-manager.ts` | 218-225 | GET_DATE-Refresh-Interval (Handle speichern) |
| `electron/src/i2p/i2cp-socket-manager.ts` | 685-713 | `disconnect()` (Cleanup erweitern) |
| `electron/src/i2p/i2cp-session-creator.ts` | 384-476 | `encodeCreateLeaseSet2()` (bleibt unverändert) |
| `electron/src/i2p/i2cp-protocol.ts` | SID_LESS_TYPES | SESSION_STATUS bereits korrekt sid-less (aus Phase F) |
| `electron/smoke-i2cp.mjs` | — | Live-Smoke-Script (zu erweitern) |
