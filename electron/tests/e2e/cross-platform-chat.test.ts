/**
 * SecuChat Cross-Platform E2E — Linux Electron ↔ Android A50.
 *
 * Three tests arranged in dependency order:
 *
 *   1. Local IPC smoke test (Linux alone) — re-uses Task 17's probe via the
 *      shared `probeI2CP()` helper. MUST pass before any device test makes
 *      sense; if Java I2P isn't running on the Linux host, this suite has
 *      nothing to validate.
 *
 *   2. DevBridge reachability — checks `adb devices` shows an attached
 *      Android, then `curl --max-time 2 http://127.0.0.1:8887/health` (via
 *      our `devbridgeGet` helper, no extra deps) returns the bridge's
 *      `{ ok: true, running: true }`. Skips with a clear, runnable message
 *      if no device is attached — this is the normal developer-machine
 *      case and is NOT a failure.
 *
 *   3. Cross-platform chat (Linux → A50) — `test.skip()` BY DESIGN with a
 *      fully-executable reason string. The Phase-2 I2CP handshake is a TCP-
 *      only stub: `I2CPSocketManager.initialize()` returns the literal
 *      sentinel `'placeholder-b32-will-be-set-by-i2p-router'` instead of a
 *      real b32. `parseConnectToOpts()` rejects the placeholder, so neither
 *      direction of the roundtrip can complete end-to-end today. The cord
 *      `docs/superpowers/cords/2026-08-17-linux-electron-android-e2e.md`
 *      defines the manual operator procedure for when the handshake lands.
 *
 * When Phase-2 lands (i.e. `start()` returns a real b32), un-skip test #3
 * and replace the skip-reason with the roundtrip body. The POM helpers
 * (`launchElectron`, `firstAttachedSerial`, `adbForwardDevBridge`,
 * `devbridgeHealthCheck`) are ready to use.
 *
 * Running locally:
 *   cd electron && npx playwright test tests/e2e/cross-platform-chat.test.ts
 *
 * Requires:
 *   - Linux Electron build (same as Task 17)
 *   - Java I2P reachable on 127.0.0.1:7654 (for test #1)
 *   - Android device attached via adb + DevBridgePlugin enabled (for test #2)
 */
import { test, expect } from '@playwright/test';
import { probeI2CP, I2CP_HOST, I2CP_PORT, B32_PLACEHOLDER, B32_WIRE_FORMAT } from './_helpers/probeI2CP';
import { launchElectron } from './_helpers/electron-app';
import {
  listAdbDevices,
  adbForwardDevBridge,
  devbridgeHealthCheck,
  resolveDevBridgeHostPort,
} from './_helpers/devbridge';

/** Renderer-side view of the IPC bridge surface. Mirrors electron/src/preload.ts. */
interface ElectronRendererAPI {
  i2pInvoke(method: string, ...args: unknown[]): Promise<unknown>;
  onI2pEvent(event: string, cb: (data: unknown) => void): () => void;
}

/**
 * Skipped cross-platform chat reason — single source of truth for the skip
 * annotation AND the skip line in the cord. Update both together.
 */
const PHASE2_BLOCKER_REASON = [
  'Phase-2 blocker: I2CPSocketManager.initialize() is a TCP-only stub.',
  `start() returns the literal sentinel '${B32_PLACEHOLDER}', not a real b32.`,
  'Android parseConnectToOpts rejects the placeholder, so the cross-platform',
  'roundtrip cannot complete end-to-end today.',
  'See electron/src/i2p/i2cp-socket-manager.ts:94-96 (placeholder sentinel).',
  'See docs/superpowers/cords/2026-08-17-linux-electron-android-e2e.md for the',
  'manual operator procedure to run when the Phase-2 handshake lands.',
].join(' ');

/* ----------------------------------------------------------------------------
 * Test #1 — Local IPC smoke (Linux alone).
 * This is the same precondition as Task 17. If it doesn't pass, the device
 * tests have nothing meaningful to verify.
 * --------------------------------------------------------------------------*/
