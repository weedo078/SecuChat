/**
 * Shared Electron Page-Object-Model for E2E tests.
 *
 * Wraps Playwright's `_electron.launch()` with the environment overrides
 * proven necessary in Task 17:
 *   - ELECTRON_RUN_AS_NODE must be unset (some shells export it globally
 *     and `--no-sandbox` would be misinterpreted as a Node flag).
 *   - ELECTRON_DISABLE_SANDBOX=1 mirrors `--no-sandbox` for modern Electron
 *     without adding it to argv.
 *
 * The POM exposes a minimal surface (`launchElectron`, `close`, `page`) so
 * tests can stay focused on assertions, not lifecycle plumbing.
 *
 * Pre-flight / skip semantics are NOT in this file — tests should call
 * `probeI2CP()` from `_helpers/probeI2CP.ts` and decide themselves.
 */
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as path from 'node:path';

export interface LaunchElectronOpts {
  /** Path to the built main.js (default: `<electron>/dist/main.js`). */
  args?: string[];
  /** Working directory for the launched process. Default: `<electron>/`. */
  cwd?: string;
  /** Additional env vars to merge on top of process.env. */
  env?: Record<string, string | undefined>;
}

export interface ElectronAppHandle {
  app: ElectronApplication;
  page: Page;
  close(): Promise<void>;
}

/**
 * Default env for Electron E2E. Sets `ELECTRON_DISABLE_SANDBOX=1` and
 * clears `ELECTRON_RUN_AS_NODE` to avoid the global-sysadmin trap.
 *
 * Spread before user-supplied `env` so callers can override anything.
 */
export function defaultElectronEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: undefined,
    ELECTRON_DISABLE_SANDBOX: '1',
    ...extra,
  };
}

/**
 * Launch the built Electron app and return the first renderer Page after
 * the preload bridge (`globalThis.electronAPI`) is wired. Caller is
 * responsible for closing via the returned `close()`.
 */
export async function launchElectron(opts: LaunchElectronOpts = {}): Promise<ElectronAppHandle> {
  // This file lives at `electron/tests/e2e/_helpers/electron-app.ts`.
  // The Electron binary should be launched from `electron/`, so the cwd
  // is 3 dirs up from `__dirname` (helpers → e2e → tests → electron).
  const defaultCwd = path.resolve(__dirname, '..', '..', '..');
  const app = await electron.launch({
    args: opts.args ?? ['dist/main.js'],
    cwd: opts.cwd ?? defaultCwd,
    env: defaultElectronEnv(opts.env),
  });
  const page: Page = await app.firstWindow();

  // Wait for the preload bridge before returning — otherwise callers that
  // try to call electronAPI.i2pInvoke() throw "undefined is not a function".
  await page.waitForFunction(
    () => Boolean((globalThis as unknown as { electronAPI?: unknown }).electronAPI),
    undefined,
    { timeout: 15_000 },
  );

  return {
    app,
    page,
    async close(): Promise<void> {
      await app.close();
    },
  };
}