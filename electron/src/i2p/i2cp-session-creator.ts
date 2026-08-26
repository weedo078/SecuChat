import * as ed from '@noble/ed25519';
import { I2CP_MSG, encodeMessage } from './i2cp-protocol';
import { IdentityEx } from './i2cp-identity';
import { encodeMapping } from './i2cp-protobuf';

/**
 * Lease2 (40 bytes) per common-structures §LeaseSet2.
 *
 * Order: [tunnel_gw 32B SHA-256 of tunnel gateway RouterIdentity]
 *        [tunnel_id 4B BE uint]
 *        [end_date 4B BE uint — seconds since epoch]
 */
export interface Lease2 {
  tunnelGw: Uint8Array;     // 32 bytes
  tunnelId: number;         // 4-byte BE uint
  endDateSeconds: number;   // 4-byte BE uint, seconds since epoch
}

export interface CreateSessionOpts {
  identity: IdentityEx;
  properties: Map<string, string>;
  dateMs: number;
}

export interface CreateLeaseSet2Opts {
  identity: IdentityEx;
  sessionId: number;
  leases: Lease2[];
  publishedSeconds: number;      // 4-byte BE Date (seconds since epoch)
  expiresSeconds: number;        // 2-byte BE offset (max 18.2h = 65535s)
  options?: Map<string, string>; // defaults to empty Map
  signingKey: Uint8Array;        // 32-byte Ed25519 signing private seed
  /** PUBLIC encryption keys — published inside the signed LS2 body so that
   *  remote clients can encrypt to us. At least one key is required. */
  publicKeys: Array<{ encryptionType: number; publicKey: Uint8Array }>;
  /** PRIVATE encryption keys — appended AFTER the LS2 signature, only for a
   *  server-side decryptor. Empty for an outbound-only client like SecuChat. */
  privateKeys?: Array<{ encryptionType: number; privateKey: Uint8Array }>;
  storeType: 1 | 3 | 5 | 7;      // 3 = LeaseSet2
  dateMs: number;
}

