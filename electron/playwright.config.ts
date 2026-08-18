import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the SecuChat Electron Desktop E2E suite.
 *
 * We do NOT use `webServer` because the system-under-test is the Electron app
 * itself (no external HTTP server). The launch happens inside the test via
 * `_electron.launch({ args: ['dist/main.js'] })`.
 *
 * Project notes:
 *   - Headless: Playwright's _electron launcher is headless by default.
 *   - No `npx playwright install chromium` is required for Electron tests;
 *     Playwright re-uses the local `electron` binary from package.json.
 *   - The renderer-under-test must be the BUILT `app/dist/` (Task 16's
 *     `npm run build` produces it). main.ts loads it via `app.isPackaged`
 *     toggle; running electron from the project root resolves to
 *     `electron/dist/main.js` which loads `app/dist/index.html`.
 *
 * Pre-flight (Task 17 brief point 4):
 *   Tests check `127.0.0.1:7654` reachability themselves and `test.skip()`
 *   with a documented error if Java I2P is not running. The test does NOT
 *   attempt to start the router (cross-platform hazard).
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.test\.ts$/,
  // Single worker: each test launches its own Electron instance and we don't
  // want concurrent sessions hammering the same I2CP socket.
  workers: 1,
  // Generous timeout — Electron cold-start + I2CP session handshake can take
  // 10-15s on a cold cache. The 30s default is too tight.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: './test-results',
  // Suppress the "install browsers" prompt — we don't need a browser for
  // Electron tests, so Playwright's "missing deps" detection should not fire.
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});