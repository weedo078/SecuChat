import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { existsSync, mkdirSync, cpSync } from 'fs';
import net from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import { autoUpdater } from 'electron-updater';

// ─── State ────────────────────────────────────────────────────────────────────

let i2pdProcess: ChildProcess | null = null;
let samProxyWss: WebSocketServer | null = null;
let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ─── Paths ────────────────────────────────────────────────────────────────────

// electron-builder (asar:false) places files relative to resources/app/:
//   dist/**/*            → resources/app/          (main.js, preload.js)
//   ../app/dist  to:app  → resources/app/app/       (index.html, assets)
//   ../resources/i2pd to:i2pd → resources/app/i2pd/ (i2pd binary)
const APP_ROOT = app.isPackaged ? join(process.resourcesPath, 'app') : null;

const I2PD_BINARY = app.isPackaged
  ? join(APP_ROOT!, 'i2pd', process.platform === 'win32' ? 'win/i2pd.exe' : 'linux/i2pd')
  : join(__dirname, '../../resources/i2pd', process.platform === 'win32' ? 'win/i2pd.exe' : 'linux/i2pd');

const I2PD_CERTS_SRC = app.isPackaged
  ? join(APP_ROOT!, 'i2pd', 'certificates')
  : join(__dirname, '../../resources/i2pd/certificates');

const APP_DIST = app.isPackaged
  ? join(APP_ROOT!, 'app')
  : join(__dirname, '../../app/dist');

// ─── Utilities ────────────────────────────────────────────────────────────────

function waitForPort(port: number, timeoutMs = 30000): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('error', () => { socket.destroy(); retry(); });
      socket.on('timeout', () => { socket.destroy(); retry(); });
      socket.connect(port, '127.0.0.1');
    }
    function retry() {
      if (Date.now() >= deadline) { resolve(false); return; }
      setTimeout(attempt, 500);
    }
    attempt();
  });
}

// ─── i2pd setup ───────────────────────────────────────────────────────────────

function setupI2pdDataDir(dataDir: string) {
  const certsDir = join(dataDir, 'certificates');
  if (!existsSync(certsDir) && existsSync(I2PD_CERTS_SRC)) {
    mkdirSync(dataDir, { recursive: true });
    cpSync(I2PD_CERTS_SRC, certsDir, { recursive: true });
    console.log('[Main] Copied i2pd certificates to', certsDir);
  }
}

// ─── i2pd ─────────────────────────────────────────────────────────────────────

async function isI2pdRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(7656, '127.0.0.1');
  });
}

async function startI2pd(): Promise<boolean> {
  if (await isI2pdRunning()) {
    console.log('[Main] i2pd already running (external)');
    return true;
  }

  if (!existsSync(I2PD_BINARY)) {
    console.warn('[Main] No bundled i2pd found at', I2PD_BINARY);
    console.warn('[Main] Please run i2pd manually: i2pd --sam.enabled=true');
    return false;
  }

  const dataDir = join(app.getPath('userData'), 'i2pd');
  setupI2pdDataDir(dataDir);
  console.log('[Main] Starting bundled i2pd...');

  i2pdProcess = spawn(I2PD_BINARY, [
    '--datadir', dataDir,
    // SAM for SecuChat
    '--sam.enabled', 'true',
    '--sam.address', '127.0.0.1',
    '--sam.port', '7656',
    // Web console for debugging
    '--http.enabled', 'true',
    '--http.address', '127.0.0.1',
    '--http.port', '7070',
    // Disable unused services
    '--httpproxy.enabled', 'false',
    '--socksproxy.enabled', 'false',
    '--bob.enabled', 'false',
    '--i2cp.enabled', 'false',
    // Network configuration
    '--upnp.enabled', 'true',
    '--nat', 'true',
    // Bandwidth for faster tunnel building
    '--bandwidth', '256',
    // Participate in network (helps with connectivity)
    '--share', '10',
    // Enable floodfill for better routing (if resources allow)
    '--floodfill', 'false',
  ], { detached: false, windowsHide: true });

  i2pdProcess.stdout?.on('data', (d) => console.log('[i2pd]', d.toString().trim()));
  i2pdProcess.stderr?.on('data', (d) => console.log('[i2pd]', d.toString().trim()));
  i2pdProcess.on('exit', (code) => {
    console.log(`[Main] i2pd exited (code ${code})`);
    i2pdProcess = null;
  });

  // Wait up to 20s for i2pd to open SAM port (Windows can be slow)
  const ready = await waitForPort(7656, 20000);
  console.log('[Main] i2pd SAM port ready:', ready);
  return ready;
}

function stopI2pd() {
  if (i2pdProcess) {
    console.log('[Main] Stopping i2pd...');
    i2pdProcess.kill();
    i2pdProcess = null;
  }
}

