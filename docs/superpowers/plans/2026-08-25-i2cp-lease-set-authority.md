# I2CP LeaseSet-Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Konsolidiert Codex-PR #224 (LeaseSet-Authority-Implementation) auf den Branch `fix/electron-i2cp-startup-retry`, fixt den IdentityEx-Round-Trip-Bug im Parser und ergänzt den Live-Smoke-Step.

**Architecture:** Cherry-Pick der drei Codex-Files auf unseren Branch, gefolgt von zwei chirurgischen Fixes: (1) neue Factory `IdentityEx.fromDestinationBytes()` für byte-exact Round-Trip, (2) Parser verwendet diese Factory statt `IdentityEx.fromPrivKey()` mit synthetisiertem Priv-Blob. Live-Smoke-Step in `electron/smoke-i2cp.mjs` ergänzt die Java-I2P-Console-Verifikation.

**Tech Stack:** TypeScript, Node.js, vitest, `@noble/ed25519`, Java-I2P 2.13.0 (externer I2CP-TCP-Server auf `127.0.0.1:7654`).

**Spec:** [`docs/superpowers/specs/2026-08-25-i2cp-lease-set-authority-design.md`](../../specs/2026-08-25-i2cp-lease-set-authority-design.md)

## Global Constraints

- **Nur Java-I2P** — kein i2pd (User-Direktive vom 2026-08-25, dokumentiert in [[secuchat-i2pd-uninstalled-2026-08-19]])
- **128-Byte PrivKey-Format** (encryption [0..32] + signing [64..96]) — Legacy 384-Byte-Format wird in `IdentityEx.fromPrivKey()` rejected
- **LeaseSetState-Enum** mit 7 States: `idle | awaiting-router-request | validating | signing | submitted | published-assumed | failed`
- **`storeType === 3`** only (LeaseSet2) — andere Werte explicit `unsupported`-throw
- **Validation-Toleranzen gegen Router-Clock**: `publishedSeconds <= now + 60s` future, `publishedSeconds >= now - 300s` past; jede Lease `endDateSeconds > now + 30s`
- **3 Timer mit Handle-Speicherung** (`leaseSetRequestTimeout`, `leaseSetExpiryWatchdog`, `getDateRefreshTimer`) — `clearTimeout`/`clearInterval` in `disconnect()`, nicht nur `.unref()`
- **`parseErrorCount > 5`** → `disconnect()` (DESTROY_SESSION wird vom laufenden Layer ausgelöst)
- **Wire-Format byte-exakt** gegen Java-I2P 2.13.0 — kein Mock-only-grün als Go-Signal
- **Branch-Operation**: alle Schritte auf Branch `fix/electron-i2cp-startup-retry` (Head vor Plan-Start: `ae98340`)
- **Conventional Commits** mit deutschem Scope-Suffix für SecuChat-Commits (Pattern aus jüngsten Commits: `fix(electron-i2p):`, `docs(spec):`, `feat(android-onboarding):`)

## File Structure

**Wird angelegt:**
- `electron/src/i2p/i2cp-lease-set-request.ts` — Parser + Validator (von Codex-PR)
- `electron/src/i2p/i2cp-lease-set-request.test.ts` — Unit-Tests (von Codex-PR)

**Wird modifiziert:**
- `electron/src/i2p/i2cp-identity.ts` — neue Factory `IdentityEx.fromDestinationBytes()` für byte-exact Round-Trip
- `electron/src/i2p/i2cp-identity.test.ts` — neue Tests für byte-exact Round-Trip (existiert noch nicht, wird angelegt)
- `electron/src/i2p/i2cp-socket-manager.ts` — verwendet `IdentityEx.fromDestinationBytes()` statt `fromPrivKey()` im Parser-Aufruf
- `electron/smoke-i2cp.mjs` — Live-Smoke-Step für LeaseSet-Acceptance gegen Java-I2P

**Unverändert:**
- `electron/src/i2p/i2p-plugin.ts` — Retry-Backoff bereits in Commit `88d863e`
- `electron/src/i2p/i2cp-session-creator.ts` — `encodeCreateLeaseSet2()` bleibt
- `electron/src/i2p/i2cp-protocol.ts` — Message-Type-Konstanten bereits korrekt

---

### Task 1: Codex-Branch rebasen

**Files:**
- Modify: lokaler Branch-State (`fix/electron-i2cp-startup-retry`)

**Voraussetzung:**
- GitHub-Remote `origin` zeigt auf `weedo078/SecuChat`
- Aktueller Branch: `fix/electron-i2cp-startup-retry` bei `ae98340`
- Codex-Branch: `codex/uberprufe-secuchat-auf-i2cp-spezifikation` bei `a9eb4352`

- [ ] **Step 1: Sicherstellen, dass Working-Tree sauber ist**

