import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { IdentityEx } from './i2cp-identity';
import {
  encodeCreateSession,
  encodeCreateLeaseSet2,
  Lease2,
  encodeLegacyDestination,
  encodeDataHelperProperties,
  makeEd25519KeyCertificate,
  LEGACY_PUBLIC_KEY_BYTES,
  LEGACY_SIGNING_PUBLIC_KEY_BYTES,
  SIG_TYPE_EDDSA_SHA512_ED25519,
  CERT_TYPE_KEY_CERTIFICATE,
} from './i2cp-session-creator';

// RFC 8032 §7.1 Test 1 — deterministic Ed25519 seed.
const RFC8032_SEED = new Uint8Array([
  0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4,
  0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7d, 0x60,
]);

/**
 * Build a valid 128-byte IdentityEx blob with deterministic signing key
 * (RFC 8032 test vector) and random encryption key.
 */
function makeTestIdentity(): IdentityEx {
  // 128-byte-Blob: encPriv(32) + encPub(32) + signPriv(32) + signPub(32)
  const blob = new Uint8Array(128);
  const encPriv = ed.utils.randomPrivateKey();
  const encPub = ed.getPublicKey(encPriv);
  const signPriv = new Uint8Array(RFC8032_SEED); // deterministisch
  const signPub = ed.getPublicKey(signPriv);
  blob.set(encPriv, 0);
  blob.set(encPub, 32);
  blob.set(signPriv, 64);
  blob.set(signPub, 96);
  return IdentityEx.fromPrivKey(blob);
}

function makeTestSigningKey(): Uint8Array {
  return new Uint8Array(RFC8032_SEED); // 32-byte Ed25519 seed
}

/** Default test options for encodeCreateLeaseSet2. */
function makeLeaseSet2Opts(overrides: Partial<{
  identity: IdentityEx;
  sessionId: number;
  leases: Lease2[];
  publishedSeconds: number;
  expiresSeconds: number;
  options: Map<string, string>;
  signingKey: Uint8Array;
  publicKeys: Array<{ encryptionType: number; publicKey: Uint8Array }>;
  privateKeys: Array<{ encryptionType: number; privateKey: Uint8Array }>;
  storeType: 1 | 3 | 5 | 7;
  dateMs: number;
}> = {}) {
  const identity = overrides.identity ?? makeTestIdentity();
  const signingKey = overrides.signingKey ?? makeTestSigningKey();
  return {
    identity,
    sessionId: overrides.sessionId ?? 42,
    leases: overrides.leases ?? [
      {
        tunnelGw: new Uint8Array(32).fill(0xcd),
        tunnelId: 0x11223344,
        endDateSeconds: 1700000600,
      },
    ],
    publishedSeconds: overrides.publishedSeconds ?? 1700000000,
    expiresSeconds: overrides.expiresSeconds ?? 600, // 10 minutes
    options: overrides.options ?? new Map<string, string>(),
    signingKey,
    // LS2 body needs at least one public encryption key. Default = the
    // first 32 bytes of the IdentityEx with ECIES-X25519 type tag.
    publicKeys: overrides.publicKeys ?? [
      {
        encryptionType: 4, // ECIES-X25519
        publicKey: identity.encryptionPublicKey,
      },
    ],
    privateKeys: overrides.privateKeys ?? [], // outbound-only test default
    storeType: overrides.storeType ?? (3 as const),
    dateMs: overrides.dateMs ?? 1700000000000,
  };
}

// ---------------------------------------------------------------------------
// encodeCreateSession — Java-I2P LEGACY SessionConfig layout (Plan)
// ---------------------------------------------------------------------------
//
// Java's SessionConfig.readBytes expects (in this order):
//   1. Destination  (legacy 391-byte shape: 256B dummy pub + 128B signing slot
//                    [first 32B = Ed25519 signPub, rest = zero padding] +
//                    7B KeyCertificate type=5 with Ed25519_PAYLOAD)
//   2. Properties   (DataHelper.readProperties: 2B size + entries
//                    [1B keyLen][key][=][1B valLen][val];, sorted lex)
//   3. Date         (8B BE ms since epoch)
//   4. Signature    (Ed25519 64B over destination||properties||date)
//
// All five `encodeCreateSession` tests assert against this layout.

