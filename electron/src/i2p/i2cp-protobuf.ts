/**
 * I2CP Mapping protobuf encoder/decoder.
 *
 * Per I2CP-Spec (https://i2p.net/en/docs/specs/i2cp-overview/), a CreateSession
 * Mapping is a protobuf message where each entry is:
 *
 *   0x0A <varint-length> <key-bytes> 0x12 <varint-length> <value-bytes>
 *
 * 0x0A = field-tag 1 (length-delimited, type string) = key
 * 0x12 = field-tag 2 (length-delimited, type string) = value
 *
 * CRITICAL: the spec REQUIRES keys to be sorted lexikografisch (UTF-8 byte order)
 * BEFORE encoding. An unsorted mapping produces a different signature and the
 * router rejects the CreateSession.
 */

function encodeVarint(value: number): Buffer {
  if (value < 0) throw new Error('negative varint');
  if (value < 0x80) return Buffer.from([value]);
  const bytes: number[] = [];
  while (value > 0) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes[bytes.length - 1] &= 0x7f; // clear continuation bit on last byte
  return Buffer.from(bytes);
}

function decodeVarint(buf: Buffer, offset: number): { value: number; consumed: number } {
  let value = 0;
  let shift = 0;
  let i = 0;
  while (true) {
    if (offset + i >= buf.length) throw new Error('varint overrun');
    const b = buf[offset + i];
    value |= (b & 0x7f) << shift;
    i++;
    if ((b & 0x80) === 0) break;
    shift += 7;
    if (shift >= 35) throw new Error('varint too long');
  }
  return { value, consumed: i };
}

export function encodeMapping(mapping: Map<string, string>): Buffer {
  // Sort keys by UTF-8 byte order (not locale-aware — I2P spec uses raw bytes).
  const sortedKeys = [...mapping.keys()].sort();
  const parts: Buffer[] = [];
  for (const key of sortedKeys) {
    const keyBytes = Buffer.from(key, 'utf-8');
    const valueBytes = Buffer.from(mapping.get(key)!, 'utf-8');
    parts.push(Buffer.from([0x0a])); // field-tag for key
    parts.push(encodeVarint(keyBytes.length));
    parts.push(keyBytes);
    parts.push(Buffer.from([0x12])); // field-tag for value
    parts.push(encodeVarint(valueBytes.length));
    parts.push(valueBytes);
  }
  return Buffer.concat(parts);
}

export function decodeMapping(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let offset = 0;
  while (offset < buf.length) {
    if (buf[offset] !== 0x0a)
      throw new Error(`expected key tag at offset ${offset}, got 0x${buf[offset].toString(16)}`);
    offset++;
    const keyLen = decodeVarint(buf, offset);
    offset += keyLen.consumed;
    const key = buf.subarray(offset, offset + keyLen.value).toString('utf-8');
    offset += keyLen.value;
    if (buf[offset] !== 0x12) throw new Error(`expected value tag at offset ${offset}`);
    offset++;
    const valueLen = decodeVarint(buf, offset);
    offset += valueLen.consumed;
    const value = buf.subarray(offset, offset + valueLen.value).toString('utf-8');
    offset += valueLen.value;
    out.set(key, value);
  }
  return out;
}