```bash
git status
git stash list  # falls nicht-leer: getrennt sichern
```

Erwartung: `working tree clean` und leerer stash.

- [ ] **Step 2: Codex-Branch fetchen**

```bash
git fetch origin codex/uberprufe-secuchat-auf-i2cp-spezifikation
```

Erwartung: keine Fehler, Fetch-Bericht zeigt neuen Branch.

- [ ] **Step 3: Codex-Branch-Inhalt prüfen**

```bash
git log --oneline origin/codex/uberprufe-secuchat-auf-i2cp-spezifikation ^ae98340
git diff --stat ae98340..origin/codex/uberprufe-secuchat-auf-i2cp-spezifikation
```

Erwartung: 1 Commit, 3 Files (`i2cp-lease-set-request.ts`, `i2cp-lease-set-request.test.ts`, `i2cp-socket-manager.ts`).

- [ ] **Step 4: Cherry-Pick auf unseren Branch**

```bash
git checkout fix/electron-i2cp-startup-retry
git cherry-pick a9eb4352
```

Erwartung: Konfliktfreier Pick (unser HEAD ae98340 ist nur `docs/superpowers/specs/2026-08-25-i2cp-lease-set-authority-design.md`, Codex-PR hat nur Code-Files).

Falls Konflikt: ABBRECHEN und User informieren — Konflikt deutet auf unerwartete Überschneidung hin.

- [ ] **Step 5: Verifizieren, dass die neuen Files existieren**

```bash
ls -la electron/src/i2p/i2cp-lease-set-request.ts electron/src/i2p/i2cp-lease-set-request.test.ts
git log --oneline -3
```

Erwartung: beide Files vorhanden, 2 neue Commits in `git log` (ae98340 → cherry-pick).

- [ ] **Step 6: Vitest gegen Codex-Tests laufen lassen**

```bash
cd electron && npx vitest run src/i2p/i2cp-lease-set-request.test.ts
```

Erwartung: 5 Tests grün.

Falls rot: ABBRECHEN und User informieren — Codex-PR baut nicht auf unserem Stand.

- [ ] **Step 7: Falls neuer Commit-Stand, kein Commit nötig (cherry-pick hat schon committed)**

```bash
git log -1 --pretty=format:'%h %s'
```

Erwartung: zeigt `Handle router-driven LeaseSet requests and add LeaseSet parsing/validation` (Codex-Message) — sonst manuell `git commit --amend` zur Übernahme.

---

### Task 2: IdentityEx-Round-Trip-Support

**Files:**
- Modify: `electron/src/i2p/i2cp-identity.ts:43-92`
- Create: `electron/src/i2p/i2cp-identity.test.ts`

**Interfaces:**
- Consumes: nichts (Greenfield-Refactor)
- Produces: `IdentityEx.fromDestinationBytes(rawBytes: Buffer): IdentityEx` (statische Factory), `IdentityEx.toByteArray(): Buffer` byte-exact round-tripfähig

- [ ] **Step 1: Failing test schreiben**

Datei `electron/src/i2p/i2cp-identity.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { IdentityEx } from "./i2cp-identity";

describe("IdentityEx round-trip via fromDestinationBytes", () => {
  it("preserves non-NULL KEYCERT_SIGNED (0x05) and non-zero expiration byte-exact", () => {
    const raw = Buffer.alloc(387);
    raw[0] = 0xaa; raw[1] = 0xbb; // 2 bytes of encryption pub (Rest bleibt 0)
    raw[32] = 0xcc; raw[33] = 0xdd; // 2 bytes of signing pub
    raw[64] = 0x05; // KEYCERT_SIGNED (non-NULL)
    raw.writeBigUInt64BE(BigInt(0x0102030405060708), 65); // expiration

    const identity = IdentityEx.fromDestinationBytes(raw);
    const roundtrip = identity.toByteArray();

    expect(roundtrip.equals(raw)).toBe(true);
  });

  it("preserves KEYCERT_NULL (0x00) and zero expiration (back-compat)", () => {
    const raw = Buffer.alloc(387);
    raw[0] = 0x11; raw[32] = 0x22;
    raw[64] = 0x00; // KEYCERT_NULL

    const identity = IdentityEx.fromDestinationBytes(raw);
    expect(identity.toByteArray().equals(raw)).toBe(true);
  });

  it("rejects non-387-byte input", () => {
    expect(() => IdentityEx.fromDestinationBytes(Buffer.alloc(100))).toThrow(/expected 387 bytes/);
  });
});
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

```bash
cd electron && npx vitest run src/i2p/i2cp-identity.test.ts
```

Erwartung: FAIL mit "fromDestinationBytes is not a function".

- [ ] **Step 3: IdentityEx-Klasse umbauen**

`electron/src/i2p/i2cp-identity.ts`:

1. IdentityEx-Konstruktor um `cert: number` erweitern (siehe Code unten).
2. `toByteArray()` schreibt den gespeicherten `cert` statt hardcoded `0x00`.
3. Neue statische Factory `fromDestinationBytes(rawBytes: Buffer): IdentityEx` implementieren.

Konstruktor + statische Factory ersetzen:

```typescript
export class IdentityEx {
  private constructor(
    public readonly encryptionPublicKey: Uint8Array,
    public readonly signingPublicKey: Uint8Array,
    public readonly signingPrivateKey: Uint8Array,
    public readonly cert: number = 0x00,
    public readonly expirationMs: number = 0,
  ) {}