// ---------------------------------------------------------------------------
// Java-I2P-compatible LEGACY Destination wire format
// ---------------------------------------------------------------------------
//
// Java-I2P's CreateSessionMessage.doReadMessage ONLY accepts the legacy
// SessionConfig layout (verified by `javap -c CreateSessionMessage.class` in
// i2p 2.7.0+: there is NO fall-back to IdentityEx). The legacy shape is:
//
//   [Destination.create(stream)]        — see below
//   [DataHelper.readProperties(stream)] — see below
//   [DataHelper.readDate(stream)]       — 8-byte BE ms since epoch
//   [Signature.readBytes(stream)]       — type from
//                                         Destination.getSigningPublicKey().getType()
//
// Legacy Destination — byte-exact per `javap -c net.i2p.data.Destination`
// against i2p 2.7.0:
//
//   [PublicKey         — 256 bytes]   ElGamal-2048 dummy (Java does NOT actually
//   |                                  use this slot for sessions whose KeyCert
//   |                                  mandates Ed25519 — the wire slot is just
//   |                                  a positional placeholder; PublicKey.
//   |                                  writeBytes hard-codes 256 B even when the
//   |                                  key has been re-typed to a shorter type)
//   [Padding           —  96 bytes]   Zero bytes. For an Ed25519-typed signing
//   |                                  pub (`typedLen=32 < KEYSIZE_BYTES=128`),
//   |                                  `SigningPublicKey.getPadding(cert)`
//   |                                  returns `new byte[96]` filled by
//   |                                  `System.arraycopy(_data, 0, …, 0, 96)`
//   |                                  (i.e. the FIRST 96 B of the original
//   |                                  128-B slot, which are always zero).
//   |                                  `combinePadding(null, that)` sets the
//   |                                  Destination's _padding, and
//   |                                  `Destination.writeBytes` writes those
//   |                                  96 bytes BEFORE the signing key.
//   [SigningPublicKey  —  32 bytes]   The Ed25519 signPub (typed form).
//   |                                  Destination.writeBytes copies
//   |                                  `Math.min(KEYSIZE_BYTES, length()) =
//   |                                  min(128, 32) = 32` bytes from
//   |                                  `_signingKey._data` (which is the LAST
//   |                                  32 B of the original slot after
//   |                                  `toTypedKey` re-sliced `_data` via
//   |                                  `System.arraycopy(_data,
//   |                                  KEYSIZE_BYTES-typedLen, …, 0,
//   |                                  typedLen)`).
//   [Certificate       —   7 bytes]   type=5 (KeyCertificate)
//                                    extraLen=4
//                                    extraBytes=[0x00, 0x07, 0x00, 0x00]
//                                              ⇡     ⇡     ⇡
//                                              (high)(Ed25519 SigType.code=7) padding
//                                              byte  byte
//                                              of SigType
//                                              code
//
//   Total legacy Destination = 256 + 96 + 32 + 7 = 391 bytes.
//
// *** IMPORTANT — same 391-byte form is used for SIGNING and WIRE ***
//
//   The Java verifier calls `SessionConfig.getBytes()` which calls
//   `Destination.writeBytes(out)` — that writes the SAME 391-byte form as we
//   send on the wire. There is NO shorter "signable" form: after parsing the
//   wire bytes, `Destination.create` re-types the keys (PublicKey stays
//   256 B because cert.getEncType() == _type, but SigningPublicKey shrinks to
//   32 B), and `SigningPublicKey.getPadding(cert)` captures the 96 zero bytes
//   that the wire sent BEFORE the typed signing key. `combinePadding` puts
//   those 96 bytes into Destination._padding, which `writePaddingBytes`
//   re-emits between the PublicKey and the typed signing key. So:
//
//       on-wire destination  = 256B pub + 96B pad + 32B sign + 7B cert = 391B
//       signed  destination  = 256B pub + 96B pad + 32B sign + 7B cert = 391B
//
//   Both forms are byte-exact identical for typed-Ed25519 destinations with
//   the legacy KeyCertificate (Ed25519_PAYLOAD = [0x00, 0x07, 0x00, 0x00]).
//   Earlier attempts to sign a 295-byte "signable" form failed because
//   Java's verifier signed the 391-byte form, not the 295-byte form.
//
// DataHelper.readProperties (from i2p 2.7.0 javap):
//   Read 2-byte size BE (= total bytes of payload below).
//   Then loop on payload bytes:
//     key   = readString()  → 1-byte length + N bytes UTF-8
//     0x3D  '=' literal
//     value = readString()  → 1-byte length + N bytes UTF-8
//     0x3B  ';' literal
//
//   Verbatim from DataHelper.writeProperties (i2p 2.7.0):
//   out.write(writeString(key))    — 1B len + key UTF-8
//   out.write(0x3D)               — '='
//   out.write(writeString(value))  — 1B len + value UTF-8
//   out.write(0x3B)               — ';'
//   then 2-byte size BE of accumulated payload at the start of the block.
//
// The Ed25519 signature (read last by SessionConfig.readBytes) is taken over
// `Destination (391B) || Properties || Date (8B)` — the byte order matches
// the `Signature.update()` calls in SessionConfig.readBytes. writeBytes is
// the inverse.
//
// References:
//   - i2p://net/i2p/data/i2cp/SessionConfig.java (legacy: Destination first)
//   - i2p://net/i2p/data/KeyCertificate.java   (Ed25519_PAYLOAD)
//   - i2p://net/i2p/data/Destination.java      (writeBytes semantics)
//   - i2p://net/i2p/data/SigningPublicKey.java (toTypedKey + getPadding)
//   - i2p://net/i2p/data/PublicKey.java        (toTypedKey + getPadding)
//   - i2p://net/i2p/data/DataHelper.java       (readProperties / writeDate)
//   - i2p://net/i2p/crypto/SigType.java        (EdDSA_SHA512_Ed25519.code = 7)
// ---------------------------------------------------------------------------

