/**
 * Group Key Exchange Service — X25519 ECDH key exchange for group chat encryption
 *
 * Uses tweetnacl's nacl.box (X25519 + XSalsa20-Poly1305) to encrypt the
 * AES-256 group symmetric key per-member, eliminating plaintext key transport.
 */

import nacl from 'tweetnacl';
import { uint8ArrayToBase64, base64ToUint8Array } from '@/utils/base32';
import { logger } from '@/utils/logger';

export interface EncryptedKeyPayload {
  /** Base64-encoded ephemeral X25519 public key used for this encryption */
  ephemeralPublicKey: string;
  /** Base64-encoded 24-byte nonce */
  nonce: string;
  /** Base64-encoded ciphertext (XSalsa20-Poly1305 encrypted group key) */
  ciphertext: string;
}

export interface KeyPair {
  publicKey: Uint8Array;
  /** tweetnacl calls this secretKey, aliased as privateKey for consistency */
  secretKey: Uint8Array;
}

class GroupKeyExchangeService {
  // ── Key generation ──────────────────────────────────────────────────

  /**
   * Generate a new X25519 keypair for ephemeral group key exchange.
   */
  generateGroupKeyPair(): KeyPair {
    return nacl.box.keyPair();
  }

  /**
   * Generate a random 256-bit symmetric key and return as base64.
   */
  generateSymmetricKey(): string {
    const key = crypto.getRandomValues(new Uint8Array(32));
    return uint8ArrayToBase64(key);
  }

  // ── Per-member encryption ───────────────────────────────────────────

  /**
   * Encrypt the group symmetric key for a specific member using ECDH.
   *
   * @param memberPublicKey - Member's X25519 public key (raw bytes)
   * @param groupSymmetricKey - AES-256 group key as base64 string
   * @returns EncryptedKeyPayload ready for transport
   */
  encryptForMember(
    memberPublicKey: Uint8Array,
    groupSymmetricKey: string,
  ): EncryptedKeyPayload {
    const ephemeralKeyPair = this.generateGroupKeyPair();
    const nonce = this.generateNonce();

    const keyBytes = new TextEncoder().encode(groupSymmetricKey);

    const encrypted = nacl.box(
      keyBytes,
      nonce,
      memberPublicKey,
      ephemeralKeyPair.secretKey,
    );

    if (!encrypted) {
      throw new Error('[GroupKeyExchange] Encryption failed — invalid public key');
    }

    return {
      ephemeralPublicKey: uint8ArrayToBase64(ephemeralKeyPair.publicKey),
      nonce: uint8ArrayToBase64(nonce),
      ciphertext: uint8ArrayToBase64(encrypted),
    };
  }

  /**
   * Decrypt a group symmetric key that was encrypted for us.
   *
   * @param ephemeralPrivateKey - Our X25519 private key (raw bytes)
   * @param senderPublicKey - The ephemeral public key from the EncryptedKeyPayload (raw bytes)
   * @param encryptedKey - The full encrypted payload received from the sender
   * @returns The decrypted AES-256 group key as base64 string
   */
  decryptGroupKey(
    ephemeralPrivateKey: Uint8Array,
    senderPublicKey: Uint8Array,
    encryptedKey: EncryptedKeyPayload,
  ): string {
    const nonce = base64ToUint8Array(encryptedKey.nonce);
    const ciphertext = base64ToUint8Array(encryptedKey.ciphertext);

    const decrypted = nacl.box.open(
      ciphertext,
      nonce,
      senderPublicKey,
      ephemeralPrivateKey,
    );

    if (!decrypted) {
      throw new Error('[GroupKeyExchange] Decryption failed — wrong key or corrupted payload');
    }

    return new TextDecoder().decode(decrypted);
  }

  // ── Key rotation ────────────────────────────────────────────────────

  /**
   * Rotate group keys: generate a fresh symmetric key and a new ephemeral keypair.
   *
   * @param _oldKey - Previous symmetric key (base64) — kept for future backward-compatability
   * @returns New symmetric key + fresh ephemeral keypair
   */
  rotateKeys(): { newSymmetricKey: string; newEphemeralKeyPair: KeyPair } {
    const newSymmetricKey = this.generateSymmetricKey();
    const newEphemeralKeyPair = this.generateGroupKeyPair();

    logger.log('[GroupKeyExchange] Keys rotated');
    return { newSymmetricKey, newEphemeralKeyPair };
  }

  // ── Batch encryption for all members ────────────────────────────────

  /**
   * Encrypt the group symmetric key for every member individually.
   *
   * @param memberPublicKeys - Map of member identifier → their X25519 public key
   * @param groupSymmetricKey - The shared AES-256 group key (base64)
   * @returns Map of member identifier → their unique EncryptedKeyPayload
   */
  encryptForAllMembers(
    memberPublicKeys: Map<string, Uint8Array>,
    groupSymmetricKey: string,
  ): Map<string, EncryptedKeyPayload> {
    const result = new Map<string, EncryptedKeyPayload>();

    for (const [memberId, publicKey] of memberPublicKeys) {
      result.set(memberId, this.encryptForMember(publicKey, groupSymmetricKey));
    }

    logger.log(`[GroupKeyExchange] Encrypted group key for ${result.size} members`);
    return result;
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /**
   * Generate a cryptographically random 24-byte nonce for nacl.box.
   */
  private generateNonce(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(nacl.box.nonceLength));
  }
}

export const groupKeyExchangeService = new GroupKeyExchangeService();
