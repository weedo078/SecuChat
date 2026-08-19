import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { IdentityEx } from './i2cp-identity';
import { encodeCreateSession, encodeCreateLeaseSet2, Lease } from './i2cp-session-creator';

// RFC 8032 §7.1 Test 1 — deterministic Ed25519 seed (used by i2cp-identity.test.ts).
const RFC8032_SEED = new Uint8Array([
  0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60,
  0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4,
  0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19,
  0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60,
]);

/**
 * Build a valid 128-byte IdentityEx blob whose signing key is the RFC 8032
 * test-vector key. Encryption key slots are arbitrary (zero-filled); only the
 * signing keypair needs to be consistent for sign/verify round-trips.
 */
function makeTestIdentity(): IdentityEx {
  const blob = new Uint8Array(128);
  // signing priv seed at offset 64..96
  blob.set(RFC8032_SEED, 64);
  // signing pub at offset 96..128 (derived from seed so sign/verify match)
  const pub = ed.getPublicKey(RFC8032_SEED);
  blob.set(pub, 96);
  return IdentityEx.fromPrivKey(blob);
}

describe('encodeCreateSession — Pflicht cases (Plan)', () => {
  it('[1] produces a frame with correct layout (no sessionId in I2CP header)', () => {
    const identity = makeTestIdentity();
    const properties = new Map<string, string>([['nickname', 'SecuChat']]);
    const buf = encodeCreateSession({ identity, properties, dateMs: 1700000000000 });

    // Outer I2CP envelope: 4-byte length + 1-byte type=CREATE_SESSION(1)
    expect(buf.readUInt32BE(0)).toBe(buf.length - 4);
    expect(buf[4]).toBe(1); // CREATE_SESSION

    // No sessionId in the I2CP envelope (body length is 1 + payload, NOT 1 + 2 + payload).
    // Body length = innerLen = 1 + 0 (no sessionId) + payload.length
    const innerLen = buf.readUInt32BE(0);
    expect(innerLen).toBe(buf.length - 4);

    // Body layout: identity(387) + mappingSize(2) + mapping + date(8) + signature(64)
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

describe('encodeCreateSession — Pflicht extensions (brief)', () => {
  it('[5] header length = 4 (envelope length) + inner payload — math is consistent', () => {
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

describe('encodeCreateLeaseSet2 — Pflicht cases (Plan)', () => {
  it('[4] produces a frame with sessionId in I2CP header (CREATE_LEASE_SET_2 = 41)', () => {
    const identity = makeTestIdentity();
    const leases: Lease[] = [
      {
        routerHash: new Uint8Array(32).fill(0xab),
        tunnelGw: new Uint8Array(32).fill(0xcd),
        expires: 1700000600000,
      },
    ];
    const buf = encodeCreateLeaseSet2({
      identity,
      sessionId: 42,
      leases,
      expires: 1700000600000,
      dateMs: 1700000000000,
    });

    // Outer envelope length + type + 2-byte sessionId
    expect(buf.readUInt32BE(0)).toBe(buf.length - 4);
    expect(buf[4]).toBe(41); // CREATE_LEASE_SET_2
    expect(buf.readUInt16BE(5)).toBe(42); // sessionId in I2CP header

    // Lease body must be present (length > 7 bytes for envelope header)
    expect(buf.length).toBeGreaterThan(7);
  });
});

describe('encodeCreateLeaseSet2 — Pflicht extensions (brief)', () => {
  it('[11] single lease body = 32 routerHash + 32 tunnelGw + 8 expires = 72 bytes', () => {
    const identity = makeTestIdentity();
    const leases: Lease[] = [
      {
        routerHash: new Uint8Array(32).fill(0xab),
        tunnelGw: new Uint8Array(32).fill(0xcd),
        expires: 1700000600000,
      },
    ];
    const buf = encodeCreateLeaseSet2({
      identity,
      sessionId: 42,
      leases,
      expires: 1700000600000,
      dateMs: 1700000000000,
    });
    // Total = 4 (length) + 1 (type) + 2 (sessionId) + payload
    // payload = 1 (sidByte) + 387 (identity) + 2 (leasesCount) + 72 (lease body) + 8 (date) + 64 (sig)
    //        = 534
    expect(buf.length).toBe(4 + 1 + 2 + 1 + 387 + 2 + 72 + 8 + 64);
  });

  it('[12] multi-leases (2 leases) → leases body is 144 bytes', () => {
    const identity = makeTestIdentity();
    const leases: Lease[] = [
      {
        routerHash: new Uint8Array(32).fill(0xaa),
        tunnelGw: new Uint8Array(32).fill(0xbb),
        expires: 1700000600000,
      },
      {
        routerHash: new Uint8Array(32).fill(0xcc),
        tunnelGw: new Uint8Array(32).fill(0xdd),
        expires: 1700000700000,
      },
    ];
    const buf = encodeCreateLeaseSet2({
      identity,
      sessionId: 99,
      leases,
      expires: 1700000700000,
      dateMs: 1700000000000,
    });
    // Total = 4 (length) + 1 (type) + 2 (sessionId) + payload
    // payload = 1 (sidByte) + 387 (identity) + 2 (leasesCount) + (72*2) leasesBody + 8 (date) + 64 (sig)
    expect(buf.length).toBe(4 + 1 + 2 + 1 + 387 + 2 + 72 * 2 + 8 + 64);
  });

  it('[13] wrong routerHash length (31 bytes) throws', () => {
    const identity = makeTestIdentity();
    const leases: Lease[] = [
      {
        routerHash: new Uint8Array(31).fill(0xab),
        tunnelGw: new Uint8Array(32).fill(0xcd),
        expires: 1700000600000,
      },
    ];
    expect(() =>
      encodeCreateLeaseSet2({
        identity,
        sessionId: 1,
        leases,
        expires: 1700000600000,
        dateMs: 1700000000000,
      }),
    ).toThrow(/routerHash/);
  });

  it('[13b] wrong routerHash length (33 bytes) throws', () => {
    const identity = makeTestIdentity();
    const leases: Lease[] = [
      {
        routerHash: new Uint8Array(33).fill(0xab),
        tunnelGw: new Uint8Array(32).fill(0xcd),
        expires: 1700000600000,
      },
    ];
    expect(() =>
      encodeCreateLeaseSet2({
        identity,
        sessionId: 1,
        leases,
        expires: 1700000600000,
        dateMs: 1700000000000,
      }),
    ).toThrow(/routerHash/);
  });

  it('[14] wrong tunnelGw length throws', () => {
    const identity = makeTestIdentity();
    const leases: Lease[] = [
      {
        routerHash: new Uint8Array(32).fill(0xab),
        tunnelGw: new Uint8Array(16).fill(0xcd),
        expires: 1700000600000,
      },
    ];
    expect(() =>
      encodeCreateLeaseSet2({
        identity,
        sessionId: 1,
        leases,
        expires: 1700000600000,
        dateMs: 1700000000000,
      }),
    ).toThrow(/tunnelGw/);
  });

  it('[15] signature covers identity || leases || date (round-trip)', () => {
    const identity = makeTestIdentity();
    const leases: Lease[] = [
      {
        routerHash: new Uint8Array(32).fill(0xab),
        tunnelGw: new Uint8Array(32).fill(0xcd),
        expires: 1700000600000,
      },
    ];
    const dateMs = 1700000000000;
    const buf = encodeCreateLeaseSet2({
      identity,
      sessionId: 42,
      leases,
      expires: 1700000600000,
      dateMs,
    });

    // Inner payload (after envelope header of 7 bytes) starts with 1-byte sidByte.
    // signedData = identity (387) || leases (72) || date (8).
    const innerPayload = buf.subarray(7);
    const sidByte = innerPayload[0];
    expect(sidByte).toBe(42);
    const identityBytes = innerPayload.subarray(1, 388);
    expect(identityBytes.equals(identity.toByteArray())).toBe(true);

    // leaseCount = 2 bytes BE at offset 388..389
    const leaseCount = innerPayload.readUInt16BE(388);
    expect(leaseCount).toBe(1);

    // leases body = 72 bytes at offset 390..462
    const leasesBody = innerPayload.subarray(390, 462);
    expect(leasesBody.length).toBe(72);

    // date = 8 bytes at offset 462..470
    const dateBytes = innerPayload.subarray(462, 470);
    expect(Number(dateBytes.readBigUInt64BE(0))).toBe(dateMs);

    // signature = 64 bytes at offset 470..534
    const sig = innerPayload.subarray(470, 534);
    expect(sig.length).toBe(64);

    const signedData = Buffer.concat([identityBytes, leasesBody, dateBytes]);
    expect(IdentityEx.verify(identity.toByteArray(), Buffer.from(sig), signedData)).toBe(true);
  });

  it('[16] top-level `expires` is NOT in signedData (signature only covers identity||leases||date)', () => {
    const identity = makeTestIdentity();
    const routerHash = new Uint8Array(32).fill(0xab);
    const tunnelGw = new Uint8Array(32).fill(0xcd);
    const leaseExpires = 1700000600000;

    // Build two frames with identical inner inputs but DIFFERENT top-level expires.
    const buf1 = encodeCreateLeaseSet2({
      identity,
      sessionId: 42,
      leases: [{ routerHash, tunnelGw, expires: leaseExpires }],
      expires: 1700000600000,
      dateMs: 1700000000000,
    });
    const buf2 = encodeCreateLeaseSet2({
      identity,
      sessionId: 42,
      leases: [{ routerHash, tunnelGw, expires: leaseExpires }],
      expires: 9999999999999, // different top-level expires
      dateMs: 1700000000000,
    });

    // The signature must be identical because top-level expires is not in signedData.
    expect(
      buf1.subarray(buf1.length - 64).equals(buf2.subarray(buf2.length - 64)),
    ).toBe(true);
  });

  it('[17] lease.expires is encoded as 8-byte big-endian in the lease body', () => {
    const identity = makeTestIdentity();
    // Use a value that fits in MAX_SAFE_INTEGER (≤ 0x1F_FFFF_FFFF_FFFF).
    // Pattern: 0x0011_2233_4455_6677 — fits comfortably.
    const leaseExpires = 0x11223344556677;
    const buf = encodeCreateLeaseSet2({
      identity,
      sessionId: 1,
      leases: [
        {
          routerHash: new Uint8Array(32).fill(0xab),
          tunnelGw: new Uint8Array(32).fill(0xcd),
          expires: leaseExpires,
        },
      ],
      expires: leaseExpires,
      dateMs: 1700000000000,
    });

    // First lease body starts at offset 7 (envelope) + 1 (sidByte) + 387 (identity) + 2 (leasesCount) = 397
    // lease body is: routerHash[0..32] || tunnelGw[32..64] || expires[64..72]
    const leaseBodyExpires = buf.subarray(7 + 1 + 387 + 2 + 64, 7 + 1 + 387 + 2 + 72);
    expect(Number(leaseBodyExpires.readBigUInt64BE(0))).toBe(leaseExpires);
    // 14-hex-digit input 0x11223344556677 fits in 7 bytes; padded to 8 bytes BE
    // (leading zero) the 8-byte sequence is: 00 11 22 33 44 55 66 77.
    expect(leaseBodyExpires[0]).toBe(0x00);
    expect(leaseBodyExpires[1]).toBe(0x11);
    expect(leaseBodyExpires[2]).toBe(0x22);
    expect(leaseBodyExpires[3]).toBe(0x33);
    expect(leaseBodyExpires[4]).toBe(0x44);
    expect(leaseBodyExpires[5]).toBe(0x55);
    expect(leaseBodyExpires[6]).toBe(0x66);
    expect(leaseBodyExpires[7]).toBe(0x77);
  });
});

describe('encodeCreateSession — determinism (Gold-Master-ish)', () => {
  it('[18] same identity + same dateMs + same properties → identical bytes', () => {
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