/** Default PublicKey size (ElGamal-2048, Java's legacy default). */
export const LEGACY_PUBLIC_KEY_BYTES = 256;

/**
 * Default SigningPublicKey slot size when reading a legacy Destination —
 * Java-I2P 2.7.0 uses `SigType.DSA_SHA1.getPubkeyLen() = 128` as the default
 * buffer size for `SigningPublicKey.create(InputStream)`. The actual Ed25519
 * signing pub occupies the LAST 32 bytes; the FIRST 96 bytes are zero
 * padding. The KeyCert then instructs `toTypedKey(cert)` to re-type the
 * signing key as Ed25519, which re-slices `_data` to the LAST 32 bytes via
 * `System.arraycopy(_data, KEYSIZE_BYTES - typedLen, newData, 0, typedLen)`.
 *
 * Verified via `javap -c SigningPublicKey.class` (DSA_SHA1 is DEF_TYPE in
 * `<clinit>`, KEYSIZE_BYTES = getPubkeyLen() = 128).
 */
export const LEGACY_SIGNING_PUBLIC_KEY_BYTES = 128;

/**
 * Padding bytes emitted by `Destination.writeBytes` between the 256-B
 * PublicKey slot and the 32-B typed signing key, when the signing key has
 * been re-typed from the default DSA_SHA1 (128 B) down to a shorter type
 * like Ed25519 (32 B). Equals `KEYSIZE_BYTES - typedLen` for the signing key.
 *
 * Java computes this from `SigningPublicKey.getPadding(cert)` which returns
 * `new byte[96]` filled by `System.arraycopy(_data, 0, dst, 0, 96)` — i.e.
 * the FIRST 96 bytes of the original 128-B signing slot (which are always
 * zero because the Ed25519 signPub lives in the LAST 32 bytes).
 */
export const LEGACY_SIGNING_PADDING_BYTES = 96;

/** Type 5 = KeyCertificate (per I2P). */
export const CERT_TYPE_KEY_CERTIFICATE = 5;

/** SigType.code for EdDSA_SHA512_Ed25519 (verified from i2p 2.7.0 bytecode). */
export const SIG_TYPE_EDDSA_SHA512_ED25519 = 7;

/**
 * Build the KeyCertificate body for an Ed25519-only legacy Destination.
 *
 * Format per i2p KeyCertificate constructor + Ed25519_PAYLOAD constant
 * (verified from i2p 2.7.0 javap):
 *   [1B type=5][2B extraLen=4 BE][4B Ed25519_PAYLOAD: 0x00, 0x07, 0x00, 0x00]
 *   = 7 bytes total
 *
 * Ed25519_PAYLOAD layout (from SigType.class + KeyCertificate.class bytecode):
 *   payload[0] = 0x00   padding before SigType.code
 *   payload[1] = 0x07   SigType.EdDSA_SHA512_Ed25519.code (verified from
 *                        SigType.<clinit> static initializer in i2p 2.7.0)
 *   payload[2] = 0x00   padding after SigType.code
 *   payload[3] = 0x00   padding
 */
export function makeEd25519KeyCertificate(): Buffer {
  const buf = Buffer.alloc(7);
  buf[0] = CERT_TYPE_KEY_CERTIFICATE;          // 1B type = 5
  buf.writeUInt16BE(4, 1);                     // 2B extraLen = 4 at offsets 1..2 (BE: 0x00 0x04)
  buf[3] = 0x00;                               // Ed25519_PAYLOAD[0] — padding
  buf[4] = SIG_TYPE_EDDSA_SHA512_ED25519;      // Ed25519_PAYLOAD[1] — SigType.code (Ed25519 = 7)
  buf[5] = 0x00;                               // Ed25519_PAYLOAD[2] — padding
  buf[6] = 0x00;                               // Ed25519_PAYLOAD[3] — padding
  return buf;
}

