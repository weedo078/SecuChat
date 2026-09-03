# I2CP Destination-Format-Encryption-Layer (Spec H.1) — 2026-09-03

> **For agentic workers:** Dies ist ein Sub-Spec von **Spec H (Bidirektionaler Chat A50↔Electron)**. Es behandelt die Encryption-Layer-Frage, die durch PR #223 Live-Smoke entdeckt wurde. Spec H.1 muss vor H.2-H.4 implementiert sein.

**Goal:** Macht SecuChat's Ed25519-only-Destinations für Java-I2P akzeptabel, indem ein X25519-Encryption-Keypair via libsodium's `crypto_sign_ed25519_*_to_curve25519` Mappings aus dem bestehenden Ed25519-Material abgeleitet wird. Das Encryption-Keypair wird in das LeaseSet eingebettet, das Java-I2P als authentifizierten Encryption-Keypair akzeptiert.

**Architecture:** 387B IdentityEx bleibt unverändert (kein I2CP-Wire-Format-Break). 128B privKey-Blob wird neu interpretiert: [0..32] ist nicht mehr verschwendet, sondern enthält X25519-encPriv (via libsodium-Mapping oder direkt gespeichert). LeaseSet-Layout wurde bereits in PR #223 (`b7943f3`) korrekt vorbereitet (publicKeys im signed LS2-Body, privateKeys im Outer-Payload).

**Tech Stack:** TypeScript, libsodium-wrappers (lazy-loaded Singleton), vitest, Java-I2P 2.13.0 (für Live-Smoke-Verifikation).

## Global Constraints

- **128-Byte privKey-Format bleibt unverändert** (encryption [0..32] + signing [64..96]) — siehe Spec G Phase F (IdentityStore-Migration)
- **387-Byte IdentityEx-Format bleibt unverändert** ([encPub 32B][signPub 32B][cert 1B][expiration 8B][padding 314B])
- **encType=4 (ECIES-X25519)** ist H.1-Default (Java-I2P 0.9.31+ nativ)
- **Java-I2P ONLY** — kein i2pd (siehe [[secuchat-i2pd-uninstalled-2026-08-19]])
- **libsodium-Wrapper** (Native-Build für Windows/macOS/Linux; +100KB Bundle)
- **Backwards-Compat**: bestehende 128B-Blobs werden erkannt (all-zero [0..32] = alte Form) und regeneriert
- **Conventional Commits** mit deutschem Scope-Suffix (`feat(electron-i2p):`, `fix(electron-i2p):`)

---

## §1 Problem & Ziel

### §1.1 Ausgangslage

PR #223 hat das LeaseSet-Publishing-Gerüst Spec-G-konform implementiert (IdentityEx byte-exact Round-Trip, Parser auf Buffer-Vergleich, State-Machine-Tests, Doppel-Wrap-Fix im Smoke, publicKeys/privateKeys-Trennung im LS2-Body). Live-Smoke gegen `~/i2p` Java-I2P 2.13.0 hat gezeigt:

- Mechanischer Spec-G-Acceptance-Flow funktioniert (Router schickt REQUEST_LEASE_SET, Client antwortet mit CREATE_LEASE_SET_2)
- Java-I2P lehnt das LeaseSet ab mit `Wrong number of privkeys`

### §1.2 Root Cause

SecuChat generiert **Ed25519-only Destinations** (128B privKey mit Ed25519-Signing-Material). Das LeaseSet enthält entweder:
- Keine Encryption-Keys → Java-I2P `Error reading the CreateLeaseSetMessage`
- Ed25519-Public-Keys als `encryptionType=4` encryption-Keys → Java-I2P erwartet X25519-Keys, kein natives Ed25519-Mapping

Java-I2P erwartet ein **echtes Encryption-Keypair** (ElGamal 2048 oder X25519) matched zum `publicKey` im LeaseSet.

### §1.3 Ziel von H.1

- SecuChat's Ed25519-Destinations sollen ein gültiges Java-I2P-Encryption-Keypair tragen
- Backwards-Compat mit bestehenden 128B-Blob-Format (kein Storage-Schema-Break)
- Live-Smoke gegen ~/i2p Java-I2P akzeptiert das LeaseSet ohne DISCONNECT
- IDB v3 → v4 Migration ist transparent (eine Warning-Log, sonst unsichtbar)

---

## §2 Komponenten

### §2.1 IdentityEx-Erweiterung (`electron/src/i2p/i2cp-identity.ts`)

