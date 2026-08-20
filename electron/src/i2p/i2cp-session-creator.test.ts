import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { IdentityEx } from './i2cp-identity';
import { encodeCreateSession, encodeCreateLeaseSet2, Lease2 } from './i2cp-session-creator';

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
    privateKeys: overrides.privateKeys ?? [
      {
        encryptionType: 0, // ECIES-X25519 = 0 in i2pd spec table
        privateKey: new Uint8Array(32).fill(0xee),
      },
    ],
    storeType: overrides.storeType ?? (3 as const),
    dateMs: overrides.dateMs ?? 1700000000000,
  };
}

// ---------------------------------------------------------------------------
// encodeCreateSession — Pflicht cases
// ---------------------------------------------------------------------------

describe('encodeCreateSession — Pflicht cases (Plan)', () => {
  it('[1] produces a frame with correct layout (no sessionId in I2CP header)', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([['nickname', 'SecuChat']]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });

    // Outer I2CP envelope: 4-byte length + 1-byte type=CREATE_SESSION(1)
    expect(buf.readUInt32BE(0)).toBe(buf.length - 4);
    expect(buf[4]).toBe(1); // CREATE_SESSION

    // No sessionId in the I2CP envelope — body starts at offset 5 directly.
    // identity(387) at 5..392, mappingSize(2) at 392..394, mapping at 394..
    expect(buf.subarray(5, 392).equals(identity.toByteArray())).toBe(true);
    const mappingSize = buf.readUInt16BE(392);
    expect(mappingSize).toBeGreaterThan(0);
    // After mapping: 8-byte date + 64-byte signature
    const expectedPayloadEnd = 394 + mappingSize + 8 + 64;
    expect(buf.length).toBe(expectedPayloadEnd);

    // Last 64 bytes = signature
    expect(buf.subarray(buf.length - 64).length).toBe(64);
    // 8-byte date at the right offset
    const dateMs = Number(buf.readBigUInt64BE(buf.length - 64 - 8));
    expect(dateMs).toBe(1700000000000);
  });

  it('[2] signs identity || mapping || date consistently (signature round-trip)', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([
      ['a', '1'],
      ['b', '2'],
      ['c', '3'],
    ]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });

    const identityBytes = identity.toByteArray();
    const mappingSize = buf.readUInt16BE(392);
    const mappingBytes = buf.subarray(394, 394 + mappingSize);
    const dateBytes = buf.subarray(buf.length - 64 - 8, buf.length - 64);
    const signedData = Buffer.concat([identityBytes, mappingBytes, dateBytes]);

    const sig = Buffer.from(buf.subarray(buf.length - 64));
    expect(IdentityEx.verify(identityBytes, sig, signedData)).toBe(true);
  });

  it('[3] fails verification when signature is tampered (1-bit flip)', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([
      ['a', '1'],
      ['b', '2'],
    ]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });

    const mappingSize = buf.readUInt16BE(392);
    const identityBytes = identity.toByteArray();
    const mappingBytes = buf.subarray(394, 394 + mappingSize);
    const dateBytes = buf.subarray(buf.length - 64 - 8, buf.length - 64);
    const signedData = Buffer.concat([identityBytes, mappingBytes, dateBytes]);

    const sig = Buffer.from(buf.subarray(buf.length - 64));
    sig[0] ^= 0x01; // flip lowest bit of first byte
    expect(IdentityEx.verify(identityBytes, sig, signedData)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// encodeCreateSession — Pflicht extensions
// ---------------------------------------------------------------------------

describe('encodeCreateSession — Pflicht extensions (brief)', () => {
  it('[5] header length = inner payload + 5 bytes (math is consistent)', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([['k', 'v']]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });
    // innerLen = 1 (type byte) + 0 (no sessionId) + payload.length
    // payload = identity(387) + mappingSize(2) + mapping(N) + date(8) + signature(64)
    const mappingSize = buf.readUInt16BE(392);
    const expectedInnerLen = 1 + 0 + (387 + 2 + mappingSize + 8 + 64);
    expect(buf.readUInt32BE(0)).toBe(expectedInnerLen);
    expect(buf.length).toBe(4 + expectedInnerLen);
  });

  it('[6] mapping contains sorted properties (lexicographic UTF-8 byte order)', () => {
    const identity = makeTestIdentity();
    // Insert in non-sorted order; encoded mapping must follow lex order.
    const properties = new Map<string, string>([
      ['zeta', '6'],
      ['alpha', '1'],
      ['mike', '3'],
    ]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });
    const mappingSize = buf.readUInt16BE(392);
    const mappingBytes = buf.subarray(394, 394 + mappingSize).toString('utf-8');
    // alpha must appear before mike, which must appear before zeta.
    const alphaAt = mappingBytes.indexOf('alpha');
    const mikeAt = mappingBytes.indexOf('mike');
    const zetaAt = mappingBytes.indexOf('zeta');
    expect(alphaAt).toBeGreaterThanOrEqual(0);
    expect(mikeAt).toBeGreaterThan(alphaAt);
    expect(zetaAt).toBeGreaterThan(mikeAt);
  });

  it('[7] multiple properties — three distinct entries all encoded', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([
      ['c', '3'],
      ['a', '1'],
      ['b', '2'],
    ]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });
    const mappingBytes = buf.subarray(394, 394 + buf.readUInt16BE(392)).toString('utf-8');
    expect(mappingBytes).toContain('a');
    expect(mappingBytes).toContain('b');
    expect(mappingBytes).toContain('c');
    expect(mappingBytes).toContain('1');
    expect(mappingBytes).toContain('2');
    expect(mappingBytes).toContain('3');
  });

  it('[8] empty properties map → mappingSize=0, signature still 64 bytes', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>();
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });
    expect(buf.readUInt16BE(392)).toBe(0);
    // Total = 4 (length) + 1 (type) + 0 (no sessionId) + payload
    //       = 4 + 1 + 0 + (387 + 2 + 0 + 8 + 64) = 466
    expect(buf.length).toBe(4 + 1 + 387 + 2 + 0 + 8 + 64);
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

    // Outer envelope: 4-byte length + 1-byte type=41 + 2-byte sessionId
    expect(buf.readUInt32BE(0)).toBe(buf.length - 4);
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
    // numk: 1 byte (0) → 405+1 = 406
    // num: 1 byte (1 lease) → 406+1 = 407
    // lease[0] starts at offset 407

    const numOffset = 406; // after empty options(2) + numk(1)
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
      privateKeys: [],
    });
    const buf = encodeCreateLeaseSet2(opts);

    // num at offset 406, value = 2
    const numOffset = 406;
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

    // Determine end of ls2 blob: ls2 blob ends just before the 64-byte signature.
    // The signature is the 64 bytes immediately preceding the 1-byte #privateKeys.
    const privKeyStart = outerPayload.length - (1 + 2 + 2 + opts.privateKeys[0].privateKey.length);
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