/**
 * Serialize a legacy Java-I2P-compatible Destination.
 *
 * *** This 391-byte form is used for BOTH the wire AND the signature. ***
 *
 * Verified by `javap -c Destination.class` (i2p 2.7.0): `Destination.writeBytes`
 * emits the same byte sequence whether the destination is being written to
 * the wire or to `SessionConfig.getBytes()` (the signature input).
 *
 * Layout (verified by `javap -c Destination.class`, PublicKey.class,
 * SigningPublicKey.class, KeyCertificate.class in i2p 2.7.0):
 *   [PublicKey         — 256 B]   dummy ElGamal — PublicKey.writeBytes writes
 *   |                              `_data.length` bytes, which is 256 for our
 *   |                              256-B dummy. For a typed PublicKey
 *   |                              (_type == cert.encType), `getPadding` returns
 *   |                              null → 0 padding bytes.
 *   [SigningPublicKey  — 128 B]   The DEFAULT read size is `KEYSIZE_BYTES = 128`
 *   |                              (DSA_SHA1 default). On `toTypedKey(KeyCert)`,
 *   |                              `SigningPublicKey` re-slices `_data` to the
 *   |                              LAST `typedLen` bytes — i.e. for typedLen=32
 *   |                              it slices `_data[96..127]` (the LAST 32 bytes
 *   |                              of the 128-B slot). Verified by
 *   |                              `javap -c SigningPublicKey.class`:
 *   |                                typedLen < KEYSIZE_BYTES branch:
 *   |                                  System.arraycopy(_data, KEYSIZE_BYTES
 *   |                                                       - typedLen,
 *   |                                                   newData, 0, typedLen)
 *   |                              So the Ed25519 signPub MUST occupy the
 *   |                              LAST 32 bytes of the 128-B slot, and the
 *   |                              first 96 bytes must be zero padding (this
 *   |                              is what `SigningPublicKey.getPadding(cert)`
 *   |                              captures and `writePaddingBytes` re-emits).
 *
 *   Total legacy Destination = 256 + 128 + 7 = 391 bytes.
 *   (Specifically: 256 pub + 96 zero padding + 32 typed sign + 7 cert.)
 */
export function encodeLegacyDestination(opts: {
  signingPublicKeyEd25519: Uint8Array; // 32 bytes
  dummyPublicKey?: Buffer;            // optional, defaults to 256 zero bytes
}): Buffer {
  if (opts.signingPublicKeyEd25519.length !== 32) {
    throw new Error(
      `legacy destination signingPublicKeyEd25519 must be 32 bytes, got ${opts.signingPublicKeyEd25519.length}`,
    );
  }
  const dummyPub = opts.dummyPublicKey ?? Buffer.alloc(LEGACY_PUBLIC_KEY_BYTES, 0);
  if (dummyPub.length !== LEGACY_PUBLIC_KEY_BYTES) {
    throw new Error(
      `legacy destination dummy PublicKey must be ${LEGACY_PUBLIC_KEY_BYTES} bytes, got ${dummyPub.length}`,
    );
  }
  // The Ed25519 signPub must go at the END of the 128-B SigningPublicKey
  // slot — `toTypedKey` slices `_data[96..127]` for a typedLen=32 key, and
  // `getPadding(cert)` re-emits the FIRST 96 bytes (zeros) of the slot
  // BEFORE the typed signing pub.
  const signingPubSlot = Buffer.alloc(LEGACY_SIGNING_PUBLIC_KEY_BYTES, 0);
  Buffer.from(opts.signingPublicKeyEd25519).copy(signingPubSlot, LEGACY_SIGNING_PUBLIC_KEY_BYTES - 32);
  const cert = makeEd25519KeyCertificate();
  return Buffer.concat([dummyPub, signingPubSlot, cert]);
}

/** Total length of `encodeLegacyDestination()` output (256 + 128 + 7). */
export const LEGACY_DESTINATION_BYTES =
  LEGACY_PUBLIC_KEY_BYTES + LEGACY_SIGNING_PUBLIC_KEY_BYTES + 7; // 391

