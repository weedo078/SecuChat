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
   */
  async loadOrNull(): Promise<Uint8Array | null> {
    let buf: Buffer;
    try {
      buf = await fs.readFile(this.filePath);
    } catch {
      return null;
    }
    if (buf.length < MIN_FILE_SIZE) return null;
    return new Uint8Array(buf.subarray(FILE_HEADER_SALT + FILE_HEADER_IV));
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
