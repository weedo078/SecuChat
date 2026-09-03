import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdentityStore } from './identity-store';
import { generateEd25519Destination } from './destination-gen';

describe('IdentityStore', () => {
  let filePath: string;
  let store: IdentityStore;

  beforeEach(async () => {
    filePath = join(tmpdir(), `i2p-identity-test-${Date.now()}.bin`);
    store = new IdentityStore(filePath);
  });

  it('loadOrNull returns null when file does not exist', async () => {
    expect(await store.loadOrNull()).toBeNull();
  });

  it('round-trips privKey bytes', async () => {
    const privKey = new Uint8Array(128);  // Phase-F IdentityEx layout: encPriv||encPub||signPriv||signPub
    for (let i = 0; i < privKey.length; i++) privKey[i] = i & 0xFF;
    await store.save(privKey);
    const loaded = await store.loadOrNull();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(privKey);
  });

  it('save() throws on permission denied', async () => {
    const badPath = '/root/forbidden/i2p-identity.bin';
    const badStore = new IdentityStore(badPath);
    await expect(badStore.save(new Uint8Array(10))).rejects.toThrow();
  });

  it('returns null on corrupted file (too short)', async () => {
    await fs.writeFile(filePath, Buffer.from([1, 2, 3]));
    expect(await store.loadOrNull()).toBeNull();
  });

  it('discards stale 384-byte payload (pre-Phase-F format)', async () => {
    // Pre-Phase-F Electron builds persisted a 384-byte raw Ed25519 keyblob;
    // that layout cannot be migrated to the current 128-byte IdentityEx
    // layout because the old file lacks the second Ed25519 keypair. The
    // store must return null so `start()` regenerates a fresh identity
    // instead of crashing on `computeB32FromPrivKey`.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const salt = Buffer.alloc(16, 0xAA);
      const iv = Buffer.alloc(12, 0xBB);
      const stalePrivKey = Buffer.alloc(384, 0x42);
      await fs.writeFile(filePath, Buffer.concat([salt, iv, stalePrivKey]));

      expect(await store.loadOrNull()).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('stale 384-byte privKey'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('cross-platform compatibility', () => {
  it('reads Android-generated identity file format', async () => {
    // Simulate Android IdentityStore.save() output:
    // salt(16) + iv(12) + privKey(128 bytes IdentityEx layout)
    const salt = Buffer.alloc(16, 0xAA);
    const iv = Buffer.alloc(12, 0xBB);
    const privKey = Buffer.alloc(128, 0x42);
    const androidFile = Buffer.concat([salt, iv, privKey]);

    const androidPath = join(tmpdir(), `i2p-android-${Date.now()}.bin`);
    await fs.writeFile(androidPath, androidFile);

    const store = new IdentityStore(androidPath);
    const loaded = await store.loadOrNull();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(new Uint8Array(privKey));
  });
});

describe('IdentityStore v3→v4 migration (Spec H.1)', () => {
  // Helper: write a 128-byte privKey payload to disk through the
  // production-format salt+iv header so we exercise the same code path
  // the IdentityStore uses for normal save().
  async function writeBlobWithHeader(
    targetPath: string,
    payload: Uint8Array,
  ): Promise<void> {
    const salt = Buffer.alloc(16, 0xAA);
    const iv = Buffer.alloc(12, 0xBB);
    await fs.writeFile(targetPath, Buffer.concat([salt, iv, Buffer.from(payload)]));
  }

  it('detects old-form 128B blob (all-zero [0..32]) and returns null', async () => {
    // Pre-Spec-H.1 layout: bytes [0..32] carried the Ed25519 encPriv-Seed,
    // not the X25519 encPriv. After Spec H.1, that slot must hold the
    // X25519 encPriv (32B, never all-zero for a real key). The store
    // treats an all-zero slot as the v3 marker and refuses to load —
    // `start()` regenerates via `generateEd25519Destination()`.
    const path = join(tmpdir(), `i2p-v3-old-form-${Date.now()}.bin`);
    const oldBlob = new Uint8Array(128);
    oldBlob.fill(0x42, 32, 64);   // encPub
    oldBlob.fill(0x43, 64, 96);   // signPriv
    oldBlob.fill(0x42, 96, 128);  // signPub
    // [0..32] stays all-zero (the v3 marker)
    await writeBlobWithHeader(path, oldBlob);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const store = new IdentityStore(path);
      expect(await store.loadOrNull()).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('pre-Spec-H.1 blob detected'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('accepts new-form 128B blob (non-zero [0..32])', async () => {
    // Spec-H.1 layout: [0..32] carries the X25519 encPriv. A real
    // generateEd25519Destination() call always produces non-zero
    // bytes in that slot because libsodium's ed25519SkToCurve25519
    // never returns an all-zero result for a valid Ed25519 seed.
    // Here we fabricate the slot deterministically to keep the test
    // hermetic (no real libsodium call).
    const path = join(tmpdir(), `i2p-v4-new-form-${Date.now()}.bin`);
    const newBlob = new Uint8Array(128);
    newBlob.fill(0xaa, 0, 32);    // X25519 encPriv (non-zero)
    newBlob.fill(0x42, 32, 64);   // encPub
    newBlob.fill(0x43, 64, 96);   // signPriv
    newBlob.fill(0x42, 96, 128);  // signPub
    await writeBlobWithHeader(path, newBlob);

    const store = new IdentityStore(path);
    const loaded = await store.loadOrNull();
    expect(loaded).toBeDefined();
    expect(loaded).toEqual(newBlob);
    // Sanity: the [0..32] slot survived the round-trip intact
    expect(Array.from(loaded!.subarray(0, 32))).toEqual(
      Array.from(newBlob.subarray(0, 32)),
    );
  });

  it('regenerates IdentityEx when old-form detected', async () => {
    // Real migration path: store holds a v3 blob → loadOrNull() returns
    // null → start() regenerates via generateEd25519Destination() and
    // saves → next loadOrNull() returns the new blob whose [0..32]
    // slot is non-zero (X25519 encPriv). We simulate this at the unit
    // level because the actual `start()` lives in i2p-plugin.ts (out of
    // scope for this task per the Brief's Boundaries).
    const path = join(tmpdir(), `i2p-v4-regen-${Date.now()}.bin`);
    const oldBlob = new Uint8Array(128);
    oldBlob.fill(0x42, 32, 64);
    oldBlob.fill(0x43, 64, 96);
    oldBlob.fill(0x42, 96, 128);
    // [0..32] all-zero
    await writeBlobWithHeader(path, oldBlob);

    const store = new IdentityStore(path);

    // Phase 1: old-form loadOrNull() → null
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await store.loadOrNull()).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }

    // Phase 2: simulate `start()` regenerating via
    // generateEd25519Destination() — that helper is the canonical
    // Spec-H.1 producer of 128-byte blobs with non-zero [0..32].
    const regenerated = await generateEd25519Destination();
    await store.save(regenerated.privKey);

    // Phase 3: next loadOrNull() returns the regenerated blob with a
    // populated X25519 encPriv slot (never all-zero for real keys).
    const reloaded = await store.loadOrNull();
    expect(reloaded).not.toBeNull();
    expect(reloaded!.length).toBe(128);
    expect(reloaded!.subarray(0, 32).some((b) => b !== 0)).toBe(true);
  });
});
