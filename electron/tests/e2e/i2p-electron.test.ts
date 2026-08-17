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
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as net from 'node:net';

const I2CP_HOST = '127.0.0.1';
const I2CP_PORT = 7654;

/** Sentinel b32 returned by `I2CPSocketManager.initialize()` until the
 *  full I2CP CreateSessionMessage / SessionStatusMessage handshake lands. */
const B32_PLACEHOLDER = 'placeholder-b32-will-be-set-by-i2p-router';
/** Full I2P b32 wire format — 52 chars of lowercase base32 alphabet + `.b32.i2p`. */
const B32_WIRE_FORMAT = /^[a-z2-7]{52}\.b32\.i2p$/;

/**
 * Cheap TCP-probe to verify Java I2P's I2CP port is listening BEFORE we
 * spend 10s launching Electron. Mirrors `I2PPlugin.isI2pAvailable()` but
 * with a 1s budget so a hung port fails fast.
 */
function probeI2CP(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(I2CP_PORT, I2CP_HOST);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1_000);
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

  let app: ElectronApplication | undefined;

  try {
    // Launch the BUILT Electron app (Task 16 produced dist/main.js).
    // cwd must be `electron/` so main.js can resolve `../../app/dist` for the
    // renderer (matches `APP_DIST` in main.ts).
    //
    // IMPORTANT env overrides:
    //   - ELECTRON_RUN_AS_NODE must be unset: when set, the Electron binary
    //     acts as plain Node and ignores Chromium flags like --no-sandbox
    //     that Playwright injects on Linux. Some test harnesses export
    //     this var globally (e.g. VS Code shells). Spread process.env
    //     and explicitly delete the key.
    //   - ELECTRON_DISABLE_SANDBOX=1 mirrors Playwright's --no-sandbox
    //     switch without adding it to argv (Electron 42 reads it).
    app = await electron.launch({
      args: ['dist/main.js'],
      cwd: __dirname + '/../..',
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        ELECTRON_DISABLE_SANDBOX: '1',
      },
    });
    const page: Page = await app.firstWindow();

    // Wait for the renderer to wire its preload bridge; otherwise
    // `globalThis.electronAPI` is undefined and the calls below throw.
    await page.waitForFunction(
      () => Boolean((globalThis as unknown as { electronAPI?: unknown }).electronAPI),
      undefined,
      { timeout: 15_000 },
    );

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
    await app?.close();
  }
});