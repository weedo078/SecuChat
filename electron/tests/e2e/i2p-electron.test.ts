/**
 * SecuChat Electron Desktop E2E — Java I2P (I2CP) roundtrip.
 *
 * What this verifies:
 *   1. The Electron main process probes 127.0.0.1:7654 successfully.
 *   2. The renderer can call `electronAPI.i2pInvoke('start', …)` and receive
 *      a string back via the full preload → main → I2PPlugin → I2CPSocketManager
 *      pipeline (no exception, no silent hang).
 *   3. After start, the `i2pStatus` event reports `connected: true`.
 *
 * Phase-2 limitation (documented in Task 5/6):
 *   `I2CPSocketManager.initialize()` is a TCP-only stub — the I2CP
 *   CreateSessionMessage / SessionStatusMessage handshake is a Phase-2
 *   follow-up. The returned `b32Address` is therefore the literal sentinel
 *   `'placeholder-b32-will-be-set-by-i2p-router'`. Once the real handshake
 *   lands, this test can assert the full b32 wire pattern. Today it asserts
 *   the placeholder contract and surfaces the limitation as a `test.fail()`
 *   with a follow-up pointer — never a green pass against a fake b32.
 *
 * Pre-flight (Task 17 brief point 4):
 *   Tests probe 127.0.0.1:7654 first and `test.skip()` with a documented
 *   error if Java I2P is not running. We do NOT attempt to start the router
 *   from inside the test — cross-platform hazard between Debian and Ubuntu.
 *
 * Running locally on the Linux test host:
 *   cd electron && npx playwright test tests/e2e/i2p-electron.test.ts
 *
 * Requires:
 *   - Java I2P installed and reachable on 127.0.0.1:7654 (I2CP port)
 *   - Built renderer (app/dist/index.html, from `cd app && npm run build`)
 *   - Built main process (electron/dist/main.js, from `cd electron && npm run build`)
 */
import { test, expect } from '@playwright/test';
import { probeI2CP, I2CP_HOST, I2CP_PORT, B32_PLACEHOLDER, B32_WIRE_FORMAT } from './_helpers/probeI2CP';
import { launchElectron } from './_helpers/electron-app';

/**
 * Renderer-side view of the IPC bridge surface. Mirrors electron/src/preload.ts.
 * The `i2pInvoke`/`onI2pEvent` shape matches the actual IPC contract.
 */
interface ElectronRendererAPI {
  i2pInvoke(method: string, ...args: unknown[]): Promise<unknown>;
  onI2pEvent(event: string, cb: (data: unknown) => void): () => void;
}

test('SecuChat Electron connects to Java I2P via I2CP', async () => {
  // Pre-flight: skip with documented message if Java I2P is not up.
  // We intentionally do NOT start the router from the test (cross-platform
  // hazard between Debian and Ubuntu; see Task 17 brief point 4).
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

    // 1. Renderer asks the main process to probe I2CP availability.
    const available = await page.evaluate(async () => {
      const api = (globalThis as unknown as { electronAPI: ElectronRendererAPI }).electronAPI;
      return (await api.i2pInvoke('isAvailable')) as { available: boolean };
    });
    expect(available.available, 'i2pInvoke(isAvailable) must report available=true').toBe(true);

    // 2. Renderer asks the main process to open a new I2CP session against
    //    the local Java I2P router. Validate the IPC plumbing returns a
    //    string-shaped b32Address — either the placeholder sentinel (current
    //    Phase-2 stub) or a fully-formed b32 wire address (post-handshake).
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
      // Phase-2 stub contract: TCP connect OK, but b32 not yet derived from
      // a real I2CP handshake. Fail the test with a documented message —
      // do NOT pretend it's a real b32 by relaxing the regex (would mask
      // regressions when the handshake lands and produces something that
      // isn't a valid b32).
      throw new Error([
        'I2CPSocketManager.initialize() is a Phase-2 stub — the b32Address',
        'returned by i2pInvoke(start) is the literal placeholder sentinel,',
        'NOT a real b32. The full I2CP CreateSessionMessage /',
        'SessionStatusMessage handshake is a Phase-2 follow-up.',
        'See electron/src/i2p/i2cp-socket-manager.ts:94-96.',
      ].join(' '));
    }
    expect(startResult.b32Address).toMatch(B32_WIRE_FORMAT);

    // 3. Subscribe to the i2pStatus event so we observe the `connected: true`
    //    broadcast emitted by `I2PPlugin.start()`.
    const statusPromise = page.evaluate(
      () =>
        new Promise<{ connected: boolean; b32Address?: string }>((res) => {
          const api = (globalThis as unknown as { electronAPI: ElectronRendererAPI }).electronAPI;
          const unsubscribe = api.onI2pEvent('i2pStatus', (raw) => {
            const ev = raw as { connected?: boolean; b32Address?: string };
            if (ev.connected === true) {
              unsubscribe();
              res({ connected: true, b32Address: ev.b32Address });
            }
          });
        }),
    );

    // Race the status observation against a 10s budget. i2pStatus events
    // are emitted synchronously by `I2PPlugin.start()`, so this normally
    // resolves within a few hundred ms.
    const connected = await Promise.race<
      { connected: boolean; b32Address?: string } | 'timeout'
    >([
      statusPromise,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 10_000)),
    ]);

    expect(connected, 'i2pStatus must report connected=true within 10s after start()').not.toBe('timeout');
    if (connected !== 'timeout') {
      expect(connected.connected).toBe(true);
    }
  } finally {
    await handle.close();
  }
});