**Neue Felder (transparent aus Wire-Bytes abgeleitet):**
- `x25519PublicKey: Uint8Array` (32B, abgeleitet aus `signingPublicKey` via libsodium)
- `x25519PrivateKey?: Uint8Array` (32B, aus privKey-Blob [0..32] oder via libsodium)

**Neue Methoden:**
- `static fromEd25519PrivKey(sk: Uint8Array): IdentityEx` — Fabrik für Ed25519-Keys
- `deriveEncryptionKeys(): { publicKey: Uint8Array; privateKey: Uint8Array }` — Mappings via libsodium
- `static fromDestinationBytes` (aus Spec G): erweitert um X25519-Mapping-Validierung

### §2.2 libsodium-Wrapper (`electron/src/i2p/libsodium.ts`, NEU)

```typescript
export async function loadLibsodium(): Promise<Libsodium>;
export function ed25519PkToCurve25519(pk: Uint8Array): Uint8Array;
export function ed25519SkToCurve25519(sk: Uint8Array): Uint8Array;
```

- Native-Loading via `libsodium-wrappers` (lazy import)
- Lazy-Singleton mit Caching (erste Aufruf kann ~50ms dauern)
- Plattformen: Windows x64, macOS x64/arm64, Linux x64/arm64

### §2.3 Destination-Generation-Erweiterung (`electron/src/i2p/destination-gen.ts`)

`generateEd25519Destination()` ändert sich nicht in der Signatur. **Neu ist**: IdentityEx trägt jetzt `x25519PublicKey` + `x25519PrivateKey`. privKey-Blob bleibt 128B, aber Bytes [0..32] werden mit X25519 encPriv befüllt (statt leer zu sein).

### §2.4 IdentityStore v3 → v4 (`electron/src/i2p/identity-store.ts`)

**Detection-Logik für 128B-Blobs**:
- `privKey[0..32]` ist all-zero → alte Form, regenerate + warn
- `privKey[0..32]` non-zero → neue Form (X25519 encPriv vorhanden), validiere via libsodium-Mapping

### §2.5 encodeCreateLeaseSet2 (`electron/src/i2p/i2cp-session-creator.ts`)

Bereits in PR #223 (`b7943f3`) korrekt vorbereitet:
- `publicKeys` im LS2-Body
- `privateKeys` im Outer-Payload
- Caller muss nur die richtigen X25519-Keys eintragen

### §2.6 Datenfluss

```
generateEd25519Destination()
  → Destination { privKey, b32Address, encryptionPublicKey, signingPublicKey }
IdentityEx.fromEd25519PrivKey(privKey)
  → IdentityEx { x25519PublicKey, x25519PrivateKey, identityBytes }
encodeCreateLeaseSet2({
  ..., 
  publicKeys: [{encryptionType: 4, publicKey: identity.x25519PublicKey}],
  privateKeys: [{encryptionType: 4, privateKey: identity.x25519PrivateKey}]
})
  → I2CP-Frame mit korrektem LeaseSet2-Layout
```

---

## §3 Wire-Format

### §3.1 LeaseSet2-Layout (signed, vom Router verifiziert)

```
[4-byte length BE]
[1-byte type=41 (CREATE_LEASE_SET_2)]
[2-byte sessionId BE]
--- Inner Payload ---
[1-byte storeType=0x03]
--- LS2-Blob (signed über 0x03 || LS2-Blob mit Ed25519) ---
  [387-byte IdentityEx]
  [4-byte published BE seconds]
  [2-byte expires BE offset]
  [2-byte flags]
  [2-byte optionsSize]
  [optionsSize-byte protobuf mapping]
  [1-byte numk]
  [for each key:]
    [2-byte encryptionType]
    [2-byte keyLen]
    [keyLen-byte publicKey]
  [1-byte num]
  [for each lease:]
    [32-byte tunnel_gw]
    [4-byte tunnel_id BE]
    [4-byte end_date BE]
  [64-byte Ed25519 signature über (0x03 || alles-vor-signature)]
--- Post-Signature-Block (nicht signed) ---
[1-byte #privateKeys]                                          ← muss = numk
[for each privKey:]
  [2-byte encryptionType]
  [2-byte keyLen]
  [keyLen-byte privateKey]
```

### §3.2 Encryption-Defaults für H.1

| Field | Wert | Bytes |
|---|---|---|
| publicKeys[0].encryptionType | `4` (ECIES-X25519) | 2B |
| publicKeys[0].publicKey | X25519 encPub (aus Ed25519 signPub via libsodium) | 32B |
| privateKeys[0].encryptionType | `4` | 2B |
| privateKeys[0].privateKey | X25519 encPriv (aus Ed25519 signPriv oder privKey [0..32]) | 32B |

