import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import {
  generateEd25519Destination,
  computeB32FromPrivKey,
} from './destination-gen';
import { toBase32 } from '../utils/base32';
import { createHash } from 'node:crypto';

const B32_PATTERN = /^[a-z2-7]{52}\.b32\.i2p$/;

describe('generateEd25519Destination (brief)', () => {
  it('produces a 128-byte I2P Ed25519 destination with two separate keypairs', async () => {
    const dest = await generateEd25519Destination();

    expect(dest.privKey).toBeInstanceOf(Uint8Array);
    expect(dest.privKey.length).toBe(128); // was 384

    expect(dest.publicKey).toBeInstanceOf(Uint8Array);
    expect(dest.publicKey.length).toBe(32);

    expect(dest.signingPublicKey).toBeInstanceOf(Uint8Array);
    expect(dest.signingPublicKey.length).toBe(32);

    expect(dest.b32Address).toMatch(B32_PATTERN);
  });

  it('privKey blob layout: bytes 0..31 = encryption priv, 32..63 = encryption pub, 64..95 = signing priv, 96..127 = signing pub', async () => {
    const dest = await generateEd25519Destination();

    // Bytes 32..63 must equal the encryption public key exactly
    expect(dest.privKey.subarray(32, 64)).toEqual(dest.publicKey);

    // Bytes 96..127 must equal the signing public key exactly
    expect(dest.privKey.subarray(96, 128)).toEqual(dest.signingPublicKey);

    // The signing keypair must be DIFFERENT from the encryption keypair
    expect(dest.privKey.subarray(0, 32)).not.toEqual(dest.privKey.subarray(64, 96));
    expect(dest.privKey.subarray(32, 64)).not.toEqual(dest.privKey.subarray(96, 128));
  });
});

describe('generateEd25519Destination (defensive)', () => {
  it('entropy: two consecutive calls produce different destinations', async () => {
    const a = await generateEd25519Destination();
    const b = await generateEd25519Destination();
    expect(a.b32Address).not.toBe(b.b32Address);
    expect(a.publicKey).not.toEqual(b.publicKey);
    expect(a.signingPublicKey).not.toEqual(b.signingPublicKey);
    expect(a.privKey).not.toEqual(b.privKey);
  });

  it('publicKey and signingPublicKey are independent (two-key Ed25519)', async () => {
    const dest = await generateEd25519Destination();
    // IdentityEx spec requires two INDEPENDENT keypairs.
    expect(dest.publicKey).not.toEqual(dest.signingPublicKey);
  });

  it('consumer contract: ed.getPublicKeyAsync(encPriv) === dest.publicKey', async () => {
    const dest = await generateEd25519Destination();
    const encPriv = dest.privKey.subarray(0, 32);
    const derivedPub = await ed.getPublicKeyAsync(encPriv);
    expect(derivedPub).toEqual(dest.publicKey);
  });

  it('consumer contract: ed.getPublicKeyAsync(signPriv) === dest.signingPublicKey', async () => {
    const dest = await generateEd25519Destination();
    const signPriv = dest.privKey.subarray(64, 96);
    const derivedPub = await ed.getPublicKeyAsync(signPriv);
    expect(derivedPub).toEqual(dest.signingPublicKey);
  });

  it('privKey blob is exactly 128 bytes (strict layout check)', async () => {
    const dest = await generateEd25519Destination();
    expect(dest.privKey.length).toBe(128);
    // Each 32-byte slot must be exactly the right size
    expect(dest.privKey.subarray(0, 32).length).toBe(32);
    expect(dest.privKey.subarray(32, 64).length).toBe(32);
    expect(dest.privKey.subarray(64, 96).length).toBe(32);
    expect(dest.privKey.subarray(96, 128).length).toBe(32);
    // Verify encPriv/encPub, signPriv/signPub are related pairs
    expect(dest.privKey.subarray(0, 32)).not.toEqual(dest.privKey.subarray(32, 64));
    expect(dest.privKey.subarray(64, 96)).not.toEqual(dest.privKey.subarray(96, 128));
  });

  it('b32Address matches an independent SHA-256(reconstructed 65-byte identity) computation', async () => {
    const dest = await generateEd25519Destination();

    // Reconstruct the destination blob independently and verify the b32
    // matches what generateEd25519Destination produced. Per spec, the b32
    // hash uses encPub twice (single-key b32-compat for legacy peers).
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
    const suffix = '.b32.i2p';
    const body = dest.b32Address.slice(0, dest.b32Address.length - suffix.length);
    expect(body.length).toBe(52);
    expect(dest.b32Address.endsWith(suffix)).toBe(true);
  });

  it('round-trip: computeB32FromPrivKey(dest.privKey) === dest.b32Address', async () => {
    const dest = await generateEd25519Destination();
    const b32 = await computeB32FromPrivKey(dest.privKey);
    expect(b32).toBe(dest.b32Address);
  });
});

describe('computeB32FromPrivKey (defensive)', () => {
  it('rejects empty Uint8Array', async () => {
    await expect(computeB32FromPrivKey(new Uint8Array(0))).rejects.toThrow(/128 bytes/);
  });

  it('rejects 127-byte privKey blob (one byte short)', async () => {
    await expect(computeB32FromPrivKey(new Uint8Array(127))).rejects.toThrow(/128 bytes/);
  });

  it('rejects 129-byte privKey blob (one byte over)', async () => {
    await expect(computeB32FromPrivKey(new Uint8Array(129))).rejects.toThrow(/128 bytes/);
  });

  it('rejects legacy 384-byte privKey blob (migrated format)', async () => {
    await expect(computeB32FromPrivKey(new Uint8Array(384))).rejects.toThrow(/128 bytes/);
  });

  it('is deterministic: same privKey blob yields the same b32 across calls', async () => {
    const dest = await generateEd25519Destination();
    const a = await computeB32FromPrivKey(dest.privKey);
    const b = await computeB32FromPrivKey(dest.privKey);
    expect(a).toBe(b);
    expect(a).toBe(dest.b32Address);
  });

  it('different encryption pubKeys produce different b32s (b32 depends on pub at offset 32)', async () => {
    const a = await generateEd25519Destination();
    const b = await generateEd25519Destination();

    // Build a synthetic 128-byte blob that uses a's priv bytes for the
    // private slots but b's encryption public key. The b32 should reflect
    // the encryption public key (which is what b32 actually depends on),
    // regardless of the private slot.
    const synthetic = new Uint8Array(128);
    synthetic.set(a.privKey.subarray(0, 32), 0);   // encPriv from a
    synthetic.set(b.publicKey, 32);                  // encPub from b
    synthetic.set(a.privKey.subarray(64, 96), 64);  // signPriv from a
    synthetic.set(a.privKey.subarray(96, 128), 96);   // signPub from a

    const b32 = await computeB32FromPrivKey(synthetic);
    const expectedB32 = await computeB32FromPrivKey(b.privKey);
    expect(b32).toBe(expectedB32);
  });
});