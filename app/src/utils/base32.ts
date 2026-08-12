/**
 * Base32 encoding/decoding for I2P addresses
 * Uses RFC 4648 base32 alphabet (lowercase)
 * 
 * Plus: Base64 utilities for browser (replacing Node.js Buffer)
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/**
 * Base64 encode Uint8Array to string (browser-compatible)
 */
export function uint8ArrayToBase64(data: Uint8Array): string {
  const binary = Array.from(data).map(b => String.fromCharCode(b)).join('');
  return btoa(binary);
}

/**
 * Strict base64 decode. Throws InvalidCharacterError on bad input. Use this
 * when the caller is certain the input came from `uint8ArrayToBase64` and
 * a failure indicates real corruption that should surface.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  return new Uint8Array(binary.split('').map((c) => c.charCodeAt(0)));
}

/**
 * Tolerant base64 decode. Returns null if the input is not valid base64.
 * Use this when reading from storage where older builds may have written
 * a non-base64 value (e.g. JSON-serialized Uint8Array) — the caller can
 * then fall back to regenerating the resource instead of crashing the
 * whole UI mount.
 */
export function tryBase64ToUint8Array(base64: string): Uint8Array | null {
  if (typeof base64 !== 'string' || base64.length === 0) return null;
  if (!/^[A-Za-z0-9+/\s]+=*$/.test(base64)) return null;
  try {
    const binary = atob(base64);
    return new Uint8Array(binary.split('').map((c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

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
