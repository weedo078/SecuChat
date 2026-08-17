import { app, BrowserWindow, ipcMain, shell, dialog, protocol, session } from 'electron';
import { join, normalize } from 'path';
import { existsSync } from 'fs';
import { autoUpdater } from 'electron-updater';
import { I2PPlugin } from './i2p/i2p-plugin';
import {
  I2P_EVENT_NAMES,
  parseCloseOpts,
  parseConnectToOpts,
  parseSendOpts,
  parseStartOpts,
  type I2PEventName,
} from './i2p/ipc-validators';
import { registerStorageIpcHandlers, unregisterStorageIpcHandlers } from './storage';

// ─── State ────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
const i2pStatus = {
  isRunning: false,
  isReady: false,
  error: null as string | null,
};

/**
 * Push the current I2P status to every renderer.
 *
 * Channel is `i2p:event:i2pStatus`, NOT the legacy `i2p:status`. The preload
 * bridge (Task 8) only forwards `i2p:event:<name>` channels through
 * `onI2pEvent`, so a send on `i2p:status` would be silently undeliverable.
 *
 * Broadcasting to all windows (rather than `mainWindow` only) keeps this
 * consistent with the plugin event forwarding below; the app is
 * single-window today but `app.on('activate')` can create more.
 */
function broadcastI2pStatus(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('i2p:event:i2pStatus', { ...i2pStatus });
  }
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ─── Protocol Registration ────────────────────────────────────────────────────
// Must be done before app is ready

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } },
]);

// ─── Paths ────────────────────────────────────────────────────────────────────

const APP_DIST = app.isPackaged
  ? join(process.resourcesPath, 'app')
  : join(__dirname, '../../app/dist');
console.log('[Main] APP_DIST:', APP_DIST, '(isPackaged:', app.isPackaged, ')');