  static fromPrivKey(blob: Uint8Array): IdentityEx {
    if (blob.length === 384) {
      throw new Error(
        'Legacy 384-byte privKey blob detected (encryption-only format). ' +
        'Please migrate to the new 128-byte 2-key Ed25519 format by ' +
        'regenerating the identity (existing key will be discarded — ' +
        'no usable contacts existed with the legacy format).',
      );
    }
    if (blob.length !== 128) {
      throw new Error(`IdentityEx.fromPrivKey: expected 128 bytes, got ${blob.length}`);
    }
    const encPub = Uint8Array.from(blob.subarray(32, 64));
    const signPub = Uint8Array.from(blob.subarray(96, 128));
    const signPriv = Uint8Array.from(blob.subarray(64, 96));
    return new IdentityEx(encPub, signPub, signPriv, 0x00, 0);
  }

  static fromDestinationBytes(rawBytes: Buffer | Uint8Array): IdentityEx {
    if (rawBytes.length !== 387) {
      throw new Error(
        `IdentityEx.fromDestinationBytes: expected 387 bytes, got ${rawBytes.length}`,
      );
    }
    const encPub = Uint8Array.from(rawBytes.subarray(0, 32));
    const signPub = Uint8Array.from(rawBytes.subarray(32, 64));
    const cert = rawBytes[64];
    const expirationMs = Number(rawBytes.readBigUInt64BE(65));
    // NOTE: fromDestinationBytes does NOT have a signingPrivateKey — the
    // wire-format Destination blob only carries public-key material.
    // Callers that need to sign must keep the original 128-byte privKey
    // blob separately and combine via `fromPrivKey` if applicable.
    return new IdentityEx(encPub, signPub, new Uint8Array(32), cert, expirationMs);
  }

  toByteArray(): Buffer {
    const buf = Buffer.alloc(387);
    Buffer.from(this.encryptionPublicKey).copy(buf, 0);
    Buffer.from(this.signingPublicKey).copy(buf, 32);
    buf[64] = this.cert;
    if (this.expirationMs > 0) {
      buf.writeBigUInt64BE(BigInt(this.expirationMs), 65);
    }
    // bytes 73..387 stay zero (padding for Java IdentityEx-Compat)
    return buf;
  }

  sign(data: Uint8Array): Uint8Array {
    return ed.sign(data, this.signingPrivateKey);
  }

  static verify(identity: Buffer, sig: Buffer, data: Buffer): boolean {
    const signingPub = identity.subarray(32, 64);
    return ed.verify(sig, data, signingPub);
  }
}
```

- [ ] **Step 4: Test laufen lassen, muss grün sein**

```bash
cd electron && npx vitest run src/i2p/i2cp-identity.test.ts
```

Erwartung: 3 Tests grün.

- [ ] **Step 5: Volle vitest-Suite laufen lassen (Regression-Check)**

```bash
cd electron && npx vitest run
```

Erwartung: alle bisher grünen Tests bleiben grün; insbesondere `i2cp-session-creator.test.ts` (verwendet `fromPrivKey`) und `i2cp-socket-manager.test.ts` müssen weiterhin passen.

- [ ] **Step 6: Type-check**

```bash
cd electron && npx tsc --noEmit
```

Erwartung: clean.

- [ ] **Step 7: Committen**

```bash
git add electron/src/i2p/i2cp-identity.ts electron/src/i2p/i2cp-identity.test.ts
git commit -m "fix(electron-i2p): IdentityEx byte-exact round-trip via fromDestinationBytes