describe('encodeCreateSession — Java-I2P LEGACY SessionConfig (Pflicht)', () => {
  it('[1] Java-I2P wire layout: 4-byte length + 1-byte type=1 + legacy SessionConfig body', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([['nickname', 'SecuChat']]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });

    // I2CP envelope: 4-byte length (body only) + 1-byte type=CREATE_SESSION
    // Per Java's I2CPMessageImpl.writeMessage, the length counts only body bytes.
    expect(buf.readUInt32BE(0)).toBe(buf.length - 4 - 1);
    expect(buf[4]).toBe(1); // CREATE_SESSION

    // Body starts at offset 5. First substructure = legacy Destination (391 bytes).
    // Java-I2P 2.7.0 reads SigningPublicKey at the DEFAULT size
    // (DSA_SHA1.getPubkeyLen()=128). The Ed25519 signing pub occupies the FIRST
    // 32 bytes of that slot; the remaining 96 bytes are zero padding. The
    // KeyCert re-types the SigningPublicKey via toTypedKey.
    const DEST_LEN =
      LEGACY_PUBLIC_KEY_BYTES + LEGACY_SIGNING_PUBLIC_KEY_BYTES + 7; // 256 + 128 + 7 = 391
    expect(DEST_LEN).toBe(391);
    const propSize = buf.readUInt16BE(5 + DEST_LEN);
    expect(propSize).toBeGreaterThan(0);
    // sanity: format:  4 + 1 (header) + 391 (dest) + properties_len + 8 (date) + 64 (sig)
    expect(buf.length).toBe(5 + DEST_LEN + 2 + propSize + 8 + 64);

    // The dummy ElGamal PublicKey (first 256 bytes of legacy Destination) is zeros.
    expect(buf.subarray(5, 5 + LEGACY_PUBLIC_KEY_BYTES).equals(Buffer.alloc(LEGACY_PUBLIC_KEY_BYTES))).toBe(true);

    // The Ed25519 signing pub (LAST 32 bytes of the 128-byte signing slot —
    // Java's `SigningPublicKey.toTypedKey` reads `_data[96..127]` for a
    // typedLen=32 key, NOT the first 32 bytes).
    const signingSlotStart = 5 + LEGACY_PUBLIC_KEY_BYTES;
    expect(buf.subarray(signingSlotStart + 96, signingSlotStart + 128)
      .equals(Buffer.from(identity.signingPublicKey))).toBe(true);

    // The 96-byte zero-padded HEAD of the SigningPublicKey slot
    // (slots [0..95] are zero padding, [96..127] holds Ed25519 signPub).
    const signingSlotEnd = signingSlotStart + LEGACY_SIGNING_PUBLIC_KEY_BYTES;
    expect(buf.subarray(signingSlotStart, signingSlotStart + 96)
      .equals(Buffer.alloc(96))).toBe(true);

    // The KeyCertificate (7B after the signing slot): per i2p KeyCertificate
    // constructor + Ed25519_PAYLOAD constant (verified from i2p 2.7.0 bytecode):
    //   cert[0]   = type (5)
    //   cert[1..2]= extraLen BE (0x00 0x04) = 4
    //   cert[3..6]= Ed25519_PAYLOAD = [0x00, 0x07, 0x00, 0x00]
    //              ((SigType.code>>8)&0xFF) | (SigType.code&0xFF) | padding | padding
    const certStart = signingSlotEnd;
    const cert = buf.subarray(certStart, certStart + 7);
    expect(cert[0]).toBe(CERT_TYPE_KEY_CERTIFICATE);
    expect(cert.readUInt16BE(1)).toBe(4);
    expect(cert[1]).toBe(0x00);  // BE high byte of extraLen
    expect(cert[2]).toBe(0x04);  // BE low byte of extraLen
    expect(cert[3]).toBe(0x00);  // payload[0] — (SigType.code>>8)&0xFF = 0 for Ed25519
    expect(cert[4]).toBe(SIG_TYPE_EDDSA_SHA512_ED25519);  // payload[1] — SigType.code & 0xFF
    expect(cert[5]).toBe(0x00);  // payload[2] — cryptoType high byte
    expect(cert[6]).toBe(0x00);  // payload[3] — cryptoType low byte

    // 8-byte Date BE at the expected offset.
    const dateMs = Number(buf.readBigUInt64BE(buf.length - 64 - 8));
    expect(dateMs).toBe(1700000000000);

    // Last 64 bytes = signature
    expect(buf.subarray(buf.length - 64).length).toBe(64);
  });

  it('[2] signs destination || properties || date (signature round-trip)', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([
      ['a', '1'],
      ['b', '2'],
      ['c', '3'],
    ]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });

    // Java's SessionConfig.getBytes() (used for signature verification) calls
    // Destination.writeBytes(out) — which emits the SAME 391-byte form as on
    // the wire (256B pub + 128B signing slot [96B zero pad + 32B typed sign]
    // + 7B cert). So the signed form is byte-exact to the wire destination.
    const DEST_LEN = 391;
    const propSize = buf.readUInt16BE(5 + DEST_LEN);

    // The signed data is [wire destination 391B] || [properties] || [date 8B].
    const wireDestination = buf.subarray(5, 5 + DEST_LEN);
    const propBytes = buf.subarray(5 + DEST_LEN, 5 + DEST_LEN + 2 + propSize);
    const dateBytes = buf.subarray(buf.length - 64 - 8, buf.length - 64);
    const signedData = Buffer.concat([wireDestination, propBytes, dateBytes]);

    // Ed25519 sign-pub is the typed 32 B at offset 96..127 of the 128-B signing
    // slot (LAST 32 bytes) — Destination.writeBytes re-slices _data to the
    // last 32 bytes via SigningPublicKey.toTypedKey.
    const signPubFromWire = wireDestination.subarray(LEGACY_PUBLIC_KEY_BYTES + 96,
      LEGACY_PUBLIC_KEY_BYTES + 128);

    const sig = buf.subarray(buf.length - 64);
    expect(ed.verify(sig, signedData, signPubFromWire)).toBe(true);
  });

  it('[3] fails verification when signature is tampered (1-bit flip)', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([
      ['a', '1'],
      ['b', '2'],
    ]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });

    const DEST_LEN = 391;
    const propSize = buf.readUInt16BE(5 + DEST_LEN);
    const wireDestination = buf.subarray(5, 5 + DEST_LEN);
    const signPubFromWire = wireDestination.subarray(LEGACY_PUBLIC_KEY_BYTES + 96,
      LEGACY_PUBLIC_KEY_BYTES + 128);
    const propBytes = buf.subarray(5 + DEST_LEN, 5 + DEST_LEN + 2 + propSize);
    const dateBytes = buf.subarray(buf.length - 64 - 8, buf.length - 64);
    const signedData = Buffer.concat([wireDestination, propBytes, dateBytes]);

    const sig = Buffer.from(buf.subarray(buf.length - 64));
    sig[0] ^= 0x01; // flip one bit
    expect(ed.verify(sig, signedData, signPubFromWire)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// encodeCreateSession — Pflicht extensions (brief)
// ---------------------------------------------------------------------------
//
// Tests [5]–[10] and [20] assert against the LEGACY Java-I2P SessionConfig
// layout (256-byte dummy-pub, 128-byte signing slot with 32B Ed25519 signPub
// + 96B zero padding, 7-byte KeyCertificate, DataHelper Properties, 8-byte
// Date, 64-byte signature).
//
// Layout offsets (no sessionId since CreateSession is connection-level):
//   [4-byte length][1-byte type=1]
//   [5 .. 5+256)              dummy PublicKey                256 bytes
//   [5+256 .. 5+256+128)      SigningPublicKey slot          128 bytes
//                              (first 32 B = Ed25519 signPub,
//                               remaining 96 B = zero padding)
//   [5+256+128 .. +7)         KeyCertificate (type=5, …)       7 bytes
//   [5+391 .. 5+391+2)        Properties size (2B BE)         2 bytes
//   [5+391+2 .. +N)           Properties payload              N bytes
//   [...+N .. +N+8)           Date (8B BE ms)                  8 bytes
//   [...last 64]              Signature (Ed25519)              64 bytes

describe('encodeCreateSession — Pflicht extensions (brief)', () => {
  it('[5] header length = inner payload + 5 bytes (math is consistent)', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([['k', 'v']]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });

    // bodyLen = legacy Destination(391) + Properties(2+propSize) + Date(8) + Sig(64)
    const propSize = buf.readUInt16BE(5 + 391);
    const expectedInnerLen = 391 + 2 + propSize + 8 + 64;
    expect(buf.readUInt32BE(0)).toBe(expectedInnerLen);
    expect(buf.length).toBe(4 + 1 + expectedInnerLen);
  });

  it('[6] properties payload is sorted lexicographically by key', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([
      ['zeta', '6'],
      ['alpha', '1'],
      ['mike', '3'],
    ]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });

    // Properties payload starts at offset 5+391+2 = 398.
    const propSize = buf.readUInt16BE(5 + 391);
    const propBytes = buf.subarray(5 + 391 + 2, 5 + 391 + 2 + propSize).toString('utf-8');
    // alpha must appear before mike, which must appear before zeta.
    const alphaAt = propBytes.indexOf('alpha');
    const mikeAt = propBytes.indexOf('mike');
    const zetaAt = propBytes.indexOf('zeta');
    expect(alphaAt).toBeGreaterThanOrEqual(0);
    expect(mikeAt).toBeGreaterThan(alphaAt);
    expect(zetaAt).toBeGreaterThan(mikeAt);
  });

  it('[7] DataHelper entries: 1B keyLen + key + 0x3D + 1B valLen + val + 0x3B', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([
      ['a', '1'],
    ]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });

    // The first entry starts at offset 5+391+2 = 398 (right after the 2B size header).
    // Format: [1B=keyLen][key UTF-8][0x3D='][1B=valLen][val UTF-8][0x3B ';']…
    expect(buf[5 + 391 + 2 + 0]).toBe(1);   // keyLen = 1 (key = 'a')
    expect(buf[5 + 391 + 2 + 1]).toBe(0x61);  // 'a' UTF-8
    expect(buf[5 + 391 + 2 + 2]).toBe(0x3D);  // '='
    expect(buf[5 + 391 + 2 + 3]).toBe(1);   // valLen = 1 (value = '1')
    expect(buf[5 + 391 + 2 + 4]).toBe(0x31);  // '1' UTF-8
    expect(buf[5 + 391 + 2 + 5]).toBe(0x3B);  // ';'

    // Properties size header reflects just the entry payload (above 6 bytes).
    const propSize = buf.readUInt16BE(5 + 391);
    expect(propSize).toBe(6);
  });

  it('[8] empty properties → propSize=0, no DataHelper payload bytes', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>();
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });

    // propSize at offset 5+391 = 0 → no entry bytes between the size header
    // and the 8-byte date immediately after (offset 5+391+2).
    expect(buf.readUInt16BE(5 + 391)).toBe(0);
    // Total = 4 (length) + 1 (type) + 391 (Destination) + 2 (propSize) + 0 (props)
    //       + 8 (date) + 64 (sig) = 470
    expect(buf.length).toBe(4 + 1 + 391 + 2 + 0 + 8 + 64);
    expect(buf.subarray(buf.length - 64).length).toBe(64);
  });

  it('[9] dateMs=0 → eight zero bytes immediately before the signature', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([['k', 'v']]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 0 });
    const dateBytes = buf.subarray(buf.length - 64 - 8, buf.length - 64);
    expect(Array.from(dateBytes)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('[10] dateMs=Number.MAX_SAFE_INTEGER survives BigInt conversion', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([['k', 'v']]);
    const max = Number.MAX_SAFE_INTEGER;
    const buf = encodeCreateSession({ identity, properties, dateMs: max });
    const dateBytes = buf.subarray(buf.length - 64 - 8, buf.length - 64);
    expect(Number(buf.readBigUInt64BE(buf.length - 64 - 8))).toBe(max);
    expect(dateBytes.length).toBe(8);
  });
});