// Verify index.html exists
const indexHtmlPath = join(APP_DIST, 'index.html');
if (!existsSync(indexHtmlPath)) {
  console.error('[Main] CRITICAL: index.html not found at:', indexHtmlPath);
} else {
  console.log('[Main] index.html found at:', indexHtmlPath);
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'SecuChat',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    // Only open DevTools with explicit --devtools flag or OPEN_DEVTOOLS=1 env var
    if (process.argv.includes('--devtools') || process.env.OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    const indexPath = join(APP_DIST, 'index.html');
    console.log('[Main] Loading file:', indexPath);
    mainWindow.loadFile(indexPath).catch((err) => {
      console.error('[Main] Failed to load index.html:', err);
      dialog.showErrorBox('Loading Error', `Failed to load app: ${err.message}`);
    });
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[Main] Failed to load:', errorCode, errorDescription);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    broadcastI2pStatus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── I2P Initialization ───────────────────────────────────────────────────────

/**
 * I2CP endpoint of the locally-installed I2P router. SecuChat attaches to an
 * existing router rather than bundling one; 7654 is the I2CP default for both
 * Java I2P and i2pd.
 */
const I2CP_HOST = '127.0.0.1';
const I2CP_PORT = 7654;
const I2CP_NICKNAME = 'SecuChat';

/**
 * Probe for a local I2P router and, if present, open the I2CP session.
 *
 * Unlike the previous i2pd-based flow, SecuChat no longer spawns or bundles a
 * router: it attaches to an externally-managed Java I2P instance on
 * 127.0.0.1:7654 (installed via electron/scripts/setup-i2p.{sh,ps1}). The
 * cheap `isI2pAvailable()` TCP probe runs first so a missing router yields a
 * fast, actionable error instead of an I2CP handshake timeout.
 */
async function initializeI2P(): Promise<boolean> {
  console.log('[Main] Probing I2P router availability...');
  const plugin = I2PPlugin.getInstance();

  const { available } = await plugin.isI2pAvailable();
  if (!available) {
    console.warn('[Main] I2P router not available on 127.0.0.1:7654');
    i2pStatus.isRunning = false;
    i2pStatus.isReady = false;
    i2pStatus.error = 'I2P-Router nicht erreichbar. Installiere Java I2P via setup-i2p.sh/ps1';
    broadcastI2pStatus();
    return false;
  }

  try {
    const { b32Address } = await plugin.start({ host: I2CP_HOST, port: I2CP_PORT, nickname: I2CP_NICKNAME });
    i2pStatus.isRunning = true;
    i2pStatus.isReady = true;
    i2pStatus.error = null;
    console.log('[Main] I2P session established, b32:', b32Address);
    broadcastI2pStatus();
    return true;
  } catch (error) {
    i2pStatus.isRunning = false;
    i2pStatus.isReady = false;
    i2pStatus.error = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Main] I2P initialization error:', error);
    broadcastI2pStatus();
    return false;
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

// Ensure userData is in a persistent location (not temp/portable mode)
const userDataPath = join(app.getPath('appData'), 'SecuChat');
app.setPath('userData', userDataPath);
console.log('[Main] userData path:', userDataPath);
console.log('[Main] App path:', app.getAppPath());
console.log('[Main] Exec path:', process.execPath);
console.log('[Main] isPackaged:', app.isPackaged);
console.log('[Main] CWD:', process.cwd());

app.whenReady().then(async () => {
  console.log('[Main] App ready, starting services...');

  // Register storage IPC handlers
  registerStorageIpcHandlers();

  // Register custom protocol handler
  const protocolRegistered = protocol.registerFileProtocol('app', (request, callback) => {
    const url = request.url.replace(/^app:\/\//, ''); // strip 'app://'
    const filePath = normalize(join(APP_DIST, url || 'index.html'));
    console.log('[Main] Protocol request:', request.url, '->', filePath, 'exists:', existsSync(filePath));
    callback({ path: filePath });
  });
  console.log('[Main] Registered app:// protocol:', protocolRegistered, 'serving from:', APP_DIST);

  // Attach to the locally-installed I2P router (no bundled daemon to spawn).
  const i2pSuccess = await initializeI2P();

  if (!i2pSuccess) {
    const isWindows = process.platform === 'win32';
    const setupScript = isWindows ? 'electron\\scripts\\setup-i2p.ps1' : 'electron/scripts/setup-i2p.sh';
    const detailMsg =
      'SecuChat will start, but I2P connectivity will not work until a router is reachable.\n\n' +
      `SecuChat connects to an I2P router's I2CP port on ${I2CP_HOST}:${I2CP_PORT}. ` +
      'It does not bundle or start a router itself.\n\n' +
      'Try:\n' +
      `1. Install a router with ${setupScript}\n` +
      '2. Make sure the router is running and fully started\n' +
      `3. Confirm I2CP is enabled and listening on ${I2CP_HOST}:${I2CP_PORT}\n\n` +
      `Details: ${i2pStatus.error ?? 'unknown error'}`;

    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'I2P Warning',
      message: 'Could not reach an I2P router',
      detail: detailMsg,
      buttons: ['Continue', 'Exit'],
      defaultId: 0,
    });

    if (result.response === 1) {
      app.quit();
      return;
    }
  }

  // Set CSP header for all requests
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:7657 http://127.0.0.1:7070; media-src 'self' blob:; worker-src 'self' blob:"
        ]
      }
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/**
 * Tear down the I2CP session. Safe to call repeatedly: `window-all-closed`
 * and `before-quit` both fire during a normal quit, and `I2PPlugin.disconnect`
 * no-ops once `socketManager` is null. Errors are logged rather than thrown so
 * a failed teardown cannot block app exit.
 */
async function shutdownI2P(): Promise<void> {
  try {
    await I2PPlugin.getInstance().disconnect();
  } catch (error) {
    console.error('[Main] I2P disconnect failed:', error);
  }
}

app.on('window-all-closed', async () => {
  console.log('[Main] All windows closed');
  unregisterStorageIpcHandlers();
  await shutdownI2P();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  console.log('[Main] Before quit');
  unregisterStorageIpcHandlers();
  await shutdownI2P();
});

// ─── Auto-Updater ─────────────────────────────────────────────────────────────

// Note: Updates are verified via SHA-512 hash from latest.yml by electron-updater.
// For full security, code signing should be enabled to ensure latest.yml itself
// hasn't been tampered with: https://www.electron.build/code-signing
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.forceDevUpdateConfig = true; // Allow update testing in dev mode

function checkForUpdates(): void {
  if (isDev) {
    console.log('[Auto-Update] Skipped in development mode');
    return;
  }
  console.log('[Auto-Update] Checking for updates...');

  // Timeout safety: if check takes longer than 30s, force completion
  const timeout = setTimeout(() => {
    console.warn('[Auto-Update] Check timed out after 30s');
    mainWindow?.webContents.send('update:not-available');
  }, 30000);

  autoUpdater.checkForUpdates()
    .then((result) => {
      clearTimeout(timeout);
      console.log('[Auto-Update] Check completed:', result ? 'Update found' : 'No update');
    })
    .catch(err => {
      clearTimeout(timeout);
      const message = err.message || '';
      // Ignore 404s - no release yet or no update available
      if (message.includes('404') || message.includes('latest.yml')) {
        console.log('[Auto-Update] No update available (404)');
        mainWindow?.webContents.send('update:not-available');
        return;
      }
      console.error('[Auto-Update] Check failed:', err);
      mainWindow?.webContents.send('update:error', message);
    });
}

autoUpdater.on('checking-for-update', () => {
  console.log('[Auto-Update] Checking for update...');
  mainWindow?.webContents.send('update:checking');
});

autoUpdater.on('update-available', (info) => {
  console.log('[Auto-Update] Update available:', info.version);
  mainWindow?.webContents.send('update:available', {
    version: info.version,
    releaseDate: info.releaseDate,
  });
});

autoUpdater.on('update-not-available', () => {
  console.log('[Auto-Update] No updates available');
  mainWindow?.webContents.send('update:not-available');
});

autoUpdater.on('error', (err) => {
  // Ignore 404 errors - means no update is available or release doesn't have latest.yml yet
  const message = err.message || '';
  if (message.includes('404') || message.includes('latest.yml')) {
    console.log('[Auto-Update] No update channel available (404)');
    return;
  }
  console.error('[Auto-Update] Error:', err);
  mainWindow?.webContents.send('update:error', err.message);
});

autoUpdater.on('download-progress', (progress) => {
  console.log(`[Auto-Update] Download progress: ${progress.percent.toFixed(1)}%`);
  mainWindow?.webContents.send('update:progress', {
    percent: progress.percent,
    speed: progress.bytesPerSecond,
  });
});

autoUpdater.on('update-downloaded', (info) => {
  // Verify update integrity: electron-updater already validates sha512 from latest.yml,
  // but we log it explicitly for auditability
  if (info.sha512) {
    console.log('[Auto-Update] Update hash verified (sha512):', info.sha512.substring(0, 16) + '...');
  } else {
    console.warn('[Auto-Update] No SHA-512 hash in update metadata — integrity cannot be verified');
  }

  console.log('[Auto-Update] Update downloaded, ready to install');
  mainWindow?.webContents.send('update:downloaded', {
    version: info.version,
  });
});

// ─── IPC ─────────────────────────────────────────────────────────────────────

// Auto-updater IPC
ipcMain.handle('update:check', () => {
  checkForUpdates();
});

ipcMain.handle('update:download', async () => {
  console.log('[Auto-Update] Starting download...');
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    console.error('[Auto-Update] Download failed:', err);
    return { success: false, error: (err as Error).message };
  }
});

ipcMain.handle('update:install', () => {
  console.log('[Auto-Update] Quitting and installing update...');
  autoUpdater.quitAndInstall();
});

// ─── I2P IPC ─────────────────────────────────────────────────────────────────
//
// One handler per channel in `ALLOWED_I2P_CHANNELS` (electron/src/preload.ts).
// The preload allowlist gates *which* channel a renderer may invoke; the
// `parse*Opts` validators gate the *shape* of the payload. Both are required:
// IPC arguments are fully renderer-controlled, so an unvalidated `opts` would
// let a compromised renderer smuggle arbitrary fields into the plugin.
//
// A validator throwing inside an `ipcMain.handle` callback rejects the
// renderer's promise, surfacing as a normal Error at the `i2pInvoke` call site.
//
// NOTE: the legacy `i2p:status` and `i2p:restart` handlers were removed here.
// Both were i2pd-era and unreachable — neither appears in the preload
// allowlist (so `i2pInvoke` rejects them) and a repo-wide grep found no
// callers. Status is now *pushed* on `i2p:event:i2pStatus` instead. Restoring
// a pull-based status query would need a preload allowlist entry as well.

const i2pPlugin = I2PPlugin.getInstance();

ipcMain.handle('i2p:start', (_event, opts: unknown) => i2pPlugin.start(parseStartOpts(opts)));
ipcMain.handle('i2p:connectTo', (_event, opts: unknown) => i2pPlugin.connectTo(parseConnectToOpts(opts)));
ipcMain.handle('i2p:acceptIncoming', () => i2pPlugin.acceptIncoming());
ipcMain.handle('i2p:send', (_event, opts: unknown) => i2pPlugin.send(parseSendOpts(opts)));
ipcMain.handle('i2p:close', (_event, opts: unknown) => i2pPlugin.close(parseCloseOpts(opts)));
ipcMain.handle('i2p:disconnect', () => i2pPlugin.disconnect());
ipcMain.handle('i2p:getB32Address', () => i2pPlugin.getB32Address());
ipcMain.handle('i2p:isAvailable', () => i2pPlugin.isI2pAvailable());

/** Broadcast one plugin event to every live renderer as `i2p:event:<name>`. */
function broadcastI2pEvent(eventName: I2PEventName, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(`i2p:event:${eventName}`, data);
  }
}

