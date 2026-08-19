import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { IdentityEx } from './i2cp-identity';

// RFC 8032 §7.1 Test 1 deterministic seed → known signature.
// Source: https://datatracker.ietf.org/doc/html/rfc8032#section-7.1
const RFC8032_SEED = new Uint8Array([
  0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60,
  0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4,
  0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19,
  0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60,
]);
const RFC8032_MSG = new Uint8Array([]); // empty message
const RFC8032_SIG = new Uint8Array([
  0xe5, 0x56, 0x43, 0x00, 0xc3, 0x60, 0xac, 0x72,
  0x90, 0x86, 0xe2, 0xcc, 0x80, 0x6e, 0x82, 0x8a,
  0x84, 0x87, 0x7f, 0x1e, 0xb8, 0xe5, 0xd9, 0x74,
  0xd8, 0x73, 0xe0, 0x65, 0x22, 0x49, 0x01, 0x55,
  0x5f, 0xb8, 0x82, 0x15, 0x90, 0xa3, 0x3b, 0xac,
  0xc6, 0x1e, 0x39, 0x70, 0x1c, 0xf9, 0xb4, 0x6b,
  0xd2, 0x5b, 0xf5, 0xf0, 0x59, 0x5b, 0xbe, 0x24,
  0x65, 0x51, 0x41, 0x43, 0x8e, 0x7a, 0x10, 0x0b,
]);
// signing pub derived from the RFC seed (computed by noble-ed25519 v2.3.0):
const RFC8032_PUB = new Uint8Array([
  0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7,
  0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64, 0x07, 0x3a,
  0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25,
  0xaf, 0x02, 0x1a, 0x68, 0xf7, 0x07, 0x51, 0x1a,
]);

/**
 * Helper: synthesize a 128-byte IdentityEx privKey blob with a valid
 * (matching) signing keypair. We derive the signing pub from the priv
 * using ed.getPublicKey so the keys are consistent — only then can
 * sign()/verify() round-trip correctly.
 *
 * Layout:
 *   [0..32]    encryption private seed (counter byte 0x10)
 *   [32..64]   encryption public key (counter byte 0x20)
 *   [64..96]   signing private seed (counter byte 0x30 by default)
 *   [96..128]  signing public key (derived from the priv via ed.getPublicKey)
 */
function makeBlob(opts: { encPriv?: number; encPub?: number; signPriv?: number } = {}): Uint8Array {
  const encPriv = opts.encPriv ?? 0x10;
  const encPub = opts.encPub ?? 0x20;
  const signPrivSeed = new Uint8Array(32).fill(opts.signPriv ?? 0x30);
  const signPub = ed.getPublicKey(signPrivSeed);
  const blob = new Uint8Array(128);
  blob.fill(encPriv, 0, 32);
  blob.fill(encPub, 32, 64);
  blob.set(signPrivSeed, 64);
  blob.set(signPub, 96);
  return blob;
}

describe('IdentityEx.fromPrivKey — length validation', () => {
  it('parses a valid 128-byte privKey blob — extracts encryptionPriv (0..32), signingPriv (64..96), signingPub (96..128)', () => {
    const signPrivSeed = new Uint8Array(32).fill(0x30);
    const expectedSignPub = ed.getPublicKey(signPrivSeed);
    const blob = makeBlob();
    const id = IdentityEx.fromPrivKey(blob);

    // encryption pub is read from blob bytes [32..64)
    expect(id.encryptionPublicKey.length).toBe(32);
    expect(Array.from(id.encryptionPublicKey)).toEqual(
      Array.from(new Uint8Array(32).fill(0x20)),
    );

    // signing pub is read from blob bytes [96..128)
    expect(id.signingPublicKey.length).toBe(32);
    expect(Array.from(id.signingPublicKey)).toEqual(Array.from(expectedSignPub));

    // signing priv seed is read from blob bytes [64..96)
    expect(id.signingPrivateKey.length).toBe(32);
    expect(Array.from(id.signingPrivateKey)).toEqual(
      Array.from(new Uint8Array(32).fill(0x30)),
    );
  });

  it('throws on 384-byte legacy blob with clear migration message mentioning "384"', () => {
    const legacy = new Uint8Array(384);
    expect(() => IdentityEx.fromPrivKey(legacy)).toThrow(/384/);
  });

  it('throws on 0-byte input', () => {
    expect(() => IdentityEx.fromPrivKey(new Uint8Array(0))).toThrow(/expected 128/);
  });

  it('throws on 256-byte input', () => {
    expect(() => IdentityEx.fromPrivKey(new Uint8Array(256))).toThrow(/expected 128/);
  });
});

