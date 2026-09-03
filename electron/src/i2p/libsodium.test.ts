import { describe, it, expect, beforeAll } from "vitest";
import {
  loadLibsodium,
  ed25519PkToCurve25519,
  ed25519SkToCurve25519,
} from "./libsodium";

let sodium: Awaited<ReturnType<typeof loadLibsodium>>;

beforeAll(async () => {
  sodium = await loadLibsodium();
});

describe("libsodium wrapper", () => {
  it("loads successfully on this platform", () => {
    expect(sodium).toBeDefined();
  });

  it("ed25519PkToCurve25519 returns 32B output for valid Ed25519 pub", () => {
    // RFC 8032 Test-Vector 1 (signing key, public-key derivation)
    const edPub = new Uint8Array([
      0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7,
      0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64, 0x07, 0x3a,
      0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25,
      0xaf, 0x02, 0x1a, 0x84, 0x7f, 0x8f, 0x40, 0x1f,
    ]);
    const curve = ed25519PkToCurve25519(edPub);
    expect(curve.length).toBe(32);
    // RFC 7748 / libsodium test-vector: expected curve25519 pub from this Ed25519 key
    expect(Array.from(curve)).toEqual([
      0x95, 0x42, 0x1d, 0x52, 0xf4, 0x9f, 0x6c, 0x28,
      0x5c, 0x1e, 0xef, 0xae, 0x9d, 0xc0, 0x53, 0xc1,
      0x73, 0x49, 0x14, 0x8b, 0x87, 0xb3, 0x52, 0xa7,
      0x97, 0x7f, 0x73, 0x15, 0x69, 0x68, 0xd1, 0x70,
    ]);
  });

  it("ed25519SkToCurve25519 returns 32B output for valid Ed25519 seed", () => {
    // libsodium expects 32-byte seed (NOT 64-byte expanded secret)
    const edSeed = new Uint8Array(32).fill(0x42); // arbitrary valid-length input
    const curve = ed25519SkToCurve25519(edSeed);
    expect(curve.length).toBe(32);
  });

  it("throws on invalid-length Ed25519 pub input", () => {
    expect(() => ed25519PkToCurve25519(new Uint8Array(31))).toThrow(
      /expected 32 bytes/,
    );
    expect(() => ed25519PkToCurve25519(new Uint8Array(33))).toThrow(
      /expected 32 bytes/,
    );
  });

  it("loadLibsodium returns the same singleton instance", async () => {
    const a = await loadLibsodium();
    const b = await loadLibsodium();
    expect(a).toBe(b);
  });
});