Coerced 'IdentityEx.fromPrivKey(synthesized-priv-blob)' in
i2cp-lease-set-request.ts (Codex-PR #224) rekonstruierte cert + expiration
neu (immer 0x00 + 0), was den byte-exact Round-Trip bei non-NULL-cert-
oder non-zero-expiration-Destinationen lautlos gebrochen hätte.

Loesung:
- Neue statische Factory IdentityEx.fromDestinationBytes(rawBytes: Buffer)
  parst cert + expiration direkt aus den 387 Wire-Bytes
- toByteArray() schreibt gespeicherten cert-Wert (nicht mehr hardcoded 0x00)
- fromPrivKey() setzt cert=0x00 + expirationMs=0 als Default (back-compat)"
```

---

### Task 3: Parser auf fromDestinationBytes umstellen

**Files:**
- Modify: `electron/src/i2p/i2cp-lease-set-request.ts:80-130` (Body des Parsers)
- Modify: `electron/src/i2p/i2cp-lease-set-request.ts:155-200` (Validator-Signatur)
- Modify: `electron/src/i2p/i2cp-socket-manager.ts` (Aufrufseite von `validateParsedLeaseSetRequest`)

**Interfaces:**
- Consumes: `IdentityEx.fromDestinationBytes(rawBytes: Buffer): IdentityEx` (aus Task 2)
- Produces: `ParsedLeaseSetRequest.destinationBytes: Buffer` (statt `identity: IdentityEx`), `validateParsedLeaseSetRequest(parsed, opts)` mit `opts.expectedDestinationBytes: Buffer`

- [ ] **Step 1: Failing test schreiben**

In `electron/src/i2p/i2cp-lease-set-request.test.ts` neuen Test-Block hinzufügen (am Ende, vor schließender `});`):

```typescript
describe("I2CP LeaseSet request parser — IdentityEx byte-exact round-trip", () => {
  it("accepts REQUEST_VARIABLE_LEASE_SET with non-NULL cert (0x05) byte-exact", () => {
    // Custom identity with non-NULL KEYCERT_SIGNED (0x05) and non-zero expiration
    const raw = Buffer.alloc(387);
    raw[0] = 0xaa; raw[1] = 0xbb;
    raw[32] = 0xcc; raw[33] = 0xdd;
    raw[64] = 0x05;
    raw.writeBigUInt64BE(BigInt(0x0102030405060708), 65);
    const payload = makeRequestPayload(undefined, {});
    // Inject the custom identity bytes into the payload (replace default identity)
    const identityStart = 1; // after storeType byte
    raw.copy(payload, identityStart, 0, 387);

    const parsed = parseRequestVariableLeaseSet(payload);
    expect(parsed.destinationBytes.equals(raw)).toBe(true);
  });
});
```

- [ ] **Step 2: Test laufen lassen, muss fehlschlagen**

```bash
cd electron && npx vitest run src/i2p/i2cp-lease-set-request.test.ts
```

Erwartung: FAIL (entweder weil `parsed.destinationBytes` nicht existiert, oder weil der aktuelle Code cert regeneriert).

- [ ] **Step 3: Parser anpassen**

In `electron/src/i2p/i2cp-lease-set-request.ts`:

1. `ParsedLeaseSetRequest`-Interface: `identity: IdentityEx` → `destinationBytes: Buffer`.

```typescript
export interface ParsedLeaseSetRequest {
  sessionId: number;
  storeType: 3;
  destinationBytes: Buffer;
  publishedSeconds: number;
  expiresSeconds: number;
  flags: number;
  options: Map<string, string>;
  encryptionKeys: Array<{ encryptionType: number; publicKey: Uint8Array }>;
  leases: Lease2[];
  leaseSetBytesWithoutSignature: Buffer;
  databaseStoreSignableBytes: Buffer;
}

export interface ValidateLeaseSetRequestOpts {
  expectedSessionId: number;
  expectedDestinationBytes: Buffer;
  currentRouterTimeSeconds: () => number;
}
```

2. Im Parser-Body (Z. 80-130) den `priv`-Blob-Synthese-Block (Z. 110-126 im Codex-PR) **löschen**. Statt:

```typescript
return {
  ...
  identity: IdentityEx.fromPrivKey(priv),
  ...
};
```

schreibe:

```typescript
return {
  ...
  destinationBytes: Buffer.from(identityBytes), // 387 raw bytes, byte-exact
  ...
};
```

3. `validateParsedLeaseSetRequest`-Funktion: ersetze

```typescript
if (
  !parsed.identity.toByteArray().equals(opts.expectedIdentity.toByteArray())
) {
  throw new Error("LeaseSet request destination mismatch");
}
```

durch

```typescript
if (!parsed.destinationBytes.equals(opts.expectedDestinationBytes)) {
  throw new Error("LeaseSet request destination mismatch");
}
```

- [ ] **Step 4: socket-manager.ts-Aufrufseite anpassen**

In `electron/src/i2cp-socket-manager.ts` im `handleRequestLeaseSet`-Block (ca. Z. 530-548 je nach Codex-Stand):

Suche:

```typescript
const identity = IdentityEx.fromPrivKey(this.opts.privKey);
validateParsedLeaseSetRequest(parsed, {
  expectedSessionId: this.i2cpSessionId,
  expectedIdentity: identity,
  currentRouterTimeSeconds: () => this.currentRouterTimeSeconds(),
});
```

Ersetze durch:

```typescript
const expectedDestination = IdentityEx.fromPrivKey(this.opts.privKey).toByteArray();
validateParsedLeaseSetRequest(parsed, {
  expectedSessionId: this.i2cpSessionId,
  expectedDestinationBytes: expectedDestination,
  currentRouterTimeSeconds: () => this.currentRouterTimeSeconds(),
});
```

- [ ] **Step 5: Vitest für beide Files laufen lassen**

```bash
cd electron && npx vitest run src/i2p/i2cp-lease-set-request.test.ts src/i2p/i2cp-identity.test.ts
```

Erwartung: alle Tests grün, einschließlich des neuen non-NULL-cert-Tests aus Step 1.

- [ ] **Step 6: Volle vitest-Suite + Type-check**

```bash
cd electron && npx vitest run && npx tsc --noEmit
```

Erwartung: keine Regressionen, tsc clean.

- [ ] **Step 7: Committen**

```bash
git add electron/src/i2p/i2cp-lease-set-request.ts electron/src/i2p/i2cp-socket-manager.ts
git commit -m "fix(electron-i2p): use byte-exact IdentityEx round-trip in LeaseSet parser

