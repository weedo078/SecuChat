/**
 * Renderer→main IPC payload validators for the `i2p:*` channels.
 *
 * WHY THIS EXISTS: `ipcMain.handle` payloads are fully renderer-controlled.
 * The preload allowlist (electron/src/preload.ts) restricts *which channel*
 * can be invoked, but says nothing about the *shape* of the arguments. A
 * compromised renderer could otherwise pass e.g.
 * `i2pInvoke('start', { host: 'evil.example', port: 80 })` and repoint the
 * I2CP session at an attacker-controlled endpoint, or smuggle extra keys into
 * the options object.
 *
 * Each parser is total: it either returns a freshly-constructed object
 * containing ONLY the known keys (so unknown/prototype-polluting keys are
 * dropped rather than forwarded), or it throws. Throwing inside an
 * `ipcMain.handle` callback rejects the renderer's promise, which is the
 * behaviour we want — the renderer sees a normal Error, not a silent no-op.
 *
 * These live in their own module (rather than inline in main.ts) because
 * main.ts cannot be unit-tested without a full Electron runtime, whereas
 * these parsers are pure and covered by ipc-validators.test.ts.
 */

/**
 * I2P event names forwarded to renderers as `i2p:event:<name>`.
 * MUST stay in sync with `I2P_EVENTS` in electron/src/preload.ts and with the
 * event names emitted by `I2PPlugin.emitOrBuffer` (i2p-plugin.ts).
 * ipc-validators.test.ts asserts the exact contents so drift is caught.
 */
export const I2P_EVENT_NAMES = ['i2pStatus', 'i2pMessage', 'i2pStreamConnected', 'i2pStreamClosed'] as const;

export type I2PEventName = (typeof I2P_EVENT_NAMES)[number];

export interface StartOpts {
  host?: string;
  port?: number;
  nickname?: string;
}

export interface ConnectToOpts {
  destination: string;
}

export interface SendOpts {
  streamId: number;
  data: string;
}

export interface CloseOpts {
  streamId: number;
  reason?: string;
}

/** Max characters of an offending value echoed back in an error message. */
const ERROR_VALUE_CAP = 48;

/**
 * Render an untrusted value for an error message without letting a large blob
 * flood the log. Mirrors `I2CPSocketManager.requireDestination`'s approach
 * (i2cp-socket-manager.ts:59-66).
 */
function describe(value: unknown): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  } catch {
    text = Object.prototype.toString.call(value);
  }
  return text.length > ERROR_VALUE_CAP ? `${text.slice(0, ERROR_VALUE_CAP)}…` : text;
}

function fail(channel: string, detail: string): never {
  throw new Error(`${channel}: ${detail}`);
}

/**
 * Narrow an unknown IPC payload to a plain record. Rejects arrays and
 * primitives; `null`/`undefined` map to `{}` so handlers whose options are all
 * optional (currently only `i2p:start`) can be invoked with no arguments.
 */
function asRecord(channel: string, raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(channel, `expected an options object, got ${describe(raw)}`);
  }
  return raw as Record<string, unknown>;
}

function requireString(channel: string, obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.length === 0) {
    fail(channel, `${key} must be a non-empty string, got ${describe(value)}`);
  }
  return value;
}

/** Like requireString but allows `undefined` (absent optional field). */
function optionalString(
  channel: string,
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  if (!(key in obj) || obj[key] === undefined) return undefined;
  const value = obj[key];
  if (typeof value !== 'string') {
    fail(channel, `${key} must be a string, got ${describe(value)}`);
  }
  return value;
}

/** A stream id: a non-negative safe integer. */
function requireStreamId(channel: string, obj: Record<string, unknown>): number {
  const value = obj.streamId;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(channel, `streamId must be a non-negative integer, got ${describe(value)}`);
  }
  return value;
}

export function parseStartOpts(raw: unknown): StartOpts {
  const channel = 'i2p:start';
  const obj = asRecord(channel, raw);
  const out: StartOpts = {};

  const host = optionalString(channel, obj, 'host');
  if (host !== undefined) out.host = host;

  const nickname = optionalString(channel, obj, 'nickname');
  if (nickname !== undefined) out.nickname = nickname;

  if ('port' in obj && obj.port !== undefined) {
    const port = obj.port;
    // Valid TCP port range; excludes 0 (wildcard) since we always dial out.
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
      fail(channel, `port must be an integer in 1..65535, got ${describe(port)}`);
    }
    out.port = port;
  }

  return out;
}

export function parseConnectToOpts(raw: unknown): ConnectToOpts {
  const channel = 'i2p:connectTo';
  const obj = asRecord(channel, raw);
  // `I2CPSocketManager.connectTo` re-validates via `requireDestination`; this
  // is the outer boundary check so a bad payload never reaches the socket.
  return { destination: requireString(channel, obj, 'destination') };
}

export function parseSendOpts(raw: unknown): SendOpts {
  const channel = 'i2p:send';
  const obj = asRecord(channel, raw);
  const streamId = requireStreamId(channel, obj);
  const data = obj.data;
  // Empty string is legal (a bare newline frame); only the *type* is enforced.
  if (typeof data !== 'string') {
    fail(channel, `data must be a string, got ${describe(data)}`);
  }
  return { streamId, data };
}

export function parseCloseOpts(raw: unknown): CloseOpts {
  const channel = 'i2p:close';
  const obj = asRecord(channel, raw);
  const out: CloseOpts = { streamId: requireStreamId(channel, obj) };
  const reason = optionalString(channel, obj, 'reason');
  if (reason !== undefined) out.reason = reason;
  return out;
}