/**
 * Bridge one plugin event channel onto the IPC bus.
 *
 * `subscribe` is the plugin's own `onI2pXxx` method, so `T` is inferred from
 * that method's callback signature — no cast and no dynamic `plugin[...]`
 * indexing, which means renaming a plugin method is a compile error here
 * rather than a silent runtime no-op.
 */
function forwardI2pEvent<T>(eventName: I2PEventName, subscribe: (cb: (data: T) => void) => () => void): void {
  subscribe((data) => broadcastI2pEvent(eventName, data));
}

/**
 * Registering as a `Record<I2PEventName, …>` makes coverage exhaustive: adding
 * a name to `I2P_EVENT_NAMES` without wiring it here fails the type check.
 */
function registerI2pEventForwarding(): void {
  const forwarders: Record<I2PEventName, () => void> = {
    i2pStatus: () => forwardI2pEvent('i2pStatus', (cb) => i2pPlugin.onI2pStatus(cb)),
    i2pMessage: () => forwardI2pEvent('i2pMessage', (cb) => i2pPlugin.onI2pMessage(cb)),
    i2pStreamConnected: () => forwardI2pEvent('i2pStreamConnected', (cb) => i2pPlugin.onI2pStreamConnected(cb)),
    i2pStreamClosed: () => forwardI2pEvent('i2pStreamClosed', (cb) => i2pPlugin.onI2pStreamClosed(cb)),
  };
  for (const eventName of I2P_EVENT_NAMES) {
    forwarders[eventName]();
  }
}

// Registered at module scope so the forwarders are attached before
// `initializeI2P()` runs inside `app.whenReady()` and can therefore observe
// the `i2pStatus` event emitted by `plugin.start()`.
//
// Residual bootstrap race (Phase-4 follow-up): `I2PPlugin`'s ring buffer
// guarantees delivery to a late-attaching *main-process* listener, but a
// forwarded event is dropped if no renderer has loaded yet — `webContents.send`
// to a window whose preload has not run has no receiver. In practice only
// `i2pStatus` can fire that early (start() precedes createWindow()), and the
// `ready-to-show` hook re-pushes it via `broadcastI2pStatus()`. Stream events
// cannot precede a window because they require a renderer-initiated
// `i2p:connectTo`.
registerI2pEventForwarding();

// Check for updates on startup (after 5s delay)
app.whenReady().then(() => {
  setTimeout(() => {
    checkForUpdates();
  }, 5000);
});

// ─── Error Handling ───────────────────────────────────────────────────────────

process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error);
  shutdownI2P().finally(() => {
    dialog.showErrorBox(
      'Fatal Error',
      `An unexpected error occurred:\n${error.message}\n\nThe application will now exit.`
    );
    app.quit();
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Unhandled rejection at:', promise, 'reason:', reason);
});