/**
 * Encode a name=value property in DataHelper.readProperties format.
 * The 2-byte BE size header is computed externally; this writes ONE entry:
 *   [1B keyLen][key UTF-8][=][1B valLen][val UTF-8][;]
 */
function writeDataHelperEntry(out: Buffer[], key: string, value: string): void {
  const keyBytes = Buffer.from(key, 'utf-8');
  const valBytes = Buffer.from(value, 'utf-8');
  if (keyBytes.length > 255) throw new Error(`DataHelper property key too long: ${key.length}`);
  if (valBytes.length > 255) throw new Error(`DataHelper property value too long: ${value.length}`);
  out.push(Buffer.from([keyBytes.length]));
  out.push(keyBytes);
  out.push(Buffer.from([0x3D])); // '='
  out.push(Buffer.from([valBytes.length]));
  out.push(valBytes);
  out.push(Buffer.from([0x3B])); // ';'
}

/**
 * Encode a Properties Map in the DataHelper.readProperties wire format:
 *   [2B total-payload-size BE][repeated: writeDataHelperEntry(k, v)]
 *
 * Sort keys lex by UTF-8 byte order BEFORE writing (matches Java's
 * OrderedProperties / Properties.stringPropertyNames iteration order;
 * the 65535-byte size cap also requires a stable order for tests).
 */
export function encodeDataHelperProperties(props: Map<string, string>): Buffer {
  const sortedKeys = [...props.keys()].sort();
  const entries: Buffer[] = [];
  for (const k of sortedKeys) {
    writeDataHelperEntry(entries, k, props.get(k)!);
  }
  const payload = Buffer.concat(entries);
  const header = Buffer.alloc(2);
  header.writeUInt16BE(payload.length, 0);
  if (payload.length > 0xffff) {
    throw new Error(`DataHelper properties too large: ${payload.length} > 65535 bytes`);
  }
  return Buffer.concat([header, payload]);
}

/**
 * Build a Java-I2P-compatible CreateSessionMessage (I2CP type 1).
 *
 * Wires the LEGACY SessionConfig layout (not the IdentityEx + protobuf Mapping
 * that i2pd accepts). Java-I2P's CreateSessionMessage.doReadMessage rejects
 * IdentityEx — we verified this with `javap -c` against i2p 2.7.0.
 *
 * Layout (I2CP framing per Java's I2CPMessageImpl.writeMessage — the 4-byte
 * length prefix counts only the body, NOT the 1-byte type):
 *
 *   [4-byte length BE][1-byte type=1]
 *   [SessionConfig.readBytes writes:
 *      Destination (legacy) : 391 bytes  (256 pub + 128 sign-slot + 7 cert;
 *                                       slot = 96 zero-pad + 32 typed sign)
 *      Properties            : 2-byte size + entries (sorted lex)
 *      Date                  : 8-byte BE ms since epoch
 *      Signature (Ed25519)   : 64 bytes over (Destination || Properties || Date)
 *   ]
 *
 * *** The signature is computed over the SAME 391-byte destination form that
 * goes on the wire. *** `SessionConfig.getBytes()` (used by the Java verifier)
 * calls `Destination.writeBytes(out)` which emits 256 B pub + 96 B pad +
 * 32 B sign + 7 B cert. There is no separate, shorter "signable" form —
 * earlier attempts to sign over a 295-byte form (without the 96-B padding)
 * were rejected because Java's verifier signs the 391-byte form. See the
 * module-level header for the full byte-by-byte reasoning.
 */
