import { I2CP_MSG, encodeMessage } from './i2cp-protocol';
import { IdentityEx } from './i2cp-identity';
import { encodeMapping } from './i2cp-protobuf';

export interface Lease {
  routerHash: Uint8Array; // 32 bytes SHA-256 of router identity
  tunnelGw: Uint8Array;   // 32 bytes tunnel gateway router hash
  expires: number;        // ms (Spec §4.2 field name)
}

export interface CreateSessionOpts {
  identity: IdentityEx;
  properties: Map<string, string>;
  dateMs: number;
}

export interface CreateLeaseSet2Opts {
  identity: IdentityEx;
  sessionId: number;
  leases: Lease[];
  expires: number;
  dateMs: number;
}

/**
 * Build a spec-compliant CreateSessionMessage (I2CP type 1).
 *
 * Per I2CP-Spec + i2pd's I2CPSession::CreateSessionMessageHandler (I2CP.cpp:327):
 *   [1-byte type=1]
 *   [inline Destination als IdentityEx (387 bytes)]
 *   [2-byte mapping-size BE]
 *   [sorted protobuf Mapping]
 *   [8-byte Date BE]
 *   [64-byte Ed25519 Signature über Destination||Mapping||Date]
 *
 * Wrapped in the standard I2CP envelope via encodeMessage:
 *   [4-byte length BE][1-byte type=CREATE_SESSION][payload above]
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

  // Inner payload (after the 1-byte type=CREATE_SESSION, no 2-byte sessionId):
  const innerPayload = Buffer.concat([
    identityBytes,                                    // 387 bytes
    Buffer.from([(mappingBytes.length >> 8) & 0xff, mappingBytes.length & 0xff]), // 2-byte mapping size BE
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
 * Per I2CP-Spec the payload is:
 *   [1-byte sessionId]
 *   [IdentityEx (387 bytes) — for signing]
 *   [2-byte leases count BE]
 *   [for each lease: 32 routerHash + 32 tunnelGw + 8 expiresMs BE]
 *   [8-byte Date BE]
 *   [64-byte Ed25519 Signature über (IdentityEx || Leases || Date)]
 *
 * NOTE: This is the MVP skeleton — full LeaseSet_2 spec also includes
 * unconditional-lookups flag, published-flag, and offline-signing key.
 * We send the minimal-valid form; Java-I2P tolerates it for development.
 *
 * Wrapped in standard I2CP envelope (type=41, sessionId in header).
 */
export function encodeCreateLeaseSet2(opts: CreateLeaseSet2Opts): Buffer {
  const identityBytes = opts.identity.toByteArray();
  const dateBytes = Buffer.alloc(8);
  dateBytes.writeBigUInt64BE(BigInt(opts.dateMs), 0);

  // Build leases body
  const leaseParts: Buffer[] = [];
  for (const lease of opts.leases) {
    if (lease.routerHash.length !== 32) throw new Error('routerHash must be 32 bytes');
    if (lease.tunnelGw.length !== 32) throw new Error('tunnelGw must be 32 bytes');
    const expires = Buffer.alloc(8);
    expires.writeBigUInt64BE(BigInt(lease.expires), 0);
    leaseParts.push(Buffer.from(lease.routerHash));
    leaseParts.push(Buffer.from(lease.tunnelGw));
    leaseParts.push(expires);
  }
  const leasesBytes = Buffer.concat(leaseParts);
  const leasesCount = Buffer.from([(opts.leases.length >> 8) & 0xff, opts.leases.length & 0xff]);

  // SessionId byte (1 byte, not 2 — LeaseSet uses 1-byte sid internally per spec)
  const sidByte = Buffer.from([opts.sessionId & 0xff]);

  // Signature: identity || leases || date
  const signedData = Buffer.concat([identityBytes, leasesBytes, dateBytes]);
  const signature = opts.identity.sign(signedData);

  const innerPayload = Buffer.concat([
    sidByte,                                          // 1-byte sessionId
    identityBytes,                                    // 387 bytes
    leasesCount,                                      // 2-byte leases count
    leasesBytes,                                      // N lease entries (72 bytes each)
    dateBytes,                                        // 8 bytes
    signature,                                        // 64 bytes
  ]);

  return encodeMessage({
    type: I2CP_MSG.CREATE_LEASE_SET_2,
    sessionId: opts.sessionId,
    payload: innerPayload,
  });
}