Ersetzt IdentityEx.fromPrivKey(synth-blob)-Pfad durch das neue
IdentityEx.fromDestinationBytes() aus dem vorigen Commit. Verhindert,
dass non-NULL-cert / non-zero-expiration-Destinationen den
expectedIdentity-Vergleich lautlos failen.

Betrifft:
- ParsedLeaseSetRequest.identity -> ParsedLeaseSetRequest.destinationBytes
- ValidateLeaseSetRequestOpts.expectedIdentity -> expectedDestinationBytes
- validateParsedLeaseSetRequest nutzt Buffer.equals (byte-exact)
- handleRequestLeaseSet baut expectedDestination via
  IdentityEx.fromPrivKey(this.opts.privKey).toByteArray()

Lesson aus Wire-Format-Fix 2026-08-20: 'variable Body-Shapes ueber
Router-Versionen' identisches Pattern — diesmal proaktiv addressiert
statt erst beim Live-Smoke zu entdecken."
```

---

### Task 4: Live-Smoke-Step in electron/smoke-i2cp.mjs

**Files:**
- Modify: `electron/smoke-i2cp.mjs` (existierendes Smoke-Script aus Commit `a0c2704`)

**Voraussetzung:**
- Offizielles `i2p`-apt-Paket aus `deb.i2p.net` ist installiert (per [secuchat-i2cp-debian-no-external-server](secuchat-i2cp-debian-no-external-server.md) — Debian-`i2p-router`-Paket hat keinen externen I2CP-Server)
- I2CP-TCP-Server läuft auf `127.0.0.1:7654`

**Interfaces:**
- Consumes: `electron/src/i2p/i2cp-socket-manager.ts` (exportierte Klassen)
- Produces: Live-Acceptance-Step, der LeaseSet-Publication gegen Java-I2P verifiziert

- [ ] **Step 1: Aktuellen Stand des Smoke-Scripts prüfen**

```bash
cat electron/smoke-i2cp.mjs
```

Erwartung: Script existiert mit CreateSession-Smoke-Step. Wo der `SessionStatus=Created`-Empfang erfolgt, werden wir den LeaseSet-Acceptance-Step anhängen.

- [ ] **Step 2: LeaseSet-Acceptance-Step anhängen**

In `electron/smoke-i2cp.mjs` nach dem `SessionStatus=Created`-Receive-Block folgenden Block einfügen:

```javascript
// ===== LeaseSet-Acceptance (Spec G §5.4) =====
// Wait for the Java-I2P router's REQUEST_VARIABLE_LEASE_SET or
// REQUEST_LEASE_SET message (type 37 or 21). Verify our handler:
//  1. Validates the request against our expected destination (byte-exact)
//  2. Signs and sends CREATE_LEASE_SET_2 (type 41) back
//  3. Reports leaseSetState === 'published-assumed' via getLeaseSetState()
const leaseSetRequest = await waitForI2cpMessage(socketManager, (msg) =>
  msg.type === I2CP_MSG.REQUEST_VARIABLE_LEASE_SET ||
  msg.type === I2CP_MSG.REQUEST_LEASE_SET
);
console.log('[smoke] received LeaseSet request, type=', leaseSetRequest.type);

// Give the handler a moment to send CREATE_LEASE_SET_2 and update state.
await new Promise((r) => setTimeout(r, 1000));

const state = socketManager.getLeaseSetState();
const info = socketManager.getLeaseSetInfo();
console.log('[smoke] leaseSetState =', state);
console.log('[smoke] leaseSetInfo =', info);