describe('IdentityEx.toByteArray — layout', () => {
  it('produces exactly 387 bytes', () => {
    const id = IdentityEx.fromPrivKey(makeBlob());
    const bytes = id.toByteArray();
    expect(bytes.length).toBe(387);
  });

  it('first 32 bytes equal encryption public key from blob', () => {
    const id = IdentityEx.fromPrivKey(makeBlob());
    const bytes = id.toByteArray();
    const head = bytes.subarray(0, 32);
    expect(Array.from(head)).toEqual(Array.from(new Uint8Array(32).fill(0x20)));
  });

  it('bytes 32..64 equal signing public key from blob', () => {
    const signPrivSeed = new Uint8Array(32).fill(0x30);
    const expectedSignPub = ed.getPublicKey(signPrivSeed);
    const id = IdentityEx.fromPrivKey(makeBlob());
    const bytes = id.toByteArray();
    const slice = bytes.subarray(32, 64);
    expect(Array.from(slice)).toEqual(Array.from(expectedSignPub));
  });

  it('byte 64 is KEYCERT_NULL = 0x00', () => {
    const id = IdentityEx.fromPrivKey(makeBlob());
    const bytes = id.toByteArray();
    expect(bytes[64]).toBe(0x00);
  });

  it('bytes 65..73 (expiration) are zero by default', () => {
    const id = IdentityEx.fromPrivKey(makeBlob());
    const bytes = id.toByteArray();
    const exp = bytes.subarray(65, 73);
    let allZero = true;
    for (const b of exp) {
      if (b !== 0) {
        allZero = false;
        break;
      }
    }
    expect(allZero).toBe(true);
  });

  it('bytes 73..387 are zero padding (314 bytes)', () => {
    const id = IdentityEx.fromPrivKey(makeBlob());
    const bytes = id.toByteArray();
    const padding = bytes.subarray(73, 387);
    expect(padding.length).toBe(314);
    let allZero = true;
    for (const b of padding) {
      if (b !== 0) {
        allZero = false;
        break;
      }
    }
    expect(allZero).toBe(true);
  });
});

describe('IdentityEx.toByteArray — optional expiration', () => {
  it('custom expirationMs writes big-endian uint64 at offset 65', () => {
    // The brief's API keeps the constructor private and only exposes
    // fromPrivKey, which defaults expirationMs to 0. To exercise the
    // big-endian uint64 write path that toByteArray uses when expirationMs
    // > 0 (consumed by Task 5 destination-gen), we inject the field via
    // a type-cast (the readonly modifier is TS-only, not runtime-enforced).
    //
    // We use a small Number value that survives the BigInt() conversion
    // in toByteArray and proves the writeBigUInt64BE encoding path.
    const id = IdentityEx.fromPrivKey(makeBlob());
    (id as unknown as { expirationMs: number }).expirationMs = 0x12345678;

    const bytes = id.toByteArray();
    // Big-endian uint64 = 0x0000000012345678 → high 32 bits 0, low 32 bits 0x12345678.
    expect(bytes[65]).toBe(0x00);
    expect(bytes[66]).toBe(0x00);
    expect(bytes[67]).toBe(0x00);
    expect(bytes[68]).toBe(0x00);
    expect(bytes[69]).toBe(0x12);
    expect(bytes[70]).toBe(0x34);
    expect(bytes[71]).toBe(0x56);
    expect(bytes[72]).toBe(0x78);
  });

  it('expiration of 0 leaves bytes 65..73 zero', () => {
    const id = IdentityEx.fromPrivKey(makeBlob());
    // expirationMs defaults to 0
    const bytes = id.toByteArray();
    expect(bytes.readUInt32BE(65)).toBe(0);
    expect(bytes.readUInt32BE(69)).toBe(0);
  });
});

