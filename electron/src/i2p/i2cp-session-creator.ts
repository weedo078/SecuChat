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
  privateKeys: Array<{ encryptionType: number; privateKey: Uint8Array }>;
  storeType: 1 | 3 | 5 | 7;      // 3 = LeaseSet2
  dateMs: number;
}

/**
 * Build a spec-compliant CreateSessionMessage (I2CP type 1).
 *
 * Per I2CP-Spec + i2pd's I2CPSession::CreateSessionMessageHandler (I2CP.cpp:327):
 *   [4-byte length BE][1-byte type=CREATE_SESSION]
 *   [inline Destination als IdentityEx (387 bytes)]
 *   [2-byte mapping-size BE]
 *   [sorted protobuf Mapping]
 *   [8-byte Date BE]
 *   [64-byte Ed25519 Signature über Destination||Mapping||Date]
 *
 * No sessionId in the I2CP header — CreateSession is a connection-level message
 * (router assigns sessionId in its SessionStatus reply).
 */
export function encodeCreateSession(opts: CreateSessionOpts): Buffer {
  const identityBytes = opts.identity.toByteArray();
  const mappingBytes = encodeMapping(opts.properties);
  const dateBytes = Buffer.alloc(8);
  dateBytes.writeBigUInt64BE(BigInt(opts.dateMs), 0);

  // Signature input: identity || mapping || date
  const signedData = Buffer.concat([identityBytes, mappingBytes, dateBytes]);
  const signature = opts.identity.sign(signedData);

  // Inner payload (no 2-byte sessionId, since CreateSession is connection-level):
  const innerPayload = Buffer.concat([
    identityBytes,                                    // 387 bytes
    Buffer.from([(mappingBytes.length >> 8) & 0xff, mappingBytes.length & 0xff]),
    mappingBytes,                                     // N bytes
    dateBytes,                                        // 8 bytes
    signature,                                        // 64 bytes
  ]);

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
 *       [numk — 1 byte count of encryption keys]
 *       [for each key: encType(2 BE) + keyLen(2 BE) + encryptionKey(keyLen)]
 *       [num — 1 byte count of Lease2s, 0-16]
 *       [for each lease: tunnel_gw(32) + tunnel_id(4 BE) + end_date(4 BE seconds)]
 *       [signature — 64-byte Ed25519 über (0x03 || alles-vor-signature)]
 *     [1-byte #privateKeys]
 *     [for each privateKey: encType(2 BE) + keyLen(2 BE) + privateKey(keyLen)]
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

  // encryption public keys (numk + per-key encType/keyLen/key)
  ls2Parts.push(Buffer.from([opts.privateKeys.length & 0xff]));
  for (const k of opts.privateKeys) {
    const encTypeBuf = Buffer.alloc(2);
    encTypeBuf.writeUInt16BE(k.encryptionType & 0xffff, 0);
    ls2Parts.push(encTypeBuf);
    const keyLenBuf = Buffer.alloc(2);
    keyLenBuf.writeUInt16BE(k.privateKey.length & 0xffff, 0);
    ls2Parts.push(keyLenBuf);
    ls2Parts.push(Buffer.from(k.privateKey));
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

  // --- Outer payload: [storeType][LS2+sig][#privateKeys][per-key encType+keyLen+key] ---
  const outerParts: Buffer[] = [];
  outerParts.push(Buffer.from([opts.storeType]));                           // 1-byte storeType
  outerParts.push(ls2Bytes);                                                 // opaque LS2 blob
  outerParts.push(Buffer.from(signature));                                   // 64 bytes signature (Uint8Array → Buffer)
  outerParts.push(Buffer.from([opts.privateKeys.length & 0xff]));            // 1-byte #privateKeys
  for (const k of opts.privateKeys) {
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
