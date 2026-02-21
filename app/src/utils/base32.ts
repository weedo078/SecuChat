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
 * Base64 decode string to Uint8Array (browser-compatible)
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  return new Uint8Array(binary.split('').map(c => c.charCodeAt(0)));
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