if (state !== 'published-assumed') {
  console.error('[smoke] FAIL: expected leaseSetState=published-assumed, got', state);
  process.exit(2);
}
if (!info || info.leases === 0) {
  console.error('[smoke] FAIL: leaseSetInfo missing or zero leases');
  process.exit(2);
}

// Verify in Java-I2P-Console that our LeaseSet is registered with the
// real tunnel-gateway hashes the router sent us (not a placeholder).
const consoleUrl = 'http://127.0.0.1:7657/i2p/?page=leasesets';
console.log('[smoke] verify LeaseSet in Java-I2P console:', consoleUrl);
console.log('[smoke] expected to find destination =', expectedDestinationB32,
            'with', info.leases, 'leases and expiry', info.expires);

// Manual verification step (cannot automate without Java-I2P-Console-auth):
// open consoleUrl in a browser, search for our b32, compare lease
// count + first-tunnel-gateway hash against info.published/expires.
console.log('[smoke] PASS: LeaseSet published-assumed, manual console-verify pending');
```

(Die Helfer `waitForI2cpMessage`, `I2CP_MSG` und die Bindung an den `socketManager` müssen je nach aktuellem Smoke-Script-Stand symbolisch importiert / implementiert werden. Wo das Script schon eine Message-Queue hat, ist `waitForI2cpMessage` ein dünner Wrapper.)

- [ ] **Step 3: Smoke-Script syntaktisch prüfen**

```bash
cd electron && node --check smoke-i2cp.mjs
```

Erwartung: keine Syntaxfehler.

- [ ] **Step 4: Auf einem Host mit Java-I2P 2.13.0 + externem I2CP-Server manuell laufen lassen**

```bash
cd electron && node smoke-i2cp.mjs
```

Erwartung: alle bisherigen Steps (SessionStatus=Created) bleiben grün, neuer LeaseSet-Acceptance-Step loggt `state=published-assumed, leases>=1, expires>published+30s`.

Falls Java-I2P auf diesem Host nicht verfügbar ist (siehe [[secuchat-i2cp-debian-no-external-server]]): Code-Step **trotzdem committen**, Block mit TODO-Kommentar im Smoke-Script:

```javascript
// NOTE: Live-Smoke-Ausfuehrung auf diesem Host blockiert (Debian-i2p-Pkg
// hat keinen externen I2CP-Server). Smoke-Script bleibt committed fuer
// Regressions-Runs nach Installation des offiziellen upstream-i2p-Pakets
// (siehe docs/Build-and-Deploy.md).
```

- [ ] **Step 5: Committen**

```bash
git add electron/smoke-i2cp.mjs
git commit -m "feat(electron-i2p): Live-Smoke-Step fuer LeaseSet-Acceptance

Erweitert electron/smoke-i2cp.mjs um den Java-I2P-Console-Verify-Step
aus Spec G §5.4: nach SESSION_STATUS=Created wird auf REQUEST_LEASE_SET
(21) / REQUEST_VARIABLE_LEASE_SET (37) gewartet, der LeaseSetState via
getLeaseSetState() ausgelesen und der User auf die Java-I2P-Console
/i2p/?page=leasesets fuer manuelle Verifikation hingewiesen.

Out-of-Scope-Box am Ende des Steps dokumentiert, warum der Smoke-Run
auf dem Debian-Host aktuell blockiert ist (kein externer I2CP-Server im
Debian-i2p-router-Paket; offizielles upstream-i2p-Paket aus deb.i2p.net
nocht nicht installiert)."
```

---

### Task 5: Volltests + PR

**Files:**
- Modify: nichts (nur Verifikation + Doku)

- [ ] **Step 1: Vitest-Komplettlauf**

```bash
cd electron && npx vitest run
```

Erwartung: alle Tests grün, keine Regressions.

- [ ] **Step 2: Type-check + Build**

```bash
cd electron && npx tsc --noEmit && cd .. && cd app && npm run build
```

Erwartung: tsc clean, Vite-Build clean.

- [ ] **Step 3: ESLint (soweit konfiguriert)**

```bash
cd electron && npm run lint 2>/dev/null || echo "no lint script, skipping"
```

Erwartung: entweder grün oder Hinweis "no lint script" — kein Hard-Fail.

- [ ] **Step 4: PR erstellen via gh CLI**

```bash
cd /home/g/dev/SecuChat
git push origin fix/electron-i2cp-startup-retry
gh pr create \
  --base main \
  --title "fix(electron-i2p): router-driven LeaseSet publishing with byte-exact IdentityEx" \
  --body "### Motivation

Eliminiert die Placeholder-LeaseSet-Logik (localHash aus
encryptionPublicKey + tunnelId=0) in publishLeaseSet() durch den
Java-I2P-RequestVariableLeaseSet-Flow.

- Vorher: Client baute selbst ein syntaktisch-valides, aber
  semantisch-unsinniges LeaseSet (tunnelGw zeigt auf nichts Existierendes).