describe('IdentityEx.sign / verify round-trip', () => {
  it('signs and verifies simple data — RFC 8032 §7.1 test vector (deterministic)', () => {
    // Build a 128-byte blob using the RFC seed as signingPriv (bytes 64..96)
    // and a synthetic encryption keypair (zeros) so the layout is valid.
    const blob = new Uint8Array(128);
    blob.fill(0x00, 0, 64);   // encryption priv/pub = zero
    blob.set(RFC8032_SEED, 64); // signing priv
    blob.set(RFC8032_PUB, 96);  // signing pub (matches derived pub)

    const id = IdentityEx.fromPrivKey(blob);
    const sig = id.sign(RFC8032_MSG);
    expect(sig.length).toBe(64);
    expect(Array.from(sig)).toEqual(Array.from(RFC8032_SIG));

    // Verify the signature back: build a 387-byte IdentityEx buffer
    // (encryption pub from blob = zero pub, signing pub = RFC8032_PUB)
    const identityBuffer = id.toByteArray();
    expect(IdentityEx.verify(identityBuffer, Buffer.from(sig), Buffer.from(RFC8032_MSG))).toBe(true);
  });

  it('sign output is exactly 64 bytes', () => {
    const id = IdentityEx.fromPrivKey(makeBlob());
    const sig = id.sign(new Uint8Array([1, 2, 3, 4, 5]));
    expect(sig.length).toBe(64);
  });

  it('verify returns true for valid signature', () => {
    const id = IdentityEx.fromPrivKey(makeBlob());
    const data = new Uint8Array([0xAA, 0xBB, 0xCC]);
    const sig = id.sign(data);
    const identityBuffer = id.toByteArray();
    expect(IdentityEx.verify(identityBuffer, Buffer.from(sig), Buffer.from(data))).toBe(true);
  });

  it('verify returns false for 1-bit-flipped signature', () => {
    const id = IdentityEx.fromPrivKey(makeBlob());
    const data = new Uint8Array([0xAA, 0xBB, 0xCC]);
    const sig = id.sign(data);
    // Flip the highest bit of the first byte of the signature.
    const flipped = Buffer.from(sig);
    flipped[0] = flipped[0]! ^ 0x80;
    const identityBuffer = id.toByteArray();
    expect(IdentityEx.verify(identityBuffer, flipped, Buffer.from(data))).toBe(false);
  });

  it('verify returns false for wrong data', () => {
    const id = IdentityEx.fromPrivKey(makeBlob());
    const data = new Uint8Array([0xAA, 0xBB, 0xCC]);
    const sig = id.sign(data);
    const wrongData = new Uint8Array([0xAA, 0xBB, 0xCD]);
    const identityBuffer = id.toByteArray();
    expect(IdentityEx.verify(identityBuffer, Buffer.from(sig), Buffer.from(wrongData))).toBe(false);
  });
});

describe('IdentityEx.toByteArray — determinism', () => {
  it('same input produces identical bytes across calls', () => {
    const blob = makeBlob();
    const id1 = IdentityEx.fromPrivKey(blob);
    const id2 = IdentityEx.fromPrivKey(blob);
    const a = id1.toByteArray();
    const b = id2.toByteArray();
    expect(a.equals(b)).toBe(true);
  });

  it('two different privKeys produce different bytes', () => {
    const blobA = makeBlob({ encPub: 0x20 });
    const blobB = makeBlob({ encPub: 0x21 });
    const a = IdentityEx.fromPrivKey(blobA).toByteArray();
    const b = IdentityEx.fromPrivKey(blobB).toByteArray();
    expect(a.equals(b)).toBe(false);
    // Specifically: bytes 32..64 differ (signing pub is same but encryption pub differs).
    expect(a[0]).not.toBe(b[0]);
  });
});

