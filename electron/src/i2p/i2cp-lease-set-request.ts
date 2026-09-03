import { decodeMapping } from "./i2cp-protobuf";
import type { Lease2 } from "./i2cp-session-creator";

export type LeaseSetState =
  | "idle"
  | "awaiting-router-request"
  | "validating"
  | "signing"
  | "submitted"
  | "published-assumed"
  | "failed";

export interface ParsedLeaseSetRequest {
  sessionId: number;
  storeType: 3;
  destinationBytes: Buffer;
  publishedSeconds: number;
  expiresSeconds: number;
  flags: number;
  options: Map<string, string>;
  encryptionKeys: Array<{ encryptionType: number; publicKey: Uint8Array }>;
  leases: Lease2[];
  leaseSetBytesWithoutSignature: Buffer;
  databaseStoreSignableBytes: Buffer;
}

export interface ValidateLeaseSetRequestOpts {
  expectedSessionId: number;
  expectedDestinationBytes: Buffer;
  currentRouterTimeSeconds: () => number;
}

const IDENTITY_EX_BYTES = 387;
const LEASE2_BYTES = 40;
const DATABASE_STORE_LEASESET2_TYPE = 0x03;
const MAX_EXPIRES_SECONDS = 0xffff;
const MAX_LEASES = 16;
const FUTURE_SKEW_SECONDS = 60;
const PAST_SKEW_SECONDS = 300;
const MIN_END_BUFFER_SECONDS = 30;

function parseLeaseSetRequest(
  payload: Buffer,
  label: string,
): ParsedLeaseSetRequest {
  if (payload.length < 1 + IDENTITY_EX_BYTES + 4 + 2 + 2 + 2 + 1 + 1) {
    throw new Error(`${label}: payload too short`);
  }

  let offset = 0;
  const storeType = payload.readUInt8(offset);
  offset += 1;
  if (storeType !== 3) {
    throw new Error(`${label}: unsupported storeType ${storeType}`);
  }

  const leaseSetStart = offset;
  const identityBytes = payload.subarray(offset, offset + IDENTITY_EX_BYTES);
  offset += IDENTITY_EX_BYTES;

  const publishedSeconds = payload.readUInt32BE(offset);
  offset += 4;
  const expiresSeconds = payload.readUInt16BE(offset);
  offset += 2;
  const flags = payload.readUInt16BE(offset);
  offset += 2;

  const optionsSize = payload.readUInt16BE(offset);
  offset += 2;
  if (offset + optionsSize > payload.length) {
    throw new Error(`${label}: options overrun`);
  }
  const options = decodeMapping(payload.subarray(offset, offset + optionsSize));
  offset += optionsSize;

  if (offset >= payload.length)
    throw new Error(`${label}: missing encryption-key count`);
  const numKeys = payload.readUInt8(offset);
  offset += 1;
  const encryptionKeys: Array<{
    encryptionType: number;
    publicKey: Uint8Array;
  }> = [];
  for (let i = 0; i < numKeys; i++) {
    if (offset + 4 > payload.length)
      throw new Error(`${label}: encryption key ${i} header overrun`);
    const encryptionType = payload.readUInt16BE(offset);
    offset += 2;
    const keyLen = payload.readUInt16BE(offset);
    offset += 2;
    if (offset + keyLen > payload.length)
      throw new Error(`${label}: encryption key ${i} overrun`);
    encryptionKeys.push({
      encryptionType,
      publicKey: Uint8Array.from(payload.subarray(offset, offset + keyLen)),
    });
    offset += keyLen;
  }

  if (offset >= payload.length)
    throw new Error(`${label}: missing lease count`);
  const leaseCount = payload.readUInt8(offset);
  offset += 1;
  const leases: Lease2[] = [];
  for (let i = 0; i < leaseCount; i++) {
    if (offset + LEASE2_BYTES > payload.length)
      throw new Error(`${label}: lease ${i} overrun`);
    leases.push({
      tunnelGw: Uint8Array.from(payload.subarray(offset, offset + 32)),
      tunnelId: payload.readUInt32BE(offset + 32),
      endDateSeconds: payload.readUInt32BE(offset + 36),
    });
    offset += LEASE2_BYTES;
  }

  const leaseSetBytesWithoutSignature = Buffer.from(
    payload.subarray(leaseSetStart, offset),
  );
  const databaseStoreSignableBytes = Buffer.concat([
    Buffer.from([DATABASE_STORE_LEASESET2_TYPE]),
    leaseSetBytesWithoutSignature,
  ]);

  return {
    sessionId: 0,
    storeType: 3,
    destinationBytes: Buffer.from(identityBytes), // 387 raw bytes, byte-exact
    publishedSeconds,
    expiresSeconds,
    flags,
    options,
    encryptionKeys,
    leases,
    leaseSetBytesWithoutSignature,
    databaseStoreSignableBytes,
  };
}

export function parseRequestLeaseSet(payload: Buffer): ParsedLeaseSetRequest {
  return parseLeaseSetRequest(payload, "RequestLeaseSet");
}

export function parseRequestVariableLeaseSet(
  payload: Buffer,
): ParsedLeaseSetRequest {
  return parseLeaseSetRequest(payload, "RequestVariableLeaseSet");
}

export function withLeaseSetSessionId(
  parsed: ParsedLeaseSetRequest,
  sessionId: number,
): ParsedLeaseSetRequest {
  return { ...parsed, sessionId };
}

export function validateParsedLeaseSetRequest(
  parsed: ParsedLeaseSetRequest,
  opts: ValidateLeaseSetRequestOpts,
): void {
  if (parsed.sessionId !== opts.expectedSessionId) {
    throw new Error(
      `LeaseSet request sessionId mismatch: got ${parsed.sessionId}, expected ${opts.expectedSessionId}`,
    );
  }
  if (!parsed.destinationBytes.equals(opts.expectedDestinationBytes)) {
    throw new Error("LeaseSet request destination mismatch");
  }
  if (parsed.storeType !== 3)
    throw new Error(`unsupported LeaseSet storeType ${parsed.storeType}`);
  if (parsed.expiresSeconds > MAX_EXPIRES_SECONDS)
    throw new Error("LeaseSet expiresSeconds out of range");
  if (parsed.leases.length < 1 || parsed.leases.length > MAX_LEASES) {
    throw new Error(
      `LeaseSet lease count out of range: ${parsed.leases.length}`,
    );
  }

  const now = opts.currentRouterTimeSeconds();
  if (parsed.publishedSeconds > now + FUTURE_SKEW_SECONDS) {
    throw new Error("LeaseSet publishedSeconds too far in the future");
  }
  if (parsed.publishedSeconds < now - PAST_SKEW_SECONDS) {
    throw new Error("LeaseSet publishedSeconds too old");
  }

  for (const lease of parsed.leases) {
    if (lease.tunnelGw.length !== 32)
      throw new Error("Lease tunnelGw must be 32 bytes");
    if (lease.endDateSeconds <= parsed.publishedSeconds) {
      throw new Error("Lease endDateSeconds must be after publishedSeconds");
    }
    if (lease.endDateSeconds <= now + MIN_END_BUFFER_SECONDS) {
      throw new Error("Lease endDateSeconds too close to current router time");
    }
  }
}