- Nachher: Client wartet auf Router-getriebene REQUEST_LEASE_SET (21) /
  REQUEST_VARIABLE_LEASE_SET (37), validiert byte-exact, signiert mit
  Ed25519, sendet CREATE_LEASE_SET_2 (41) zurueck.

### Description

Cherry-Picked Codex-PR #224 auf fix/electron-i2cp-startup-retry mit
zwei chirurgischen Fixes:

1. **IdentityEx-Round-Trip-Support** (electron/src/i2p/i2cp-identity.ts):
   Neue Factory IdentityEx.fromDestinationBytes(rawBytes: Buffer) parst
   cert + expiration direkt aus den 387 Wire-Bytes. toByteArray() schreibt
   den gespeicherten cert (nicht mehr hardcoded 0x00). Verhindert
   Round-Trip-Bruch bei non-NULL-cert oder non-zero-expiration.

2. **Parser auf byte-exact comparison** (i2cp-lease-set-request.ts):
   ParsedLeaseSetRequest.identity -> .destinationBytes, Validierung
   nutzt Buffer.equals. Erweitert um Live-Smoke-Verify-Step in
   electron/smoke-i2cp.mjs.

### Testing

- [x] 5 Unit-Tests aus Codex-PR (parser + validation)
- [x] 3 neue IdentityEx-Round-Trip-Tests
- [x] 1 neuer Non-NULL-cert-Parser-Test
- [x] vitest gruen, tsc clean, app/build clean
- [ ] Live-Smoke gegen Java-I2P 2.13.0: pending offizielles upstream-i2p-Paket
      aus deb.i2p.net (Debian-i2p-router hat keinen externen I2CP-Server)

### Spec

docs/superpowers/specs/2026-08-25-i2cp-lease-set-authority-design.md
"
```

Erwartung: PR erstellt, CI läuft.

- [ ] **Step 5: Memory-Update (Erfolgs-/Misserfolgspfad dokumentieren)**

`/home/g/.claude/projects/-home-g-dev-SecuChat/memory/secuchat-i2cp-leaseset-authority-2026-08-25.md` schreiben:

```markdown
---
name: secuchat-i2cp-leaseset-authority-2026-08-25
description: "Electron-I2CP LeaseSet-Authority auf Router-getriebene REQUEST_LEASE_SET / REQUEST_VARIABLE_LEASE_SET umgestellt (Spec G). Placeholder-Logik eliminiert. Live-Smoke gegen Java-I2P pending."
metadata:
  type: project
---

# I2CP LeaseSet-Authority Spec G (Electron) — 2026-08-25

## Was implementiert wurde

PR [Nummer nach Erstellung] konsolidiert Codex-PR #224 auf
fix/electron-i2cp-startup-retry und fixt zwei Issues:

1. **IdentityEx-Round-Trip-Support** — neue Factory
   `IdentityEx.fromDestinationBytes(rawBytes: Buffer): IdentityEx` parst
   cert + expiration direkt aus den 387 Wire-Bytes. Verhindert, dass
   `IdentityEx.fromPrivKey()` mit synthetisiertem priv-blob cert=0x00 +
   expiration=0 neu generiert und damit den byte-exact Vergleich bei
   non-NULL-cert-Destinationen lautlos bricht.

2. **Parser auf byte-exact comparison** — `ParsedLeaseSetRequest` hat
   jetzt `destinationBytes: Buffer` statt `identity: IdentityEx`,
   `validateParsedLeaseSetRequest` nutzt `Buffer.equals()` statt
   `IdentityEx.toByteArray().equals()`.

3. **Live-Smoke-Step in electron/smoke-i2cp.mjs** — wartet auf
   REQUEST_LEASE_SET / REQUEST_VARIABLE_LEASE_SET, loggt
   `leaseSetState=published-assumed`, verweist auf
   Java-I2P-Console `/i2p/?page=leasesets` fuer manuelle Verifikation.

## Lessons Learned (fuer die naechste Wire-Format-Migration)

- **Codex-PRs nicht blind mergen**: 95% koennen korrekt sein, aber
  ein einziger synthetisierter Pfad (`IdentityEx.fromPrivKey(pseudo-blob)`)
  war identisch zum Bug-Pattern aus
  [[secuchat-i2cp-wire-format-fix-2026-08-20]] (variable Body-Shapes).
  Lessons-Learned: vor jedem Cherry-Pick eines Wire-Format-PRs den
  Round-Trip-Pfad im Parser explizit auditen.
- **Branch-Basis-Konflikte ernst nehmen**: Codex-PR #224 war gegen main
  (ee7cc7ab), unser Branch `fix/electron-i2cp-startup-retry` (88d863e)
  enthaelt zusaetzliche Retry-Backoff-Fixes. Cherry-Pick war sauber,
  aber bei zukuenftigen externen PRs immer Branch-Basis explizit
  verifizieren.