export function encodeCreateSession(opts: CreateSessionOpts): Buffer {
  const destination = encodeLegacyDestination({
    signingPublicKeyEd25519: opts.identity.signingPublicKey,
  });
  const propertiesBytes = encodeDataHelperProperties(opts.properties);
  const dateBytes = Buffer.alloc(8);
  dateBytes.writeBigUInt64BE(BigInt(opts.dateMs), 0);

  // Sign over the SAME 391-byte form that gets sent on the wire.
  // (See module-level header for the Java-side verification logic.)
  const signedData = Buffer.concat([destination, propertiesBytes, dateBytes]);
  const signature = opts.identity.sign(signedData);

  const innerPayload = Buffer.concat([destination, propertiesBytes, dateBytes, signature]);
  return encodeMessage({
    type: I2CP_MSG.CREATE_SESSION,
    sessionId: null,
    payload: innerPayload,
  });
}

/**
 * Build a spec-compliant CreateLeaseSetMessage2 (I2CP type 41).
 *
 * Per I2CP-Overview §3.3 + common-structures §LeaseSet2:
 *   Outer I2CP envelope:
 *     [4-byte length BE]
 *     [1-byte type=41 (CREATE_LEASE_SET_2)]
 *     [2-byte sessionId BE]
 *   Payload:
 *     [1-byte storeType (1=LeaseSet, 3=LeaseSet2, 5=EncryptedLS, 7=MetaLS)]
 *     [Opaque LeaseSet2 blob:]
 *       [ls2_header:]
 *         [destination — 387-byte IdentityEx]
 *         [published — 4-byte BE seconds since epoch]
 *         [expires — 2-byte BE offset from published, max 18.2h]
 *         [flags — 2-byte (bit 0 = offline_signature present)]
 *       [options — 2-byte mapping-size + protobuf mapping]
 *       [numk — 1 byte count of public encryption keys (clients encrypt to us)]
 *       [for each key: encType(2 BE) + keyLen(2 BE) + publicKey(keyLen)]
 *       [num — 1 byte count of Lease2s, 0-16]
 *       [for each lease: tunnel_gw(32) + tunnel_id(4 BE) + end_date(4 BE seconds)]
 *       [signature — 64-byte Ed25519 über (0x03 || alles-vor-signature)]
 *     [1-byte #privateKeys]
 *     [for each privateKey: encType(2 BE) + keyLen(2 BE) + privateKey(keyLen)]
 *
 * NOTE: publicKeys and privateKeys are SEPARATE fields. The LS2 body
 * carries PUBLIC keys (so clients can encrypt to us); the post-signature
 * privateKeys block carries PRIVATE keys (so the router can decrypt
 * inbound). For an outbound-only client like SecuChat, privateKeys is [].
 */
