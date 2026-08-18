import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IdentityStore } from './identity-store';

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
    const privKey = new Uint8Array(384);  // typical Ed25519 destination size
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
});

describe('cross-platform compatibility', () => {
  it('reads Android-generated identity file format', async () => {
    // Simulate Android IdentityStore.save() output:
    // salt(16) + iv(12) + privKey(384 bytes)
    const salt = Buffer.alloc(16, 0xAA);
    const iv = Buffer.alloc(12, 0xBB);
    const privKey = Buffer.alloc(384, 0x42);
    const androidFile = Buffer.concat([salt, iv, privKey]);

    const androidPath = join(tmpdir(), `i2p-android-${Date.now()}.bin`);
    await fs.writeFile(androidPath, androidFile);

    const store = new IdentityStore(androidPath);
    const loaded = await store.loadOrNull();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(new Uint8Array(privKey));
  });
});
