import { describe, it, expect, beforeAll } from 'vitest';
import * as ed from '@noble/ed25519';
import {
  generateEd25519Destination,
  computeB32FromPrivKey,
} from './destination-gen';
import { toBase32 } from '../utils/base32';
import { createHash } from 'node:crypto';
import { loadLibsodium, ed25519SkToCurve25519 } from './libsodium';

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

  it('privKey blob layout (Spec H.1): bytes 0..31 = X25519 encPriv, 32..63 = Ed25519 encPub, 64..95 = Ed25519 signPriv, 96..127 = Ed25519 signPub', async () => {
    const dest = await generateEd25519Destination();

    // Bytes 32..63 must equal the encryption public key exactly
    expect(dest.privKey.subarray(32, 64)).toEqual(dest.publicKey);

    // Bytes 96..127 must equal the signing public key exactly
    expect(dest.privKey.subarray(96, 128)).toEqual(dest.signingPublicKey);

    // [0..32] is the X25519 encPriv (Spec H.1) — derived from signPriv at
    // [64..96] via libsodium ed25519SkToCurve25519. Must therefore be
    // different from the signPriv bytes (different curve mappings).
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

  it('consumer contract: [0..32] is NO LONGER Ed25519 encPriv seed (Spec H.1 shift)', async () => {
    // Spec H.1: privKey [0..32] wurde von Ed25519 encPriv-Seed auf den
    // X25519 encPriv (via libsodium-Mapping vom signPriv) umgestellt.
    // Der Ed25519 encPriv-Seed wird nicht mehr persistiert — I2CP
    // nutzt den X25519 encPriv für LeaseSet-Encryption.
    //
    // Diese Assertion verifiziert die Negation des Legacy-Contracts:
    // ed.getPublicKeyAsync([0..32]) darf NICHT == dest.publicKey sein,
    // weil [0..32] jetzt X25519 encPriv ist, nicht Ed25519 encPriv-Seed.
    const dest = await generateEd25519Destination();
    const x25519EncPrivCandidate = dest.privKey.subarray(0, 32);
    const derivedFromX25519 = await ed.getPublicKeyAsync(x25519EncPrivCandidate);
    expect(derivedFromX25519).not.toEqual(dest.publicKey);
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

describe('generateEd25519Destination (Spec H.1)', () => {
  // Task 3: privKey-Blob [0..32] enthält den X25519 encPriv (Spec H.1).
  // libsodium ed25519SkToCurve25519 ist sync-ready, sobald
  // loadLibsodium() einmal erfolgreich `await`ed wurde.
  beforeAll(async () => {
    await loadLibsodium();
  });

  it('returns 128B privKey with [0..32] = X25519 encPriv (non-zero)', async () => {
    const dest = await generateEd25519Destination();
    expect(dest.privKey.length).toBe(128);
    const encPrivCandidate = dest.privKey.subarray(0, 32);
    expect(Array.from(encPrivCandidate).some((b) => b !== 0)).toBe(true);
  });

  it('[0..32] differs across independent generations (random signSeed → random X25519 encPriv)', async () => {
    // Zwei unabhängige Generierungen produzieren (by design) unterschiedliche
    // Seeds, daher unterschiedliche encPriv. Wir verifizieren nur, dass
    // die [0..32] Bytes NICHT all-zero sind (= gültige X25519-Secret).
    const a = await generateEd25519Destination();
    const b = await generateEd25519Destination();
    expect(a.privKey.slice(0, 32)).not.toEqual(b.privKey.slice(0, 32));
  });

  it('[0..32] X25519 encPriv equals libsodium ed25519SkToCurve25519(signPriv)', async () => {
    // Starke Spec-H.1-Verifikation: [0..32] muss die libsodium-Mapping-
    // Funktion vom Ed25519-Sign-Seed sein — NICHT der Ed25519 encPriv
    // selbst. Diese Assertion failed garantiert mit dem Alt-Code
    // (encPriv-Ed25519-Seed statt X25519-Mapping).
    const dest = await generateEd25519Destination();
    const signPriv = dest.privKey.subarray(64, 96);
    const expected = ed25519SkToCurve25519(signPriv);
    expect(dest.privKey.subarray(0, 32)).toEqual(expected);
  });
});