### §3.3 encType-Alternativen (out-of-scope, dokumentiert)

| encType | Key | Status |
|---|---|---|
| 0 | ElGamal 2048 | Legacy (Java-I2P default). Höhere Crypto-Kosten. |
| 1 | ElGamal DH | Legacy. |
| 4 | ECIES-X25519 | **H.1-Default.** |
| 5+ | Reserved | Unbekannt. |

---

## §4 Migrations-Strategie

### §4.1 Detection alter vs. neuer 128B-Blobs

- **Alte Form** (vor H.1): [0..32] all-zero oder Random-bytes
- **Neue Form** (nach H.1): [0..32] non-zero, gültiges X25519 encPriv

### §4.2 IDB v3 → v4 Schema-Migration

- Bestehende 128B-Blobs werden erkannt ([0..32] all-zero = alte Form)
- Alte Blobs → regeneriert mit WARNING-Log
- Neue Blobs (nach H.1-Implementation) → als gültig behandelt

### §4.3 Kontakt-Austausch nach Migration

- Bestehende Kontakte mit alter b32 → als "stale" markiert
- User-Hinweis: "Contacts mit alter b32 müssen neu ausgetauscht werden"
- **Out-of-Scope für H.1**: automatische Re-Swap-Logik (Spec H.2/H.3)

### §4.4 Acceptance

- **H.1.1**: LeaseSet wird gegen ~/i2p Java-I2P 2.13.0 akzeptiert (kein DISCONNECT)
- **H.1.2**: IDB-Migration v3 → v4 ist transparent (eine Application-Warning-Log, ggf. UI-Hinweis)

---

## §5 Fehlerbehandlung

### §5.1 libsodium-Loading-Fehler

- `loadLibsodium()` cached Lazy-Loaded-Singleton
- Native-Binding-Fehler: throw `LibsodiumLoadError` → Electron-Main zeigt User-Hinweis
- Erfolgreicher Load: cached für spätere Aufrufe

### §5.2 Mapping-Fehler (Ed25519→X25519)

- libsodium-Mapping ist deterministisch + immer 32B-Output
- Post-Mapping-Validierung: Output muss 32B sein
- Mapping-Fehler: `MapError`, Caller regeneriert (1 Retry)

### §5.3 LeaseSet-Acceptance-Fehler

- Java-I2P DISCONNECT → `parseErrorCount++` (Spec G §4)
- Nach 5 Parse-Errors → `disconnect()`
- UI-Hinweis: "LeaseSet-Publishing fehlgeschlagen. Router-Update empfohlen."

### §5.4 IDB-Migration-Fehler

- Malformed 128B-Blob → `IdentityStore.loadOrNull()` returns null
- Caller regeneriert automatisch
- Single Warning-Log (kein Spam)

### §5.5 Live-Run-Fehler