- **Spec G als Grundlage hat sich bewaehrt**: alle drei Sektionen
  (Architektur, Komponenten, Akzeptanzkriterien) waren konkret genug,
  um die Codex-Implementation 1:1 gegen die Spec zu reviewen.
  Akzeptanzkriterium 9 (LeaseSet-Korrektheit via Console-Verify) wurde
  als Live-Smoke-Step implementiert, nicht als Mock-Test.

## Related

- [[secuchat-i2cp-spec-compliance-2026-08-19]] — Phase F, identische
  Lessons-Learned-Struktur (Mock-only-gruen ist nicht Production-ready)
- [[secuchat-i2cp-wire-format-fix-2026-08-20]] — Pattern wieder-
  erkannt: synthetisierte Bytes im Round-Trip
- [[secuchat-i2pd-uninstalled-2026-08-19]] — i2pd ausgeschlossen
- ../docs/superpowers/specs/2026-08-25-i2cp-lease-set-authority-design
- ../docs/superpowers/plans/2026-08-25-i2cp-lease-set-authority
```

Dann `MEMORY.md` ergänzen:

```markdown
- [I2CP LeaseSet-Authority Spec G 2026-08-25](secuchat-i2cp-leaseset-authority-2026-08-25.md) — Codex-PR #224 konsolidiert auf fix/electron-i2cp-startup-retry mit IdentityEx-Round-Trip-Fix + Live-Smoke-Step
```

- [ ] **Step 6: Status-Report an User**

Schreibe kompakte Zusammenfassung mit:
- Welche Tasks erledigt (1-5)
- PR-URL
- Verbleibende manuelle Schritte (Live-Smoke gegen Java-I2P nach
  offizieller `i2p`-Paket-Installation)
- Spec H/I-Status (pending nach PR-Merge)

---

## Self-Review

**Spec-Coverage:**
- §3.1 Neue Datei `i2cp-lease-set-request.ts` → Task 1 (cherry-pick)
- §3.2 `LeaseSetState`-Enum + Felder → Task 1 (cherry-pick)
- §3.3 Validation-Regeln → Task 1 (cherry-pick) + Task 3 (Signatur an `destinationBytes`)
- §3.4 Watchdog → Task 1 (cherry-pick)
- §3.5 Inbound-Handler → Task 1 (cherry-pick), Task 3 (Aufrufseite angepasst)
- §3.6 GET_DATE-Timer-Handle → Task 1 (cherry-pick)
- §3.7 Cleanup in `disconnect()` → Task 1 (cherry-pick)
- §4 Fehlerbehandlung → Task 1 (cherry-pick)
- §5.1 Unit-Tests → Task 1 + Task 2 + Task 3
- §5.2 State-Machine-Tests → Task 1 (cherry-pick) — Codex-PR hat keine expliziten State-Machine-Tests, ggf. Erweiterung als Folge-Task (außerhalb Scope)
- §5.3 Wire-Format-Round-Trip → Task 2 + Task 3 (byte-exact Round-Trip)
- §5.4 Live-Smoke → Task 4
- §5.5 Akzeptanzkriterien 1-9 → abgedeckt durch Tasks 1-5 (Punkt 9 als Live-Smoke-Step)

**Placeholder-Scan:**
- Step-Bezeichnungen alle konkret ("Write failing test", "Implement fromDestinationBytes", "Run test")
- Code-Blöcke alle echt, keine "TODO"-Markierungen außer im expliziten Out-of-Scope-Box in Task 4 Step 4
- Keine "Similar to Task N"-Verweise
- Type-Signaturen konkret (z.B. `IdentityEx.fromDestinationBytes(rawBytes: Buffer): IdentityEx`)

**Type-Consistency:**
- `IdentityEx.fromDestinationBytes` in Task 2 definiert, in Task 3 verwendet
- `ParsedLeaseSetRequest.destinationBytes` in Task 3 Schritt 3 definiert, in Task 3 Schritt 1 Test verwendet (passende Reihenfolge)
- `ValidateLeaseSetRequestOpts.expectedDestinationBytes` in Task 3 Schritt 3 definiert, in Task 3 Schritt 4 socket-manager-Aufruf verwendet

**Lücken:**
- §5.2 State-Machine-Tests sind im Codex-PR **nicht** explizit vorhanden. Spec fordert Tests für `idle → awaiting-router-request → ... → failed`-Transitions. Empfehlung: als Folge-PR nach PR-Merge (außerhalb dieses Konsolidierungs-Plans), um Scope nicht aufzublähen.
- §7.3 Mock-only-Tests-Risiko ist im Plan explizit durch Task 4 (Live-Smoke) addressiert.

Plan ist konsistent und spezifisch genug für einen externen Implementer.