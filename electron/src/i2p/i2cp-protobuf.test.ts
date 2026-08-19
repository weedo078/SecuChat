import { describe, it, expect } from 'vitest';
import { encodeMapping, decodeMapping } from './i2cp-protobuf';

/**
 * I2CP Mapping protobuf encoder/decoder — Test contract.
 *
 * Wire-format spec (I2CP-Ov §3, protobuf-Mapping):
 *   0x0A <varint-key-len> <key-bytes> 0x12 <varint-value-len> <value-bytes>
 *   0x0A = field-tag 1 (length-delimited string) = KEY
 *   0x12 = field-tag 2 (length-delimited string) = VALUE
 *
 * Keys MUST be sorted lexikografisch (UTF-8 byte order) before encoding —
 * otherwise the signature differs and Java-I2P rejects CreateSession.
 */

describe('encodeMapping', () => {
  it('empty map produces empty buffer', () => {
    const buf = encodeMapping(new Map());
    expect(buf.length).toBe(0);
  });

  it('single entry: 0x0A + varlen(key) + key + 0x12 + varlen(value) + value', () => {
    const buf = encodeMapping(new Map([['k', 'v']]));
    // 0x0A 0x01 0x6B 0x12 0x01 0x76
    const expected = Buffer.from([0x0a, 0x01, 0x6b, 0x12, 0x01, 0x76]);
    expect(buf.equals(expected)).toBe(true);
  });

  it('sorts keys lexikografisch before encoding (unsorted Map → sorted decode)', () => {
    const m = new Map<string, string>([
      ['zeta', 'z'],
      ['alpha', 'a'],
      ['mu', 'm'],
    ]);
    const buf = encodeMapping(m);
    const decoded = decodeMapping(buf);
    expect([...decoded.keys()]).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('varint length for 128-byte key (multi-byte varint)', () => {
    const key128 = 'k'.repeat(128);
    const buf = encodeMapping(new Map([[key128, 'v']]));
    // 0x0A, then 2-byte varint (0x80 0x01), then 128 'k' bytes, then 0x12, then 0x01, then 'v'
    expect(buf[0]).toBe(0x0a);
    expect(buf[1]).toBe(0x80);
    expect(buf[2]).toBe(0x01);
    // tag-key (1) + varlen-key (2) + key (128) + tag-value (1) + varlen-value (1) + value 'v' (1) = 134
    expect(buf.length).toBe(134);
  });

  it('two maps with same keys/values in different order produce identical bytes', () => {
    const a = new Map([
      ['a', '1'],
      ['b', '2'],
      ['c', '3'],
    ]);
    const b = new Map([
      ['c', '3'],
      ['a', '1'],
      ['b', '2'],
    ]);
    expect(encodeMapping(a).equals(encodeMapping(b))).toBe(true);
  });

  it('varint for 127-byte key stays single-byte (boundary)', () => {
    const key127 = 'x'.repeat(127);
    const buf = encodeMapping(new Map([[key127, 'v']]));
    expect(buf[0]).toBe(0x0a); // tag
    expect(buf[1]).toBe(0x7f); // single-byte varint = 127 (no continuation bit)
    expect(buf[2]).toBe(0x78); // first 'x'
  });

  it('UTF-8 multi-byte keys round-trip correctly', () => {
    // 'café' = c=0x63 a=0x61 f=0x66 é=0xC3 0xA9 → 5 UTF-8 bytes
    const m = new Map<string, string>([['café', 'naïve']]);
    const buf = encodeMapping(m);
    // Verify length encoding reflects 5 bytes, not 4 chars
    // key-len varint = 5 = 0x05
    expect(buf[0]).toBe(0x0a);
    expect(buf[1]).toBe(0x05);
    expect(buf[2]).toBe(0x63);
    expect(buf[3]).toBe(0x61);
    expect(buf[4]).toBe(0x66);
    expect(buf[5]).toBe(0xc3);
    expect(buf[6]).toBe(0xa9);
    // value 'naïve' = 6 UTF-8 bytes (ï = 0xC3 0xAF)
    expect(buf[7]).toBe(0x12);
    expect(buf[8]).toBe(0x06);
    const decoded = decodeMapping(buf);
    expect(decoded.get('café')).toBe('naïve');
  });

  it('three-byte varint for 16k-byte key', () => {
    // 16384 = 0x4000 → 3-byte varint (0x80 0x80 0x01)
    const key = 'a'.repeat(16384);
    const buf = encodeMapping(new Map([[key, 'v']]));
    expect(buf[0]).toBe(0x0a);
    expect(buf[1]).toBe(0x80);
    expect(buf[2]).toBe(0x80);
    expect(buf[3]).toBe(0x01);
  });

  it('encodeMapping is sync (no Promise return type)', () => {
    const buf = encodeMapping(new Map([['k', 'v']]));
    expect(buf).toBeInstanceOf(Buffer);
  });
});

describe('decodeMapping', () => {
  it('empty buffer produces empty Map (no throw)', () => {
    expect(decodeMapping(Buffer.alloc(0)).size).toBe(0);
  });

  it('decode round-trips an encoded map (multi-entry)', () => {
    const m = new Map<string, string>([
      ['host', '127.0.0.1'],
      ['port', '7654'],
      ['from', 'foo@bar'],
    ]);
    const buf = encodeMapping(m);
    const decoded = decodeMapping(buf);
    expect(decoded).toEqual(m);
  });

  it('throws with offset info when value tag (0x12) is missing', () => {
    // Hand-crafted: 0x0A 0x01 0x6B (key 'k', length 1, byte 0x6B) — no value tag.
    const malformed = Buffer.from([0x0a, 0x01, 0x6b]);
    expect(() => decodeMapping(malformed)).toThrow(/offset/i);
  });

  it('throws when key tag (0x0A) is missing at offset 0', () => {
    // 0x12 0x01 0x76 — looks like a value but appears before any key tag.
    const malformed = Buffer.from([0x12, 0x01, 0x76]);
    expect(() => decodeMapping(malformed)).toThrow(/key tag/i);
  });

  it('throws on varint overrun (truncated length)', () => {
    // 0x0A 0xFF 0xFF — tag with continuation-bit varint that never terminates.
    const malformed = Buffer.from([0x0a, 0xff, 0xff]);
    expect(() => decodeMapping(malformed)).toThrow(/varint/i);
  });

  it('decode(encode(x)).size === x.size for empty-string values', () => {
    const m = new Map<string, string>([
      ['a', ''],
      ['b', ''],
    ]);
    const decoded = decodeMapping(encodeMapping(m));
    expect(decoded.size).toBe(2);
    expect(decoded.get('a')).toBe('');
    expect(decoded.get('b')).toBe('');
  });
});