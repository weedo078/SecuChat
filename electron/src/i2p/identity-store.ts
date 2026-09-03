import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const FILE_HEADER_SALT = 16;
const FILE_HEADER_IV = 12;
const MIN_FILE_SIZE = FILE_HEADER_SALT + FILE_HEADER_IV + 1;

export class IdentityStore {
  constructor(private readonly filePath: string) {}

  /**
   * Load raw privKey bytes from disk, or return null if file missing/corrupt.
   * Format: [16-byte salt][12-byte IV][privKey bytes]
   * Currently UNENCRYPTED (no passphrase) — matches Android IdentityStore.java:58-61.
   * PBKDF2/GCM layers are scaffolded for Task 12 but not yet wired.
   *
   * Format migration: payload must be exactly 128 bytes (Phase-F IdentityEx
   * layout: encPriv || encPub || signPriv || signPub). Persisted files from
   * earlier Electron builds were 384 bytes (a single raw Ed25519 keypair +
   * extra metadata) and cannot be safely migrated to the new layout — the
   * new layout requires TWO independent Ed25519 keypairs that the old file
   * does not contain. Returning null here triggers `start()` to regenerate
   * the identity, which is the only correct behaviour; users with stale
   * 384-byte files will get a fresh I2P identity and need to re-swap
   * contacts (the old b32 from those files is already dead anyway because
   * the corresponding I2P destinations were never republished).
   */
  async loadOrNull(): Promise<Uint8Array | null> {
    let buf: Buffer;
    try {
      buf = await fs.readFile(this.filePath);
    } catch {
      return null;
    }
    if (buf.length < MIN_FILE_SIZE) return null;
    const payload = new Uint8Array(buf.subarray(FILE_HEADER_SALT + FILE_HEADER_IV));
    if (payload.length !== 128) {
      // Stale format — log a single warning so the user sees why their
      // identity was regenerated instead of treating this as silent
      // corruption. `start()` will overwrite the file with a fresh 128-byte
      // payload on the next save().
      console.warn(
        `IdentityStore: discarding stale ${payload.length}-byte privKey ` +
          `(expected 128); regenerating identity. ` +
          `Any contacts that pointed to the previous b32 must be re-swapped.`,
      );
      return null;
    }
    // Spec H.1 v3→v4 migration detection: a pre-Spec-H.1 128-byte blob has
    // an all-zero X25519 encryption-private-key slot at bytes [0..32] (the
    // legacy layout only carried the Ed25519 encPriv-Seed there, which has
    // since been replaced with an X25519 encPriv via libsodium). Returning
    // null signals `start()` to regenerate via `generateEd25519Destination()`
    // and re-save — the old b32 has no LeaseSet behind it (Spec H.1 was the
    // first release that persisted the X25519 encPriv), so existing
    // contacts pointing at the old b32 are effectively dead.
    const x25519Candidate = payload.subarray(0, 32);
    if (x25519Candidate.every((b) => b === 0)) {
      console.warn(
        'IdentityStore: pre-Spec-H.1 blob detected (all-zero X25519 slot). ' +
          'Regenerating identity. Existing contacts with old b32 are dead.',
      );
      return null;
    }
    return payload;
  }

  /**
   * Persist privKey bytes to disk with random salt + IV header.
   * Throws on any IO error (does NOT swallow like Android IdentityStore.java:77-79).
   */
  async save(privKey: Uint8Array): Promise<void> {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    const salt = randomBytes(FILE_HEADER_SALT);
    const iv = randomBytes(FILE_HEADER_IV);
    const out = Buffer.concat([salt, iv, Buffer.from(privKey)]);
    await fs.writeFile(this.filePath, out);
  }
}