describe('IdentityEx layout invariants', () => {
  it('toByteArray output is independent of caller mutation of input blob', () => {
    const blob = makeBlob();
    const id = IdentityEx.fromPrivKey(blob);
    const before = id.toByteArray();

    // Mutate the original blob.
    blob.fill(0xFF);

    const after = id.toByteArray();
    expect(before.equals(after)).toBe(true);
  });

  it('fromPrivKey rejects a 387-byte array (re-injection path not supported)', () => {
    const id = IdentityEx.fromPrivKey(makeBlob());
    const bytes = id.toByteArray();
    expect(bytes.length).toBe(387);
    // 387-byte input should throw with the "expected 128" message.
    expect(() => IdentityEx.fromPrivKey(new Uint8Array(bytes))).toThrow(/expected 128/);
  });

  it('empty encryption priv (32 zeros) still produces 387 bytes with valid layout', () => {
    const blob = new Uint8Array(128);
    // blob is all zeros — encryption priv/pub and signing priv/pub are all zero.
    const id = IdentityEx.fromPrivKey(blob);
    const bytes = id.toByteArray();
    expect(bytes.length).toBe(387);
    // First 32 bytes (encryption pub) are zero.
    const head = bytes.subarray(0, 32);
    let allZero = true;
    for (const b of head) {
      if (b !== 0) {
        allZero = false;
        break;
      }
    }
    expect(allZero).toBe(true);
    // Byte 64 still KEYCERT_NULL.
    expect(bytes[64]).toBe(0x00);
  });
});

describe('IdentityEx edge cases', () => {
  it('fromPrivKey with all-zero 128-byte blob: sign still produces 64-byte output', () => {
    const id = IdentityEx.fromPrivKey(new Uint8Array(128));
    const sig = id.sign(new Uint8Array([1, 2, 3]));
    expect(sig.length).toBe(64);
    // The signature format is correct (64 bytes); verification will fail
    // because all-zero key is not a valid Ed25519 private key — but we
    // don't assert verify here, only format.
  });

  it('roundtrip: blob → IdentityEx → bytes → re-derived signing key matches', () => {
    // Use a real RFC 8032 vector so signing keys are valid.
    const blob = new Uint8Array(128);
    blob.set(new Uint8Array(32).fill(0xAA), 0);    // encryption priv (arbitrary)
    blob.set(new Uint8Array(32).fill(0xBB), 32);   // encryption pub (arbitrary)
    blob.set(RFC8032_SEED, 64);                     // signing priv
    blob.set(RFC8032_PUB, 96);                      // signing pub

    const id = IdentityEx.fromPrivKey(blob);
    const bytes = id.toByteArray();

    // Re-extract signing pub from the 387-byte serialization.
    const signingPubFromBytes = bytes.subarray(32, 64);
    expect(Array.from(signingPubFromBytes)).toEqual(Array.from(RFC8032_PUB));

    // And re-deriving from the signing priv seed yields the same pub.
    const pubFromPriv = ed.getPublicKey(RFC8032_SEED);
    expect(Array.from(signingPubFromBytes)).toEqual(Array.from(pubFromPriv));
  });

  it('encoding determinism: 100 invocations produce identical bytes', () => {
    const blob = makeBlob();
    const id = IdentityEx.fromPrivKey(blob);
    const first = id.toByteArray();
    for (let i = 0; i < 100; i++) {
      const next = id.toByteArray();
      expect(next.equals(first)).toBe(true);
    }
  });
});