- `I2CPSocketManager.startLeaseSetExpiryWatchdog` (PR #223 Spec G) fängt Timeout ab
- Bei 60s ohne Router-Acceptance → State = `failed`
- UI zeigt "LeaseSet-Publishing fehlgeschlagen" mit Retry-Button (später H.3)

---

## §6 Test-Strategie

### §6.1 Unit-Tests (vitest)

**libsodium-Wrapper**:
- `crypto_sign_ed25519_pk_to_curve25519` returns 32B output for valid Ed25519 pub
- `crypto_sign_ed25519_sk_to_curve25519` returns 32B output for valid Ed25519 seed
- throws on invalid-length input
- cross-impl conformance: libsodium ↔ @noble reference value pair

**IdentityEx**:
- `fromEd25519PrivKey` sets x25519PublicKey + x25519PrivateKey correctly
- x25519PublicKey equals libsodium mapping of signPub
- byte-exact round-trip via `toByteArray()`

**IdentityStore v3→v4**:
- detects all-zero [0..32] → returns null
- detects non-zero [0..32] → returns valid Identity
- regenerates on malformed blob

**encodeCreateLeaseSet2**:
- LS2 `numk` byte reflects `publicKeys.length`
- publicKeys slot contains 32B X25519 encPub + encType=4
- privateKeys slot contains 32B X25519 encPriv + encType=4
- signature covers (0x03 || LS2-Blob) including publicKeys

### §6.2 Integration-Tests

```
generateEd25519Destination() → IdentityEx → ls2 encoding
  - no exception
  - all fields populated correctly
```

### §6.3 Live-Smoke-Tests gegen ~/i2p Java-I2P 2.13.0

```bash
bash ~/i2p/i2prouter start
cd electron && npm run build && timeout 90 node smoke-i2cp.mjs
bash ~/i2p/i2prouter stop
```

**Acceptance H.1.1:** Exit 0, sessionReady=true, **kein DISCONNECT** mit "Wrong number of privkeys" oder "Unsupported Leaseset type" oder "Error reading".

### §6.4 Akzeptanzkriterien

| Nr | Kriterium | Verifikation |
|---|---|---|
| H.1.1 | Live-Smoke gegen Java-I2P 2.13.0 ohne DISCONNECT | Live-Run, Exit 0 |
| H.1.2 | IDB v3 → v4 Migration transparent | App-Start ohne UI-Hinweis für normale User |
| H.1.3 | 187 vitest-Tests grün (185 + 2 neue) | `npm run test` |
| H.1.4 | Keine Regressions in PR #223 Spec-G-Tests | `npm run test` |
| H.1.5 | Type-Check + Vite-Build clean | `npm run build` |

### §6.5 Out-of-Scope-Tests

- Bidirektionaler Chat A50↔Electron (Spec H.2-H.4)
- Inbound-Stream-Encryption (Spec H.2)
- Connected-State-Machine (Spec H.3)
- Property-Based-Tests für 1000 zufällige Ed25519-Keys (Folge-PR)

---

## §7 Out-of-Scope

- STREAM CONNECT/ACCEPT-Setup mit Session-Encryption (Spec H.2)
- Bidirektionaler Chat A50↔Electron (Spec H.2-H.4)
- Connected-State-Machine (Spec H.3)
- Automatische Re-Swap-Logik für stale-Kontakte

---

## §8 Risiken

### §8.1 libsodium Native-Build-Pipeline

- **Risiko**: Build-Pipeline für Native-Module kann in CI brechen (Windows/macOS/Linux-Matrix)
- **Mitigation**: Fallback auf `@noble/curves` mit dokumentierter API-Inkompatibilität (Elligator2 statt libsodium-Mapping)
- **Status**: Folge-PR dokumentiert, kein Blocker für H.1

### §8.2 IDB-Migration bei bestehenden Nutzern

- **Risiko**: Bestehende SecuChat-User verlieren ihre b32 + alle Kontakte
- **Mitigation**: Application-Warnung im Log, UI-Hinweis nach erstem Start, Auto-Notification per Newsletter
- **Status**: Akzeptiertes Risiko (bestehende Ed25519-only-Destinations waren ohnehin nicht LeaseSet-fähig)

### §8.3 Java-I2P-Versionsabhängigkeit

- **Risiko**: Java-I2P < 0.9.31 unterstützt möglicherweise kein encType=4 (ECIES-X25519)
- **Mitigation**: Fallback auf encType=0 (ElGamal 2048, 256B Keys) für ältere Router
- **Status**: Detection-Logik im Live-Smoke-Verify dokumentiert

---

## §9 Anhang

### §9.1 Verwandte Specs

- [[2026-08-25-i2cp-lease-set-authority-design|Spec G]] — LeaseSet-Authority (jetzt gemerged in PR #223)
- Spec H.2 — Streaming-Protokoll-Electron (geplant)
- Spec H.3 — Connected-State + Inbound-Stream-Handling (geplant)
- Spec H.4 — E2E-Test A50↔Electron (geplant)
- Spec I — Doku-Inkonsistenz + identity-store-test-Fix (geplant)

### §9.2 Memory-Referenzen

- [[secuchat-i2cp-leaseset-authority-2026-08-25]] — Live-Befunde aus PR #223
- [[secuchat-i2cp-wire-format-fix-2026-08-20]] — Previous wire-format-Bug-Pattern
- [[secuchat-i2pd-uninstalled-2026-08-19]] — i2pd-Exclusion
- [[secuchat-libsodium-not-built-into-electron]] — fehlt (zu erstellen)

### §9.3 Implementierungs-Aufwand (Schätzung)

- libsodium-Wrapper: 4h (einfacher Wrapper + Tests)
- IdentityEx-Erweiterung: 4h (Felder, Factory, Mapping-Methoden)
- Destination-Generation-Erweiterung: 2h (privKey-Blob mit X25519 encPriv befüllen)
- IdentityStore v3→v4 Migration: 4h (Detection + Regenerate-Logik)
- Tests: 6h (Unit + Integration + Live-Smoke-Update)
- Live-Smoke-Verify + Bugfixes: 4h
- **Total: ~24h (3 Tage Vollzeit)**
