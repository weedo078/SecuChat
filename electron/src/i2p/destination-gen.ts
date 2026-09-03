import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { toBase32 } from '../utils/base32';
import { loadLibsodium, ed25519SkToCurve25519 } from './libsodium';

/**
 * I2P Destination mit 2 separaten Ed25519-Keypairs (encryption + signing).
 *
 * Layout des 128-Byte privKey-Blobs (siehe Spec Section 4.3 + Spec H.1):
 *   [0..32]    X25519 encPriv (Spec H.1 — via libsodium
 *              ed25519SkToCurve25519 vom Ed25519 signPriv abgeleitet)
 *   [32..64]   encryption public key (Ed25519)
 *   [64..96]   signing private key (Ed25519 seed) — separate, NICHT abgeleitet
 *   [96..128]  signing public key (Ed25519)
 *
 * EdDSA-Ed25519 ist single-key (signing === encryption), aber I2P IdentityEx
 * verlangt zwei separate Keys als Java-Compat-Layer. Wir erzeugen daher zwei
 * unabhängige Ed25519-Keypairs.
 *
 * Spec H.1: privKey [0..32] wurde mit X25519 encPriv befüllt (LeaseSet-
 * Encryption via ECDH-X25519). IdentityEx.fromPrivKey() detektiert
 * all-zero [0..32] als 'Legacy ohne X25519 encPriv' und behandelt
 * x25519PrivateKey als undefined — siehe i2cp-identity.ts.
 *
 * b32Address = base32(SHA-256(65-byte minimal identity)) + ".b32.i2p".
 * Die 65-byte minimal identity für b32-Hashing nutzt encPub zweimal
 * (encryptionPub || signingPub || 0x00) — das ist die I2P-Spec-Variante für
 * die b32-Adressableitung bei Legacy-Ed25519-Peers.
 */
export interface Destination {
  privKey: Uint8Array;          // 128 Bytes
  publicKey: Uint8Array;        // 32 Bytes (encryption)
  signingPublicKey: Uint8Array; // 32 Bytes (signing)
  b32Address: string;           // 52 chars + ".b32.i2p"
}

/**
 * Generate a fresh 2-key Ed25519 I2P destination. The resulting 128-byte
 * `privKey` blob is compatible with `IdentityEx.fromPrivKey()` and is the
 * canonical on-disk format for the I2CP wire protocol (CreateSession /
 * CreateLeaseSet2 use the encryption+signing private seeds to sign the
 * spec-compliant SessionConfig and LeaseSet2 records).
 *
 * Spec H.1: privKey [0..32] enthält den X25519 encPriv (via libsodium-
 * Mapping vom Ed25519 signPriv). Dadurch kann I2CP LeaseSet2 mit ECIES-
 * X25519 publizieren ohne separaten X25519 Keypair-Storage.
 */
export async function generateEd25519Destination(): Promise<Destination> {
  // Generate two independent Ed25519 keypairs — encryption and signing
  // must NOT be derived from each other per I2P IdentityEx spec.
  const encPriv = ed.utils.randomPrivateKey();
  const encPub = await ed.getPublicKeyAsync(encPriv);
  const signPriv = ed.utils.randomPrivateKey();
  const signPub = await ed.getPublicKeyAsync(signPriv);

  // Spec H.1: [0..32] = X25519 encPriv, abgeleitet vom Ed25519 signPriv
  // via libsodium ed25519SkToCurve25519 (ZIP-215 cofactored). Der erste
  // Aufruf resolved den Singleton-Promise (~50ms Native-Init); Folgeaufrufe
  // sind sync-Hit. ed25519SkToCurve25519 ist dann sync-ready.
  await loadLibsodium();
  const x25519EncPriv = ed25519SkToCurve25519(signPriv);

  const privKey = new Uint8Array(128);
  privKey.set(x25519EncPriv, 0); // Spec H.1: war vorher encPriv-Seed
  privKey.set(encPub, 32);
  privKey.set(signPriv, 64);
  privKey.set(signPub, 96);

  // Compute b32 from the IdentityEx that would be transmitted on the wire.
  // 65-byte minimal identity for b32 hashing: encPub(32) || encPub(32) || 0x00.
  // The duplication is intentional per I2P b32 spec — keeps b32 stable for
  // peers that only know encryption key material.
  const reconstructed = new Uint8Array(65);
  reconstructed.set(encPub, 0);
  reconstructed.set(encPub, 32);
  reconstructed[64] = 0x00;
  const digest = sha256(reconstructed);
  const b32Address = `${toBase32(digest)}.b32.i2p`;

  return { privKey, publicKey: encPub, signingPublicKey: signPub, b32Address };
}

/**
 * Compute the b32Address from a 128-byte privKey blob. The blob layout
 * matches `generateEd25519Destination()` output and `IdentityEx.fromPrivKey()`
 * input (Task 2 spec).
 *
 * Algorithm: extract encryption public key at bytes 32..63, rebuild the
 * 65-byte minimal-identity blob (encPub || encPub || 0x00), SHA-256 it,
 * base32-encode (lowercase), append ".b32.i2p".
 *
 * Throws if `privKey` is not exactly 128 bytes.
 */
export async function computeB32FromPrivKey(privKey: Uint8Array): Promise<string> {
  if (privKey.length !== 128) {
    throw new Error(`computeB32FromPrivKey: expected 128 bytes, got ${privKey.length}`);
  }
  const pubKey = privKey.subarray(32, 64);
  const reconstructed = new Uint8Array(65);
  reconstructed.set(pubKey, 0);
  reconstructed.set(pubKey, 32);
  reconstructed[64] = 0x00;
  const digest = sha256(reconstructed);
  return `${toBase32(digest)}.b32.i2p`;
}