export function encodeCreateLeaseSet2(opts: CreateLeaseSet2Opts): Buffer {
  // --- Validate lease inputs ---
  if (opts.leases.length > 16) {
    throw new Error('LeaseSet2 supports at most 16 leases');
  }
  for (const lease of opts.leases) {
    if (lease.tunnelGw.length !== 32) {
      throw new Error(`Lease2.tunnelGw must be 32 bytes, got ${lease.tunnelGw.length}`);
    }
  }
  // Spec requires at least one public encryption key per LeaseSet2; without
  // it Java-I2P rejects with "Error reading the CreateLeaseSetMessage"
  // because the LeaseSet cannot be used to encrypt to us.
  if (opts.publicKeys.length === 0) {
    throw new Error('encodeCreateLeaseSet2: at least one public encryption key is required');
  }

  const identityBytes = opts.identity.toByteArray();
  const optionsMap = opts.options ?? new Map<string, string>();
  const optionsBytes = encodeMapping(optionsMap);

  // --- Build opaque LeaseSet2 body (without signature) ---
  const ls2Parts: Buffer[] = [];

  // ls2_header
  ls2Parts.push(identityBytes);                                             // 387 bytes
  const publishedBuf = Buffer.alloc(4);
  publishedBuf.writeUInt32BE(opts.publishedSeconds >>> 0, 0);
  ls2Parts.push(publishedBuf);                                              // 4 bytes
  const expiresBuf = Buffer.alloc(2);
  expiresBuf.writeUInt16BE(opts.expiresSeconds & 0xffff, 0);
  ls2Parts.push(expiresBuf);                                                // 2 bytes
  const flagsBuf = Buffer.alloc(2);
  flagsBuf.writeUInt16BE(0, 0);             // no offline_signature, no unconditional
  ls2Parts.push(flagsBuf);                                                  // 2 bytes

  // options mapping (2-byte size + protobuf mapping)
  const optionsSizeBuf = Buffer.alloc(2);
  optionsSizeBuf.writeUInt16BE(optionsBytes.length & 0xffff, 0);
  ls2Parts.push(optionsSizeBuf);
  ls2Parts.push(optionsBytes);

  // SIGNED: PUBLIC encryption keys (numk + per-key encType/keyLen/publicKey)
  ls2Parts.push(Buffer.from([opts.publicKeys.length & 0xff]));
  for (const k of opts.publicKeys) {
    const encTypeBuf = Buffer.alloc(2);
    encTypeBuf.writeUInt16BE(k.encryptionType & 0xffff, 0);
    ls2Parts.push(encTypeBuf);
    const keyLenBuf = Buffer.alloc(2);
    keyLenBuf.writeUInt16BE(k.publicKey.length & 0xffff, 0);
    ls2Parts.push(keyLenBuf);
    ls2Parts.push(Buffer.from(k.publicKey));
  }

  // leases (num + per-lease 40 bytes)
  ls2Parts.push(Buffer.from([opts.leases.length & 0xff]));
  for (const lease of opts.leases) {
    ls2Parts.push(Buffer.from(lease.tunnelGw));                              // 32 bytes
    const tunnelIdBuf = Buffer.alloc(4);
    tunnelIdBuf.writeUInt32BE(lease.tunnelId >>> 0, 0);
    ls2Parts.push(tunnelIdBuf);                                             // 4 bytes
    const endDateBuf = Buffer.alloc(4);
    endDateBuf.writeUInt32BE(lease.endDateSeconds >>> 0, 0);
    ls2Parts.push(endDateBuf);                                              // 4 bytes
  }

  const ls2Bytes = Buffer.concat(ls2Parts);

  // Sign over (0x03 || LS2) per spec — 0x03 is the DatabaseStore type byte
  const signedData = Buffer.concat([Buffer.from([0x03]), ls2Bytes]);
  const signature = ed.sign(signedData, opts.signingKey);
  if (signature.length !== 64) {
    throw new Error(`Ed25519 signature must be 64 bytes, got ${signature.length}`);
  }

  // --- Outer payload: [storeType][LS2+sig][#privateKeys][per-key encType+keyLen+privateKey] ---
  // Private keys are NOT part of the signed LS2 body — they go into the
  // outer-payload post-signature block, only delivered to a server-side
  // decryptor. For SecuChat (outbound-only client) we send privateKeys=[].
  const privateKeys = opts.privateKeys ?? [];
  const outerParts: Buffer[] = [];
  outerParts.push(Buffer.from([opts.storeType]));                           // 1-byte storeType
  outerParts.push(ls2Bytes);                                                 // opaque LS2 blob
  outerParts.push(Buffer.from(signature));                                   // 64 bytes signature (Uint8Array → Buffer)
  outerParts.push(Buffer.from([privateKeys.length & 0xff]));                 // 1-byte #privateKeys
  for (const k of privateKeys) {
    const encTypeBuf = Buffer.alloc(2);
    encTypeBuf.writeUInt16BE(k.encryptionType & 0xffff, 0);
    outerParts.push(encTypeBuf);
    const keyLenBuf = Buffer.alloc(2);
    keyLenBuf.writeUInt16BE(k.privateKey.length & 0xffff, 0);
    outerParts.push(keyLenBuf);
    outerParts.push(Buffer.from(k.privateKey));
  }

  const innerPayload = Buffer.concat(outerParts);

  return encodeMessage({
    type: I2CP_MSG.CREATE_LEASE_SET_2,
    sessionId: opts.sessionId,
    payload: innerPayload,
  });
}