test('Linux Electron ↔ Java I2P local-only', async () => {
  // Pre-flight: skip if Java I2P is not up (cross-platform hazard to start
  // the router from inside the test — see Task 17 brief point 4).
  const i2pUp = await probeI2CP();
  test.skip(!i2pUp, [
    `Java I2P not reachable on ${I2CP_HOST}:${I2CP_PORT}.`,
    'Install: sudo ./.github/scripts/setup-linux-i2p.sh',
    'Start:   i2prouter-nowrapper   (Ubuntu) or ~/.i2p/run.sh (Debian)',
    'Verify:  nc -z 127.0.0.1 7654',
  ].join('\n'));

  const handle = await launchElectron();

  try {
    const { page } = handle;

    // Verify the IPC plumbing + main-process I2CP TCP probe work end-to-end.
    const available = await page.evaluate(async () => {
      const api = (globalThis as unknown as { electronAPI: ElectronRendererAPI }).electronAPI;
      return (await api.i2pInvoke('isAvailable')) as { available: boolean };
    });
    expect(available.available, 'i2pInvoke(isAvailable) must report available=true').toBe(true);

    // Probe start() — same Phase-2 sentinel contract as Task 17.
    const startResult = await page.evaluate(
      async ({ host, port }) => {
        const api = (globalThis as unknown as { electronAPI: ElectronRendererAPI }).electronAPI;
        const r = await api.i2pInvoke('start', { host, port });
        return r as { b32Address: string };
      },
      { host: I2CP_HOST, port: I2CP_PORT },
    );
    expect(startResult.b32Address, 'start() must return a string b32Address').toEqual(expect.any(String));

    if (startResult.b32Address === B32_PLACEHOLDER) {
      // Documented Phase-2 stub contract — fail with a pointer, never
      // pretend the placeholder is a real b32 by relaxing the regex.
      throw new Error([
        'I2CPSocketManager.initialize() is a Phase-2 stub — the b32Address',
        'returned by i2pInvoke(start) is the literal placeholder sentinel,',
        'NOT a real b32. The full I2CP CreateSessionMessage /',
        'SessionStatusMessage handshake is a Phase-2 follow-up.',
        'See electron/src/i2p/i2cp-socket-manager.ts:94-96.',
      ].join(' '));
    }
    expect(startResult.b32Address).toMatch(B32_WIRE_FORMAT);
  } finally {
    await handle.close();
  }
});

/* ----------------------------------------------------------------------------
 * Test #2 — DevBridge reachability.
 * Cheap precondition: confirm an Android device is attached AND the bridge
 * is listening on the expected host port. Skips cleanly when no device is
 * attached — that's the normal developer-machine case.
 * --------------------------------------------------------------------------*/
test('Android DevBridge reachable via adb forward', async () => {
  const devices = listAdbDevices().devices.filter((d) => d.state === 'device');
  test.skip(devices.length === 0, [
    'No Android device attached (`adb devices` returned no `device`-state rows).',
    'Plug in A50 (or any Test-Mode-enabled APK) and re-run.',
    'To enable Test-Mode, set localStorage `secuchat_test_mode=1` via',
    'webview_devtools_remote CDP and reload — see',
    '~/.claude/skills/secuchat-dev-bridge/SKILL.md.',
  ].join('\n'));

  // Pick the first attached device — the cord can pin a specific serial
  // via SECUCHAT_BRIDGE_PORT_<SERIAL> if multi-device setups need routing.
  const serial = devices[0]!.serial;
  const hostPort = resolveDevBridgeHostPort(serial);

  // Set up adb forward (idempotent). If the forward already exists for a
  // different serial, that's fine — only the host port we're testing matters.
  const fwdOk = adbForwardDevBridge(hostPort, serial);
  expect(fwdOk, `adb forward tcp:${hostPort} tcp:8888 must succeed for ${serial}`).toBe(true);

  // GET /health via our no-dep HTTP helper. Timeout is 2 s — the bridge
  // should answer immediately if listening.
  const healthy = await devbridgeHealthCheck(hostPort);
  expect(
    healthy,
    [
      `DevBridge /health on http://127.0.0.1:${hostPort} must return { ok: true, running: true }`,
      `for device ${serial}. If false:`,
      '  1. Confirm the APK is installed and Test-Mode is enabled',
      '     (localStorage secuchat_test_mode=1).',
      '  2. Confirm `adb -s <serial> forward --list` shows the mapping.',
      '  3. Try `adb -s <serial> forward --remove tcp:' + hostPort + '` and re-add.',
    ].join('\n'),
  ).toBe(true);
});

/* ----------------------------------------------------------------------------
 * Test #3 — Cross-platform chat (Linux → A50).
 *
 * test.skip() BY DESIGN with the Phase-2 blocker reason. When Phase-2
 * lands and `start()` returns a real b32, un-skip and replace this block
 * with the roundtrip body:
 *
 *   const handle = await launchElectron();
 *   try {
 *     const { page } = handle;
 *     const linux = await page.evaluate(async () => {
 *       const api = (globalThis as unknown as { electronAPI: ElectronRendererAPI }).electronAPI;
 *       return (await api.i2pInvoke('start', { host: '127.0.0.1', port: 7654 })) as { b32Address: string };
 *     });
 *     expect(linux.b32Address).toMatch(B32_WIRE_FORMAT);
 *     // Linux → Android: import linux.b32Address as A50 contact (via DevBridge),
 *     // open chat, send message, verify A50 stores incoming message.
 *     // Android → Linux: export A50 b32 via DevBridge, import on Linux,
 *     // send, verify Linux receives (decrypted).
 *   } finally {
 *     await handle.close();
 *   }
 * --------------------------------------------------------------------------*/
test.skip('Linux Electron ↔ Android A50 bidirectional chat', async () => {
  // Body intentionally empty — see the docstring above. The skip-reason
  // string is the deliverable for today.
  test.skip(true, PHASE2_BLOCKER_REASON);
});