import { describe, expect, it } from "vitest";
import { IdentityEx } from "./i2cp-identity";
import { encodeMapping } from "./i2cp-protobuf";
import {
  parseRequestLeaseSet,
  parseRequestVariableLeaseSet,
  validateParsedLeaseSetRequest,
  withLeaseSetSessionId,
} from "./i2cp-lease-set-request";

function makePrivKey(seed = 11): Uint8Array {
  const blob = new Uint8Array(128);
  for (let i = 0; i < 128; i++) blob[i] = (i * seed + 3) & 0xff;
  return blob;
}

function makeRequestPayload(
  identity = IdentityEx.fromPrivKey(makePrivKey()),
  overrides: Partial<{
    publishedSeconds: number;
    expiresSeconds: number;
    leases: Array<{
      tunnelGw: Uint8Array;
      tunnelId: number;
      endDateSeconds: number;
    }>;
    storeType: number;
  }> = {},
): Buffer {
  const publishedSeconds = overrides.publishedSeconds ?? 1_700_000_000;
  const expiresSeconds = overrides.expiresSeconds ?? 600;
  const leases = overrides.leases ?? [
    {
      tunnelGw: new Uint8Array(32).fill(0xab),
      tunnelId: 0x11223344,
      endDateSeconds: publishedSeconds + 600,
    },
  ];
  const options = encodeMapping(new Map([["i2cp.leaseSetType", "3"]]));
  const parts: Buffer[] = [
    Buffer.from([overrides.storeType ?? 3]),
    identity.toByteArray(),
  ];
  const published = Buffer.alloc(4);
  published.writeUInt32BE(publishedSeconds, 0);
  parts.push(published);
  const expires = Buffer.alloc(2);
  expires.writeUInt16BE(expiresSeconds, 0);
  parts.push(expires);
  const flags = Buffer.alloc(2);
  flags.writeUInt16BE(0, 0);
  parts.push(flags);
  const optLen = Buffer.alloc(2);
  optLen.writeUInt16BE(options.length, 0);
  parts.push(optLen, options);
  parts.push(Buffer.from([1]));
  const encType = Buffer.alloc(2);
  encType.writeUInt16BE(0, 0);
  const encLen = Buffer.alloc(2);
  encLen.writeUInt16BE(32, 0);
  parts.push(encType, encLen, Buffer.from(identity.encryptionPublicKey));
  parts.push(Buffer.from([leases.length]));
  for (const lease of leases) {
    const tid = Buffer.alloc(4);
    tid.writeUInt32BE(lease.tunnelId, 0);
    const end = Buffer.alloc(4);
    end.writeUInt32BE(lease.endDateSeconds, 0);
    parts.push(Buffer.from(lease.tunnelGw), tid, end);
  }
  return Buffer.concat(parts);
}

describe("I2CP LeaseSet request parser", () => {
  it("parses a REQUEST_VARIABLE_LEASE_SET LeaseSet2 body and separates signable bytes", () => {
    const identity = IdentityEx.fromPrivKey(makePrivKey());
    const payload = makeRequestPayload(identity);
    const parsed = parseRequestVariableLeaseSet(payload);

    expect(parsed.storeType).toBe(3);
    expect(parsed.identity.toByteArray().equals(identity.toByteArray())).toBe(
      true,
    );
    expect(parsed.options.get("i2cp.leaseSetType")).toBe("3");
    expect(parsed.encryptionKeys).toHaveLength(1);
    expect(parsed.leases).toHaveLength(1);
    expect(parsed.leases[0].tunnelId).toBe(0x11223344);
    expect(
      parsed.leaseSetBytesWithoutSignature.equals(payload.subarray(1)),
    ).toBe(true);
    expect(parsed.databaseStoreSignableBytes[0]).toBe(0x03);
    expect(
      parsed.databaseStoreSignableBytes
        .subarray(1)
        .equals(parsed.leaseSetBytesWithoutSignature),
    ).toBe(true);
  });

  it("parses legacy REQUEST_LEASE_SET with the same LeaseSet2 body shape", () => {
    const parsed = parseRequestLeaseSet(makeRequestPayload());
    expect(parsed.storeType).toBe(3);
    expect(parsed.leases).toHaveLength(1);
  });

  it("validates session id, identity, time bounds, and lease shape", () => {
    const identity = IdentityEx.fromPrivKey(makePrivKey());
    const parsed = withLeaseSetSessionId(
      parseRequestVariableLeaseSet(makeRequestPayload(identity)),
      42,
    );
    expect(() =>
      validateParsedLeaseSetRequest(parsed, {
        expectedSessionId: 42,
        expectedIdentity: identity,
        currentRouterTimeSeconds: () => 1_700_000_000,
      }),
    ).not.toThrow();
  });

  it("rejects unsupported storeType", () => {
    expect(() =>
      parseRequestVariableLeaseSet(
        makeRequestPayload(undefined, { storeType: 5 }),
      ),
    ).toThrow(/unsupported storeType/);
  });

  it("rejects invalid lease counts and stale published timestamps", () => {
    const identity = IdentityEx.fromPrivKey(makePrivKey());
    const emptyLeases = withLeaseSetSessionId(
      parseRequestVariableLeaseSet(
        makeRequestPayload(identity, { leases: [] }),
      ),
      7,
    );
    expect(() =>
      validateParsedLeaseSetRequest(emptyLeases, {
        expectedSessionId: 7,
        expectedIdentity: identity,
        currentRouterTimeSeconds: () => 1_700_000_000,
      }),
    ).toThrow(/lease count/);

    const stale = withLeaseSetSessionId(
      parseRequestVariableLeaseSet(
        makeRequestPayload(identity, { publishedSeconds: 1_699_999_000 }),
      ),
      7,
    );
    expect(() =>
      validateParsedLeaseSetRequest(stale, {
        expectedSessionId: 7,
        expectedIdentity: identity,
        currentRouterTimeSeconds: () => 1_700_000_000,
      }),
    ).toThrow(/too old/);
  });
});
