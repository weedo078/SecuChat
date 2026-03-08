import { app, BrowserWindow, ipcMain, shell, dialog, protocol } from 'electron';
import { join } from 'path';
import { autoUpdater } from 'electron-updater';
import { startI2pd, stopI2pd, isI2pReady, getI2PManager } from './i2p-manager';
import { startSamProxy, stopSamProxy } from './sam-proxy';

// ─── State ────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let i2pStatus = {
  isRunning: false,
  isReady: false,
  error: null as string | null,
};

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ─── Protocol Registration ────────────────────────────────────────────────────
// Must be done before app is ready

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, supportFetchAPI: true } },
]);

// ─── Paths ────────────────────────────────────────────────────────────────────

const APP_DIST = app.isPackaged
  ? join(process.resourcesPath, 'app')
  : join(__dirname, '../../app/dist');

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
      sandbox: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL('app://index.html');
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.webContents.send('i2p:status', i2pStatus);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── I2P Initialization ───────────────────────────────────────────────────────

async function initializeI2P(): Promise<boolean> {
  console.log('[Main] Initializing I2P...');

  try {
    const success = await startI2pd();

    if (success) {
      i2pStatus.isRunning = true;
      i2pStatus.isReady = true;
      console.log('[Main] I2P initialized successfully');
      return true;
    } else {
      i2pStatus.isRunning = false;
      i2pStatus.isReady = false;
      i2pStatus.error = 'Failed to start i2pd';
      console.error('[Main] I2P initialization failed');
      return false;
    }
  } catch (error) {
    i2pStatus.isRunning = false;
    i2pStatus.isReady = false;
    i2pStatus.error = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Main] I2P initialization error:', error);
    return false;
  }
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

// Register custom protocol handler (must be before app.whenReady)
app.on('ready', () => {
  protocol.registerFileProtocol('app', (request, callback) => {
    const url = request.url.substr(6); // strip 'app://'
    callback({ path: join(APP_DIST, url) });
  });
});

// Ensure userData is in a persistent location (not temp/portable mode)
const userDataPath = join(app.getPath('appData'), 'SecuChat');
app.setPath('userData', userDataPath);
console.log('[Main] userData path:', userDataPath);

app.whenReady().then(async () => {
  console.log('[Main] App ready, starting services...');

  // Starte SAM Proxy zuerst (für I2P-Kommunikation)
  try {
    await startSamProxy();
    console.log('[Main] SAM Proxy started');
  } catch (err: any) {
    console.error('[Main] SAM Proxy failed to start:', err);
    // Nicht blockieren - App kann trotzdem ohne I2P laufen
  }

  // Starte i2pd
  const i2pSuccess = await initializeI2P();

  if (!i2pSuccess) {
    const isWindows = process.platform === 'win32';
    let detailMsg = 'SecuChat will start, but I2P connectivity may not work.\n\n';
    
    if (isWindows) {
      detailMsg += 'Possible causes on Windows:\n' +
                   '• Antivirus software blocking i2pd.exe\n' +
                   '• Windows Defender preventing execution\n' +
                   '• Missing write permissions to %appdata%\n\n' +
                   'Try:\n' +
                   '1. Add SecuChat to antivirus exclusions\n' +
                   '2. Run as Administrator\n' +
                   '3. Check Windows Event Viewer for errors';
    } else {
      detailMsg += 'Please check the logs or try restarting the application.';
    }
    
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'I2P Warning',
      message: 'Could not start I2P daemon',
      detail: detailMsg,
      buttons: ['Continue', 'Exit'],
      defaultId: 0,
    });

    if (result.response === 1) {
      app.quit();
      return;
    }
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  console.log('[Main] All windows closed');
  await stopSamProxy();
  await stopI2pd();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  console.log('[Main] Before quit');
  await stopSamProxy();
  await stopI2pd();
});

// ─── Auto-Updater ─────────────────────────────────────────────────────────────

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function checkForUpdates(): void {
  if (isDev) {
    console.log('[Auto-Update] Skipped in development mode');
    return;
  }
  console.log('[Auto-Update] Checking for updates...');
  autoUpdater.checkForUpdates().catch(err => {
    console.error('[Auto-Update] Check failed:', err);
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

// I2P IPC
ipcMain.handle('i2p:status', async () => ({
  ...i2pStatus,
  isReady: await isI2pReady(),
  samInfo: getI2PManager().getSamInfo(),
}));

ipcMain.handle('i2p:restart', async () => {
  console.log('[Main] Restarting I2P...');
  await stopI2pd();
  const success = await initializeI2P();
  mainWindow?.webContents.send('i2p:status', i2pStatus);
  return success;
});

// Check for updates on startup (after 10s delay)
app.whenReady().then(() => {
  setTimeout(() => {
    checkForUpdates();
  }, 10000);
});

// ─── Error Handling ───────────────────────────────────────────────────────────

process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error);
  stopI2pd().finally(() => {
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
