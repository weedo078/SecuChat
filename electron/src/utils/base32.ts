/**
 * Base32 encoding/decoding for I2P b32 addresses.
 *
 * Uses the RFC 4648 base32 alphabet — lowercase (`a-z` + `2-7`). I2P's
 * b32 spec uses the same alphabet so the two algorithms are interchangeable.
 * The trailing bits-padding never participates in the address so the
 * canonical I2P b32 of a 32-byte SHA-256 digest is exactly 52 chars.
 *
 * Aligned with `app/src/utils/base32.ts` but kept self-contained for the
 * Electron side (no `btoa`/`atob` dependency) so the encoding logic is
 * available even in stripped-down Node runtimes.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * Encode a Uint8Array as lowercase base32 (no padding chars).
 */
export function toBase32(data: Uint8Array): string {
  let output = '';
  let bits = 0;
  let value = 0;

  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decode a lowercase base32 string back to bytes. Non-alphabet characters
 * are silently skipped so the function is tolerant of human input.
 */
export function fromBase32(str: string): Uint8Array {
  const output: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of str.toLowerCase()) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) continue;

    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
}
