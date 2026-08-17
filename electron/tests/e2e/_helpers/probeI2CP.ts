/**
 * Shared TCP probe for Java I2P's I2CP port (127.0.0.1:7654).
 *
 * Lifted out of `i2p-electron.test.ts` (Task 17) so the cross-platform test
 * (Task 18) and any future single-process test can reuse the same logic
 * without duplicating the net.Socket dance.
 *
 * Mirrors `I2PPlugin.isI2pAvailable()` semantics but with a 1 s budget so a
 * hung port fails fast — important when the probe is called as a pre-flight
 * for multi-second Electron cold-starts.
 */
import * as net from 'node:net';

export const I2CP_HOST = '127.0.0.1';
export const I2CP_PORT = 7654;

/**
 * Returns `true` if a TCP connection to `${host}:${port}` opens within
 * `timeoutMs`. Always resolves (never rejects) — the boolean is the signal.
 */
export function probeI2CP(host: string = I2CP_HOST, port: number = I2CP_PORT, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/** Sentinel b32 returned by `I2CPSocketManager.initialize()` until the
 *  full I2CP CreateSessionMessage / SessionStatusMessage handshake lands. */
export const B32_PLACEHOLDER = 'placeholder-b32-will-be-set-by-i2p-router';

/** Full I2P b32 wire format — 52 chars of lowercase base32 alphabet + `.b32.i2p`. */
export const B32_WIRE_FORMAT = /^[a-z2-7]{52}\.b32\.i2p$/;