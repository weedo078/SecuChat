import { describe, it, expect } from 'vitest';
import {
  generateEd25519Destination,
  computeB32FromPrivKey,
} from './destination-gen';
import { toBase32 } from '../utils/base32';
import { createHash } from 'node:crypto';

const B32_PATTERN = /^[a-z2-7]{52}\.b32\.i2p$/;

describe('generateEd25519Destination (brief)', () => {
  it('produces a 384-byte I2P Ed25519 destination with the right shape', async () => {
    const dest = await generateEd25519Destination();

    expect(dest.privKey).toBeInstanceOf(Uint8Array);
    expect(dest.privKey.length).toBe(384);

    expect(dest.publicKey).toBeInstanceOf(Uint8Array);
    expect(dest.publicKey.length).toBe(32);

    expect(dest.signingPublicKey).toBeInstanceOf(Uint8Array);
    expect(dest.signingPublicKey.length).toBe(32);

    expect(dest.b32Address).toMatch(B32_PATTERN);
  });

  it('produces a deterministic b32 from the privKey blob (round-trip)', async () => {
    const dest = await generateEd25519Destination();
    const b32 = await computeB32FromPrivKey(dest.privKey);
    expect(b32).toBe(dest.b32Address);
  });
});

describe('generateEd25519Destination (defensive)', () => {
  it('entropy: two consecutive calls produce different destinations', async () => {
    const a = await generateEd25519Destination();
    const b = await generateEd25519Destination();
    expect(a.b32Address).not.toBe(b.b32Address);
    expect(a.publicKey).not.toEqual(b.publicKey);
    expect(a.privKey).not.toEqual(b.privKey);
  });

  it('privKey blob layout: bytes 0..31 = private key, bytes 32..63 = public key, bytes 64..383 = zeros', async () => {
    const dest = await generateEd25519Destination();

    // Bytes 32..63 must equal the public key exactly.
    expect(dest.privKey.subarray(32, 64)).toEqual(dest.publicKey);

    // The two halves are NOT the same — the private key seed is different
    // from the public key.
    expect(dest.privKey.subarray(0, 32)).not.toEqual(dest.privKey.subarray(32, 64));

    // Trailing 320 bytes are zeros (matches Java's I2PClient.createDestination).
    const trailing = dest.privKey.subarray(64, 384);
    let allZero = true;
    for (const b of trailing) {
      if (b !== 0) {
        allZero = false;
        break;
      }
    }
    expect(allZero).toBe(true);
  });

  it('signingPublicKey equals publicKey (EdDSA-Ed25519 single-key variant)', async () => {
    const dest = await generateEd25519Destination();
    expect(dest.signingPublicKey).toEqual(dest.publicKey);
  });

  it('b32Address matches an independent SHA-256(base32 + b32) computation', async () => {
    const dest = await generateEd25519Destination();

    // Reconstruct the destination blob independently and verify the b32
    // matches what generateEd25519Destination produced.
    const reconstructed = new Uint8Array(65);
    reconstructed.set(dest.publicKey, 0);
    reconstructed.set(dest.publicKey, 32);
    reconstructed[64] = 0x00;

    const digest = createHash('sha256').update(reconstructed).digest();
    const expected = `${toBase32(new Uint8Array(digest))}.b32.i2p`;
    expect(dest.b32Address).toBe(expected);
  });

  it('b32Address has the exact form [a-z2-7]{52}.b32.i2p', async () => {
    const dest = await generateEd25519Destination();
    expect(dest.b32Address).toMatch(B32_PATTERN);
    // Sanity: must be exactly 52 chars before the ".b32.i2p" suffix.
    const suffix = '.b32.i2p';
    const body = dest.b32Address.slice(0, dest.b32Address.length - suffix.length);
    expect(body.length).toBe(52);
    expect(dest.b32Address.endsWith(suffix)).toBe(true);
  });
});

describe('computeB32FromPrivKey (defensive)', () => {
  it('rejects a non-384-byte privKey blob', async () => {
    const tooShort = new Uint8Array(100);
    await expect(computeB32FromPrivKey(tooShort)).rejects.toThrow(/384-byte/);
    const tooLong = new Uint8Array(500);
    await expect(computeB32FromPrivKey(tooLong)).rejects.toThrow(/384-byte/);
  });

  it('is deterministic: same privKey blob yields the same b32 across calls', async () => {
    const dest = await generateEd25519Destination();
    const a = await computeB32FromPrivKey(dest.privKey);
    const b = await computeB32FromPrivKey(dest.privKey);
    expect(a).toBe(b);
    expect(a).toBe(dest.b32Address);
  });

  it('different privs desynchronize pubKey-at-32 and b32', async () => {
    const a = await generateEd25519Destination();
    const b = await generateEd25519Destination();

    // Build a synthetic 384-byte blob that uses b's public key but a's
    // private key — the b32 should reflect the public key (which is what
    // b32 actually depends on), regardless of the private slot.
    const synthetic = new Uint8Array(384);
    synthetic.set(a.privKey.subarray(0, 32), 0);
    synthetic.set(b.publicKey, 32);

    const b32 = await computeB32FromPrivKey(synthetic);
    const expectedB32 = await computeB32FromPrivKey(b.privKey);
    expect(b32).toBe(expectedB32);
  });
});
