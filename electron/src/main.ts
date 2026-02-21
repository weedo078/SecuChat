import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import { existsSync, mkdirSync, cpSync } from 'fs';
import net from 'net';
import { WebSocketServer, WebSocket } from 'ws';

// ─── State ────────────────────────────────────────────────────────────────────

let i2pdProcess: ChildProcess | null = null;
let samProxyWss: WebSocketServer | null = null;
let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ─── Paths ────────────────────────────────────────────────────────────────────

const I2PD_BINARY = app.isPackaged
  ? join(process.resourcesPath, 'i2pd', process.platform === 'win32' ? 'win/i2pd.exe' : 'linux/i2pd')
  : join(__dirname, '../../resources/i2pd', process.platform === 'win32' ? 'win/i2pd.exe' : 'linux/i2pd');

const I2PD_CERTS_SRC = app.isPackaged
  ? join(process.resourcesPath, 'i2pd', 'certificates')
  : join(__dirname, '../../resources/i2pd/certificates');

const APP_DIST = app.isPackaged
  ? join(process.resourcesPath, 'app')
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
    '--sam.enabled', 'true',
    '--sam.address', '127.0.0.1',
    '--sam.port', '7656',
    '--http.enabled', 'false',
    '--httpproxy.enabled', 'false',
    '--socksproxy.enabled', 'false',
    '--bob.enabled', 'false',
    '--i2cp.enabled', 'false',
    '--upnp.enabled', 'false',
    '--nat', 'true',
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
      let buffer = '';

      tcp.connect(SAM_PROXY_SAM_PORT, SAM_PROXY_SAM_HOST, () => {
        tcpConnected = true;
        console.log('[SAM-Proxy] Connected to i2pd SAM');
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
        if (ws.readyState === WebSocket.OPEN) { ws.close(); }
      });

      tcp.on('close', () => {
        tcpConnected = false;
        if (ws.readyState === WebSocket.OPEN) { ws.close(); }
      });

      ws.on('message', (data) => {
        if (!tcpConnected) return;
        const msg = data.toString();
        tcp.write(msg.endsWith('\n') ? msg : msg + '\n');
      });

      ws.on('close', () => tcp.destroy());
      ws.on('error', () => tcp.destroy());
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

  // Start i2pd (non-blocking — app still opens if i2pd fails)
  const i2pdOk = await startI2pd();
  if (!i2pdOk) {
    console.warn('[Main] i2pd not running. I2P features will be unavailable.');
  }

  // Start inline SAM proxy
  try {
    await startSamProxy();
  } catch (err) {
    console.error('[Main] SAM proxy failed to start:', err);
  }

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

// ─── IPC ─────────────────────────────────────────────────────────────────────

ipcMain.handle('i2p:status', async () => ({
  i2pdRunning: await isI2pdRunning(),
  samProxyRunning: samProxyWss !== null,
}));
