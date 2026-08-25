import { createHash } from 'node:crypto';
import * as ed from '@noble/ed25519';

/**
 * Wire up a synchronous SHA-512 implementation so that `ed.sign` and
 * `ed.verify` can run synchronously. noble-ed25519 v2.x ships only an
 * async SHA-512 by default; without this wiring the sync sign path
 * throws "sha512Sync is undefined".
 *
 * We use Node's built-in `crypto.createHash` because:
 *   1. It is sync, deterministic, and FIPS-compliant.
 *   2. It avoids adding @noble/hashes as an extra dependency.
 *
 * Subsequent tasks (session-creator, message-stream) depend on sync
 * signing/verification, so this module-level side effect is intentional.
 */
ed.etc.sha512Sync = (...messages: Uint8Array[]): Uint8Array => {
  const hash = createHash('sha512');
  for (const m of messages) {
    hash.update(m);
  }
  return new Uint8Array(hash.digest());
};

/**
 * IdentityEx — Java-I2P-compatible 387-byte destination serialization.
 *
 * Layout (after toByteArray):
 *   [0..32]    encryption public key (Ed25519)
 *   [32..64]   signing public key (Ed25519 — separate from encryption for spec compliance)
 *   [64]       key certificate type (0x00 = KEYCERT_NULL, 0x05 = KEYCERT_SIGNED, ...)
 *   [65..73]   expiration (8 bytes BE, default 0 = no expiration)
 *   [73..387]  padding (314 bytes of 0x00 for Java IdentityEx-Compat)
 *
 * PrivKey-Blob (128 bytes, our internal storage):
 *   [0..32]    encryption private seed
 *   [32..64]   encryption public key
 *   [64..96]   signing private seed (NOT derived — separate Ed25519 keypair)
 *   [96..128]  signing public key
 *
 * Legacy 384-byte blobs (encryption-only with zero padding) are explicitly rejected.
 */
export class IdentityEx {
  private constructor(
    public readonly encryptionPublicKey: Uint8Array,
    public readonly signingPublicKey: Uint8Array,
    public readonly signingPrivateKey: Uint8Array,
    public readonly cert: number = 0x00,
    public readonly expirationMs: number = 0,
  ) {}

  static fromPrivKey(blob: Uint8Array): IdentityEx {
    if (blob.length === 384) {
      throw new Error(
        'Legacy 384-byte privKey blob detected (encryption-only format). ' +
        'Please migrate to the new 128-byte 2-key Ed25519 format by ' +
        'regenerating the identity (existing key will be discarded — ' +
        'no usable contacts existed with the legacy format).',
      );
    }
    if (blob.length !== 128) {
      throw new Error(`IdentityEx.fromPrivKey: expected 128 bytes, got ${blob.length}`);
    }
    // Copy each slot out of the source blob so later caller-side mutation
    // of the original blob cannot affect this IdentityEx. We use Buffer-
    // level slicing via Uint8Array.from(typedArray) to clone the data.
    const encPub = Uint8Array.from(blob.subarray(32, 64));   // encryption pub
    const signPub = Uint8Array.from(blob.subarray(96, 128)); // signing pub
    const signPriv = Uint8Array.from(blob.subarray(64, 96)); // signing priv seed
    return new IdentityEx(encPub, signPub, signPriv, 0x00, 0);
  }

  static fromDestinationBytes(rawBytes: Buffer | Uint8Array): IdentityEx {
    if (rawBytes.length !== 387) {
      throw new Error(
        `IdentityEx.fromDestinationBytes: expected 387 bytes, got ${rawBytes.length}`,
      );
    }
    const encPub = Uint8Array.from(rawBytes.subarray(0, 32));
    const signPub = Uint8Array.from(rawBytes.subarray(32, 64));
    const cert = rawBytes[64];
    // DataView (vs Buffer.readBigUInt64BE) keeps the public API compatible
    // with both `Buffer` and plain `Uint8Array` while reading big-endian
    // uint64 at offset 65 (i.e. bytes 65..73 = IdentityEx expiration).
    const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength);
    const expirationMs = Number(view.getBigUint64(65));
    // NOTE: fromDestinationBytes does NOT have a signingPrivateKey — the
    // wire-format Destination blob only carries public-key material.
    // Callers that need to sign must keep the original 128-byte privKey
    // blob separately and combine via `fromPrivKey` if applicable.
    return new IdentityEx(encPub, signPub, new Uint8Array(32), cert, expirationMs);
  }

  toByteArray(): Buffer {
    const buf = Buffer.alloc(387);
    Buffer.from(this.encryptionPublicKey).copy(buf, 0);
    Buffer.from(this.signingPublicKey).copy(buf, 32);
    buf[64] = this.cert;
    if (this.expirationMs > 0) {
      buf.writeBigUInt64BE(BigInt(this.expirationMs), 65);
    }
    // bytes 73..387 stay zero (padding for Java IdentityEx-Compat)
    return buf;
  }

  sign(data: Uint8Array): Uint8Array {
    return ed.sign(data, this.signingPrivateKey);
  }

  static verify(identity: Buffer, sig: Buffer, data: Buffer): boolean {
    const signingPub = identity.subarray(32, 64);
    return ed.verify(sig, data, signingPub);
  }
}