// ---------------------------------------------------------------------------
// encodeCreateLeaseSet2 — Pflicht case
// ---------------------------------------------------------------------------

describe('encodeCreateLeaseSet2 — Pflicht case (Plan)', () => {
  it('[4] produces a frame with sessionId in I2CP header (CREATE_LEASE_SET_2 = 41)', () => {
    const opts = makeLeaseSet2Opts({ sessionId: 42 });
    const buf = encodeCreateLeaseSet2(opts);

    // Outer envelope: 4-byte length (body only) + 1-byte type=41 + 2-byte sessionId
    //   length = buf.length - 4 (length prefix) - 1 (type byte) = body length
    expect(buf.readUInt32BE(0)).toBe(buf.length - 4 - 1);
    expect(buf[4]).toBe(41); // CREATE_LEASE_SET_2
    expect(buf.readUInt16BE(5)).toBe(42); // sessionId in I2CP header

    // storeType at offset 7
    expect(buf[7]).toBe(3); // LeaseSet2

    // Lease body must be present (length > 7 bytes for envelope header)
    expect(buf.length).toBeGreaterThan(7);
  });
});

// ---------------------------------------------------------------------------
// encodeCreateLeaseSet2 — Pflicht extensions
// ---------------------------------------------------------------------------

describe('encodeCreateLeaseSet2 — Pflicht extensions (brief)', () => {
  it('[11] ls2_header Layout — destination(387) + published(4) + expires(2) + flags(2)', () => {
    const identity = makeTestIdentity();
    const opts = makeLeaseSet2Opts({
      identity,
      publishedSeconds: 1700000000,
      expiresSeconds: 600,
      leases: [],
      // no privateKeys: makes next-field offset easier to compute
      privateKeys: [],
    });
    const buf = encodeCreateLeaseSet2(opts);

    // storeType at offset 7 = 3 (LeaseSet2)
    expect(buf[7]).toBe(3);

    // Identity (387 B) at offset 8..395
    const identityBytes = identity.toByteArray();
    expect(buf.subarray(8, 395).equals(identityBytes)).toBe(true);

    // 4-byte publishedSeconds BE at offset 395..399
    expect(buf.readUInt32BE(395)).toBe(1700000000);

    // 2-byte expiresSeconds BE at offset 399..401
    expect(buf.readUInt16BE(399)).toBe(600);

    // 2-byte flags at offset 401..403 (must be 0x0000 — no offline sig)
    expect(buf.readUInt16BE(401)).toBe(0x0000);
  });

  it('[12] LS2 contains options Mapping directly after flags', () => {
    const options = new Map<string, string>([
      ['foo', 'bar'],
      ['baz', 'qux'],
    ]);
    const opts = makeLeaseSet2Opts({
      options,
      leases: [],
      privateKeys: [],
    });
    const buf = encodeCreateLeaseSet2(opts);

    // Options mapping starts right after flags (offset 401+2 = 403)
    // 2-byte mapping-size BE at 403..405
    const mappingSize = buf.readUInt16BE(403);
    expect(mappingSize).toBeGreaterThan(0);
    // The mapping bytes contain 'foo' and 'baz'
    const mappingBytes = buf.subarray(405, 405 + mappingSize).toString('utf-8');
    expect(mappingBytes).toContain('foo');
    expect(mappingBytes).toContain('bar');
    expect(mappingBytes).toContain('baz');
    expect(mappingBytes).toContain('qux');
  });

  it('[13] lease-entry is exactly 40 bytes (32 tunnelGw + 4 tunnelId BE + 4 endDateSeconds BE)', () => {
    const tunnelGw = new Uint8Array(32);
    for (let i = 0; i < 32; i++) tunnelGw[i] = i;
    const tunnelId = 0xdeadbeef;
    const endDateSeconds = 0x11223344;
    const opts = makeLeaseSet2Opts({
      leases: [{ tunnelGw, tunnelId, endDateSeconds }],
      privateKeys: [],
    });
    const buf = encodeCreateLeaseSet2(opts);

    // ls2 starts at offset 8 (after length+type+sessionId+storeType).
    // ls2_header: 387+4+2+2 = 395 bytes → after ls2_header: 8 + 395 = 403
    // options: 2-byte size (empty → 0) + 0 bytes → 403+2 = 405
    // numk: 1 byte (=1) + 2 encType + 2 keyLen + 32 publicKey → 405+37 = 442
    // num: 1 byte (1 lease) → 442+1 = 443
    // lease[0] starts at offset 443

    const numOffset = 442; // after numk(1) + encType(2) + keyLen(2) + publicKey(32)
    expect(buf[numOffset]).toBe(1); // num = 1

    const leaseOffset = numOffset + 1; // 407
    const leaseEntry = buf.subarray(leaseOffset, leaseOffset + 40);
    expect(leaseEntry.length).toBe(40);

    // tunnelGw: first 32 bytes
    expect(leaseEntry.subarray(0, 32).equals(tunnelGw)).toBe(true);

    // tunnelId: 4 bytes BE at offset 32..36
    expect(leaseEntry.readUInt32BE(32)).toBe(tunnelId);

    // endDateSeconds: 4 bytes BE at offset 36..40
    expect(leaseEntry.readUInt32BE(36)).toBe(endDateSeconds);
  });

  it('[14] multi-leases (2 leases) → lease body is 80 bytes, num=2 byte davor', () => {
    const tunnelGw1 = new Uint8Array(32).fill(0xaa);
    const tunnelGw2 = new Uint8Array(32).fill(0xbb);
    const opts = makeLeaseSet2Opts({
      leases: [
        { tunnelGw: tunnelGw1, tunnelId: 0x11111111, endDateSeconds: 1700000100 },
        { tunnelGw: tunnelGw2, tunnelId: 0x22222222, endDateSeconds: 1700000200 },
      ],
    });
    const buf = encodeCreateLeaseSet2(opts);

    // Frame layout (default test options: 1 publicKey of 32B, no options):
    //   4-byte length + 1-byte type + 2-byte sessionId + (Outer-Payload)
    //   Outer-Payload:
    //     1-byte storeType
    //     387-byte IdentityEx
    //     4-byte published
    //     2-byte expires
    //     2-byte flags
    //     2-byte optionsSize (=0) + 0-byte options
    //     1-byte numk (=1) + 2-byte encType + 2-byte keyLen + 32-byte publicKey
    //     1-byte numLeases
    //     (Leases follow)
    // → numLeases offset = 7 + 1 + 387 + 4 + 2 + 2 + 2 + 1 + 2 + 2 + 32 = 442
    const numOffset = 442;
    expect(buf[numOffset]).toBe(2);

    const leaseOffset = numOffset + 1; // 407
    // First lease: 40 bytes
    expect(buf.subarray(leaseOffset, leaseOffset + 32).equals(tunnelGw1)).toBe(true);
    expect(buf.readUInt32BE(leaseOffset + 32)).toBe(0x11111111);
    expect(buf.readUInt32BE(leaseOffset + 36)).toBe(1700000100);
    // Second lease: 40 bytes
    expect(buf.subarray(leaseOffset + 40, leaseOffset + 72).equals(tunnelGw2)).toBe(true);
    expect(buf.readUInt32BE(leaseOffset + 72)).toBe(0x22222222);
    expect(buf.readUInt32BE(leaseOffset + 76)).toBe(1700000200);
  });

  it('[15] wrong tunnelGw length (31 bytes) throws', () => {
    const opts = makeLeaseSet2Opts({
      leases: [
        {
          tunnelGw: new Uint8Array(31).fill(0xab),
          tunnelId: 1,
          endDateSeconds: 1700000000,
        },
      ],
    });
    expect(() => encodeCreateLeaseSet2(opts)).toThrow(/tunnelGw/);
  });

  it('[15b] wrong tunnelGw length (33 bytes) throws', () => {
    const opts = makeLeaseSet2Opts({
      leases: [
        {
          tunnelGw: new Uint8Array(33).fill(0xab),
          tunnelId: 1,
          endDateSeconds: 1700000000,
        },
      ],
    });
    expect(() => encodeCreateLeaseSet2(opts)).toThrow(/tunnelGw/);
  });

  it('[16] signature covers (0x03 || LeaseSet2 blob) — re-verify byte-genau', () => {
    const signingKey = makeTestSigningKey();
    const opts = makeLeaseSet2Opts({ signingKey });
    const buf = encodeCreateLeaseSet2(opts);

    // Outer payload starts at offset 7 (after length+type+sessionId).
    // layout: [storeType 1B][ls2 blob][signature 64B][#privateKeys 1B][per-key encType(2)+keyLen(2)+key(N)]
    const outerPayload = buf.subarray(7);
    const storeType = outerPayload[0];
    expect(storeType).toBe(3);

    // Default test opts have privateKeys=[], so the privateKeys tail is just
    // the 1-byte count (=0). The 64-byte signature ends at
    // outerPayload.length - 1 (the #privateKeys byte).
    const privKeyStart = outerPayload.length - 1;
    const sigStart = privKeyStart - 64;
    const ls2Bytes = outerPayload.subarray(1, sigStart);

    // signedData = 0x03 || ls2Bytes
    const signedData = Buffer.concat([Buffer.from([0x03]), ls2Bytes]);

    // Extract 64-byte signature
    const sig = outerPayload.subarray(sigStart, sigStart + 64);
    expect(sig.length).toBe(64);

    // Re-verify with public key derived from signing key
    const publicKey = ed.getPublicKey(signingKey);
    expect(ed.verify(sig, signedData, publicKey)).toBe(true);
  });

  it('[17] outer payload ends with 1-byte #privateKeys + per-key encType(2)+keyLen(2)+key(N)', () => {
    const privKeyBytes = new Uint8Array(32).fill(0xee);
    const opts = makeLeaseSet2Opts({
      privateKeys: [{ encryptionType: 4, privateKey: privKeyBytes }],
      leases: [], // minimize ls2 blob
    });
    const buf = encodeCreateLeaseSet2(opts);

    const outerPayload = buf.subarray(7);
    // Last bytes: [numPriv=1][encType=4 BE][keyLen=32 BE][privKey 32B] = 1+2+2+32 = 37 bytes
    const privKeySectionSize = 1 + 2 + 2 + privKeyBytes.length;
    const privKeyStart = outerPayload.length - privKeySectionSize;
    const privKeySection = outerPayload.subarray(privKeyStart);
    expect(privKeySection[0]).toBe(1); // #privateKeys
    expect(privKeySection.readUInt16BE(1)).toBe(4); // encType
    expect(privKeySection.readUInt16BE(3)).toBe(32); // keyLen
    expect(privKeySection.subarray(5, 5 + 32).equals(privKeyBytes)).toBe(true);
  });

  it('[18] empty leases — num=0 byte, kein Lease-Body, trotzdem gültige signature', () => {
    const signingKey = makeTestSigningKey();
    const opts = makeLeaseSet2Opts({
      signingKey,
      leases: [],
      privateKeys: [],
    });
    const buf = encodeCreateLeaseSet2(opts);

    // num byte = 0 (right after numk byte which is also 0 here)
    const numOffset = 406;
    expect(buf[numOffset]).toBe(0);

    // Signature is still 64 bytes
    const outerPayload = buf.subarray(7);
    const privKeyStart = outerPayload.length - 1; // #privateKeys = 0 → only 1 byte at the end
    const sigStart = privKeyStart - 64;
    const sig = outerPayload.subarray(sigStart, sigStart + 64);
    expect(sig.length).toBe(64);

    // Verify signature is valid
    const ls2Bytes = outerPayload.subarray(1, sigStart);
    const signedData = Buffer.concat([Buffer.from([0x03]), ls2Bytes]);
    const publicKey = ed.getPublicKey(signingKey);
    expect(ed.verify(sig, signedData, publicKey)).toBe(true);
  });

  it('[19] storeType=1 (Legacy LeaseSet) — storeType-Byte wird korrekt durchgereicht', () => {
    const opts = makeLeaseSet2Opts({ storeType: 1 });
    const buf = encodeCreateLeaseSet2(opts);

    // storeType at offset 7 = 1
    expect(buf[7]).toBe(1);
    // The I2CP header (type=41, sessionId) is still the same
    expect(buf[4]).toBe(41);
    expect(buf.readUInt16BE(5)).toBe(opts.sessionId);
  });

  it('[20] Gold-Master-ish: same identity + same dateMs + same properties → identical bytes', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([
      ['router.version', '0.9.50'],
      ['caps', 'XR'],
    ]);
    const opts = { identity, properties, dateMs: 1700000000000 };
    const a = encodeCreateSession(opts);
    const b = encodeCreateSession(opts);
    expect(a.equals(b)).toBe(true);
  });
});
