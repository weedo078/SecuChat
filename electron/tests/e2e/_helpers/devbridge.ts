/**
 * Shared DevBridge helpers for cross-platform E2E.
 *
 * The Android-side DevBridge is a local TCP server (127.0.0.1:8888 on the
 * device, gated on `secuchat_test_mode=1`). To reach it from the host,
 * `adb -s <serial> forward tcp:HOST_PORT tcp:8888` tunnels host-side
 * `localhost:HOST_PORT` to the device's port 8888.
 *
 * See memory `secuchat-dev-bridge.md` for the full architecture and the
 * `~/.claude/skills/secuchat-dev-bridge/` skill for the `secuchat-dev`
 * Bash wrapper (which auto-runs the adb forward).
 *
 * The plugin exposes JSON-over-HTTP routes (see
 * `app/android/app/src/main/java/com/secuchat/app/plugin/DevBridgePlugin/DevBridgePlugin.java`):
 *   GET  /health                  → { ok: true, running: boolean }
 *   GET  /identity                → DevBridge.getIdentity()
 *   GET  /contacts                → DevBridge.getContacts()
 *   GET  /state                   → DevBridge.getState()
 *   POST /send-message            → DevBridge.sendMessage(jsonBody)
 *   POST /import-contact          → DevBridge.importContact(jsonBody)
 *   POST /eval                    → eval(jsExpression) (raw JS body)
 *
 * This helper does NOT bring up the adb forward itself — that's a manual
 * prerequisite so the test can fail loudly if the device or bridge is
 * missing. The wrapper script `~/.claude/skills/secuchat-dev-bridge/secuchat-dev`
 * is the recommended way to set up the forward.
 */
import { spawnSync } from 'node:child_process';

export interface AdbDevice {
  serial: string;
  state: string; // 'device' | 'offline' | 'unauthorized' | 'no permissions'
}

/** Result of an `adb devices --format=json` parse. */
export interface AdbList {
  devices: AdbDevice[];
}

/**
 * Run `adb devices` and return the parsed list. Returns `{ devices: [] }`
 * if `adb` is missing or produces no output — never throws.
 */
export function listAdbDevices(): AdbList {
  const probe = spawnSync('adb', ['devices'], { encoding: 'utf8' });
  if (probe.error || !probe.stdout) return { devices: [] };
  return parseAdbDevicesText(probe.stdout);
}

/**
 * Parse the text output of `adb devices` (header line + per-device lines).
 * Tolerates the trailing `* daemon ...` lines adb occasionally prints.
 */
export function parseAdbDevicesText(text: string): AdbList {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('List of devices') && !l.startsWith('*'));
  const devices: AdbDevice[] = [];
  for (const line of lines) {
    // Format: "<serial>\t<state>" (tab-separated; whitespace tolerated).
    const [serial, state] = line.split(/\s+/);
    if (!serial) continue;
    devices.push({ serial, state: state ?? 'unknown' });
  }
  return { devices };
}

/**
 * Returns the first attached device in state 'device'. Used by tests that
 * don't care about which device (A50/A52/A54/etc) — the cord can pin a
 * specific serial.
 */
export function firstAttachedDevice(): AdbDevice | undefined {
  return listAdbDevices().devices.find((d) => d.state === 'device');
}

/**
 * Returns the first attached device's serial, or `null` if no device.
 */
export function firstAttachedSerial(): string | null {
  return firstAttachedDevice()?.serial ?? null;
}

/**
 * Run `adb -s <serial> forward --list` and return the parsed mappings.
 *
 * Format per line: `<serial> tcp:<host-port> tcp:<device-port>`
 * Only host→device (`forward`) mappings are returned.
 */
export function listAdbForwards(serial?: string): Array<{ hostPort: number; devicePort: number }> {
  const args = serial ? ['-s', serial, 'forward', '--list'] : ['forward', '--list'];
  const res = spawnSync('adb', args, { encoding: 'utf8' });
  if (res.error || !res.stdout) return [];
  const out: Array<{ hostPort: number; devicePort: number }> = [];
  for (const line of res.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Match: "<serial-or-empty> tcp:<host> tcp:<device>"
    const m = trimmed.match(/^(?:\S+\s+)?tcp:(\d+)\s+tcp:(\d+)\s*$/);
    if (!m) continue;
    out.push({ hostPort: Number(m[1]), devicePort: Number(m[2]) });
  }
  return out;
}

/**
 * Run `adb -s <serial> forward tcp:<hostPort> tcp:8888`. Idempotent — re-adding
 * an existing mapping is fine. Returns true on success.
 */
export function adbForwardDevBridge(hostPort: number, serial: string): boolean {
  const res = spawnSync('adb', ['-s', serial, 'forward', `tcp:${hostPort}`, 'tcp:8888'], {
    encoding: 'utf8',
  });
  return res.status === 0;
}

/**
 * Lightweight HTTP GET against `http://127.0.0.1:<hostPort>/<path>`.
 * Returns `{ ok, status, body }`. Times out after `timeoutMs` (default 2 s).
 *
 * Uses `node:http` directly — no fetch / curl / extra deps. The DevBridge
 * speaks plain HTTP/1.1 so this is sufficient.
 */
export interface DevBridgeGetResult {
  ok: boolean;
  status: number;
  body: string;
}

export function devbridgeGet(
  hostPort: number,
  path: string,
  timeoutMs = 2_000,
): Promise<DevBridgeGetResult> {
  return new Promise((resolve) => {
    const http = require('node:http') as typeof import('node:http');
    const req = http.request(
      { host: '127.0.0.1', port: hostPort, path, method: 'GET', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', () => resolve({ ok: false, status: 0, body: '' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, status: 0, body: '' });
    });
    req.end();
  });
}

/**
 * Convenience: GET /health and return whether the DevBridge responded with
 * `{ ok: true, running: <bool> }`. Used as the precondition for the cross-
 * platform test.
 */
export async function devbridgeHealthCheck(hostPort: number): Promise<boolean> {
  const r = await devbridgeGet(hostPort, '/health', 2_000);
  if (!r.ok) return false;
  try {
    const parsed = JSON.parse(r.body) as { ok?: boolean; running?: boolean };
    return parsed.ok === true && parsed.running === true;
  } catch {
    return false;
  }
}

/** Default host-side port to forward to. Per `secuchat-dev-bridge.md`,
 *  A50 → 8887, A52 → 8889. We pick 8887 as the default for the
 *  cross-platform test; the cord can override via env. */
export const DEFAULT_DEVBRIDGE_HOST_PORT = 8887;

/**
 * Read the host port from env, falling back to DEFAULT_DEVBRIDGE_HOST_PORT.
 * The cord / wrapper script can set `SECUCHAT_BRIDGE_PORT_<SERIAL>` to
 * pin a per-device port (matching the secuchat-dev wrapper convention).
 */
export function resolveDevBridgeHostPort(serial?: string): number {
  if (serial) {
    const envKey = `SECUCHAT_BRIDGE_PORT_${serial.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const fromEnv = process.env[envKey];
    if (fromEnv && /^\d+$/.test(fromEnv)) return Number(fromEnv);
  }
  const fallback = process.env.SECUCHAT_BRIDGE_PORT;
  if (fallback && /^\d+$/.test(fallback)) return Number(fallback);
  return DEFAULT_DEVBRIDGE_HOST_PORT;
}