// ─── SAM Proxy (inline) ───────────────────────────────────────────────────────

const SAM_PROXY_WS_PORT = 7657;
const SAM_PROXY_SAM_HOST = '127.0.0.1';
const SAM_PROXY_SAM_PORT = 7656;
const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

function startSamProxy(): Promise<void> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: SAM_PROXY_WS_PORT, host: '127.0.0.1' });
    samProxyWss = wss;

    wss.on('listening', () => {
      console.log(`[SAM-Proxy] Listening on ws://127.0.0.1:${SAM_PROXY_WS_PORT}`);
      resolve();
    });

    wss.on('error', (err) => {
      console.error('[SAM-Proxy] Server error:', err.message);
      reject(err);
    });

    wss.on('connection', (ws, req) => {
      console.log(`[SAM-Proxy] Client connected from ${req.socket.remoteAddress}`);
      const tcp = new net.Socket();
      let tcpConnected = false;
      let pendingMessages: string[] = [];
      let buffer = '';

      tcp.connect(SAM_PROXY_SAM_PORT, SAM_PROXY_SAM_HOST, () => {
        tcpConnected = true;
        console.log('[SAM-Proxy] Connected to i2pd SAM');
        // Flush any messages that arrived while connecting
        for (const msg of pendingMessages) {
          tcp.write(msg);
        }
        pendingMessages = [];
      });

      tcp.on('data', (data) => {
        buffer += data.toString('utf-8');
        if (buffer.length > MAX_BUFFER_SIZE) {
          console.error('[SAM-Proxy] Buffer overflow, closing');
          tcp.destroy();
          if (ws.readyState === WebSocket.OPEN) { ws.close(); }
          return;
        }
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim() && ws.readyState === WebSocket.OPEN) {
            ws.send(line);
          }
        }
      });

      tcp.on('error', (err) => {
        console.error('[SAM-Proxy] TCP error:', err.message);
        tcp.destroy();
        pendingMessages = [];
        if (ws.readyState === WebSocket.OPEN) { ws.close(); }
      });

      tcp.on('close', () => {
        tcpConnected = false;
        pendingMessages = [];
        if (ws.readyState === WebSocket.OPEN) { ws.close(); }
      });

      ws.on('message', (data) => {
        const msg = data.toString();
        const formattedMsg = msg.endsWith('\n') ? msg : msg + '\n';
        if (!tcpConnected) {
          // Buffer messages until TCP is connected
          pendingMessages.push(formattedMsg);
          return;
        }
        tcp.write(formattedMsg);
      });

      ws.on('close', () => {
        pendingMessages = [];
        tcp.destroy();
      });
      ws.on('error', () => {
        pendingMessages = [];
        tcp.destroy();
      });
    });
  });
}

function stopSamProxy() {
  if (samProxyWss) {
    samProxyWss.close();
    samProxyWss = null;
    console.log('[Main] SAM proxy stopped');
  }
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'SecuChat',
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
    mainWindow.loadFile(join(APP_DIST, 'index.html'));
  }

  // Open external links in system browser, not in app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  console.log('[Main] App ready, starting services...');

  // Always start SAM proxy first - it handles i2pd not being ready gracefully.
  // If i2pd isn't up yet, the TCP connection inside the proxy will fail and the
  // WebSocket will be closed; the renderer retries every 30s automatically.
  try {
    await startSamProxy();
  } catch (err: any) {
    if (err?.code === 'EADDRINUSE') {
      console.warn('[Main] SAM proxy port 7657 already in use (previous instance still running?)');
    } else {
      console.error('[Main] SAM proxy failed to start:', err);
    }
  }

  // Start i2pd in background - doesn't block the window or the SAM proxy.
  startI2pd().then(ok => {
    if (!ok) console.warn('[Main] i2pd not running - I2P features unavailable until it starts.');
  }).catch(err => console.error('[Main] i2pd startup error:', err));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopSamProxy();
  stopI2pd();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopSamProxy();
  stopI2pd();
});

// ─── Auto-Updater ─────────────────────────────────────────────────────────────

// Configure auto-updater to use GitHub releases
autoUpdater.autoDownload = false; // We'll ask user first
autoUpdater.autoInstallOnAppQuit = true;

// Check for updates (called from renderer)
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

// Auto-update event handlers
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

// IPC handlers for auto-updater
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

// ─── IPC ─────────────────────────────────────────────────────────────────────

ipcMain.handle('i2p:status', async () => ({
  i2pdRunning: await isI2pdRunning(),
  samProxyRunning: samProxyWss !== null,
}));

// Check for updates on startup (after 10s delay)
app.whenReady().then(() => {
  setTimeout(() => {
    checkForUpdates();
  }, 10000);
});
