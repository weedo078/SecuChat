// ============================================================================
// I2P-KONNEKTIVITÄT - VOLLSTÄNDIGE LÖSUNG FÜR SECUCHAT
// ============================================================================

import { app } from 'electron';
import { spawn, ChildProcess } from 'child_process';
import { join, normalize, dirname } from 'path';
import { existsSync, mkdirSync, copyFileSync, chmodSync, createWriteStream, readdirSync, statSync } from 'fs';
import net from 'net';

// ============================================================================
// KONFIGURATION
// ============================================================================

interface I2PConfig {
  samPort: number;
  httpPort: number;
  samHost: string;
  httpHost: string;
  dataDir: string;
  logDir: string;
  startupTimeout: number;
  portCheckInterval: number;
  maxPortCheckAttempts: number;
}

const DEFAULT_CONFIG: I2PConfig = {
  samPort: 7656,
  httpPort: 7070,
  samHost: '127.0.0.1',
  httpHost: '127.0.0.1',
  dataDir: join(app.getPath('userData'), 'i2pd'),
  logDir: join(app.getPath('userData'), 'logs'),
  startupTimeout: 45000,        // Erhoeht auf 45 Sekunden fuer ersten Start
  portCheckInterval: 500,       // Alle 500ms pruefen
  maxPortCheckAttempts: 90,     // 90 * 500ms = 45 Sekunden
};

// ============================================================================
// PFAD-RESOLVER - ROBUSTE PFAD-ERMITTLUNG
// ============================================================================

/**
 * Ermittelt das App-Root-Verzeichnis fuer verschiedene Umgebungen
 */
function getAppRoot(): string {
  // Fuer entpackte Apps (Production)
  if (app.isPackaged) {
    const possiblePaths = [
      join(process.resourcesPath, 'app.asar.unpacked'),
      join(process.resourcesPath, 'app'),
      process.resourcesPath,
    ];
    
    for (const path of possiblePaths) {
      if (existsSync(path)) {
        return path;
      }
    }
    return process.resourcesPath;
  }
  
  // Fuer Development
  return join(__dirname, '../..');
}

/**
 * Ermittelt den Pfad zur i2pd-Binary
 */
function getI2pdBinaryPath(): string {
  const appRoot = getAppRoot();
  const platform = process.platform;
  
  const binaryName = platform === 'win32' ? 'i2pd.exe' : 'i2pd';
  const platformDir = platform === 'win32' ? 'win' : 'linux';
  
  const possiblePaths = [
    join(appRoot, 'i2pd', platformDir, binaryName),
    join(appRoot, 'i2pd', binaryName),
    join(__dirname, '../../resources/i2pd', platformDir, binaryName),
    join(__dirname, '../resources/i2pd', platformDir, binaryName),
  ];
  
  for (const path of possiblePaths) {
    const normalizedPath = normalize(path);
    if (existsSync(normalizedPath)) {
      return normalizedPath;
    }
  }
  
  return normalize(possiblePaths[0]);
}

/**
 * Ermittelt den Pfad zu den i2pd-Zertifikaten
 */
function getI2pdCertsPath(): string {
  const appRoot = getAppRoot();
  
  const possiblePaths = [
    join(appRoot, 'i2pd', 'certificates'),
    join(__dirname, '../../resources/i2pd/certificates'),
    join(__dirname, '../resources/i2pd/certificates'),
  ];
  
  for (const path of possiblePaths) {
    const normalizedPath = normalize(path);
    if (existsSync(normalizedPath)) {
      return normalizedPath;
    }
  }
  
  return normalize(possiblePaths[0]);
}

// ============================================================================
// I2P MANAGER KLASSE
// ============================================================================

export class I2PManager {
  private process: ChildProcess | null = null;
  private config: I2PConfig;
  private logStream: ReturnType<typeof createWriteStream> | null = null;
  private isShuttingDown = false;

  constructor(config: Partial<I2PConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Startet i2pd und wartet auf SAM-Port-Verfuegbarkeit
   */
  async start(): Promise<boolean> {
    console.log('[I2P] Starting I2P manager...');
    
    if (await this.isPortOpen(this.config.samPort)) {
      console.log('[I2P] External i2pd detected on SAM port');
      return true;
    }

    if (this.process && !this.process.killed) {
      console.log('[I2P] i2pd already running (managed)');
      return true;
    }

    const binaryPath = getI2pdBinaryPath();
    
    if (!existsSync(binaryPath)) {
      console.error('[I2P] Binary not found at:', binaryPath);
      return false;
    }

    if (!this.setupDataDirectory()) {
      return false;
    }

    if (process.platform !== 'win32') {
      this.ensureExecutable(binaryPath);
    }

    if (!await this.spawnProcess(binaryPath)) {
      return false;
    }

    const ready = await this.waitForSamPort();
    
    if (ready) {
      console.log('[I2P] i2pd is ready and accepting SAM connections');
    } else {
      console.error('[I2P] i2pd failed to start within timeout');
      await this.stop();
    }
    
    return ready;
  }

  /**
   * Stoppt i2pd-Prozess
   */
  async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log('[I2P] Stopping i2pd...');

    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }

    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      if (!this.process.killed) {
        this.process.kill('SIGKILL');
      }
      
      this.process = null;
    }

    this.isShuttingDown = false;
    console.log('[I2P] i2pd stopped');
  }

  /**
   * Prueft ob SAM-Port erreichbar ist
   */
  async isReady(): Promise<boolean> {
    return this.isPortOpen(this.config.samPort);
  }

  /**
   * Gibt SAM-Verbindungsinformationen zurueck
   */
  getSamInfo(): { host: string; port: number } {
    return {
      host: this.config.samHost,
      port: this.config.samPort,
    };
  }

  private setupDataDirectory(): boolean {
    try {
      const dirs = [
        this.config.dataDir,
        join(this.config.dataDir, 'certificates'),
        this.config.logDir,
      ];
      
      for (const dir of dirs) {
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      }

      const certsSrc = getI2pdCertsPath();
      const certsDest = join(this.config.dataDir, 'certificates');
      
      if (existsSync(certsSrc)) {
        this.copyCertificates(certsSrc, certsDest);
      }

      return true;
    } catch (error) {
      console.error('[I2P] Failed to setup data directory:', error);
      return false;
    }
  }

  private copyCertificates(src: string, dest: string): void {
    try {
      const items = readdirSync(src);
      
      for (const item of items) {
        const srcPath = join(src, item);
        const destPath = join(dest, item);
        const stat = statSync(srcPath);
        
        if (stat.isDirectory()) {
          if (!existsSync(destPath)) {
            mkdirSync(destPath, { recursive: true });
          }
          this.copyCertificates(srcPath, destPath);
        } else {
          copyFileSync(srcPath, destPath);
        }
      }
    } catch (error) {
      console.error('[I2P] Failed to copy certificates:', error);
    }
  }

  private ensureExecutable(binaryPath: string): void {
    try {
      chmodSync(binaryPath, 0o755);
    } catch (error) {
      console.warn('[I2P] Could not set executable permission:', error);
    }
  }

  private async spawnProcess(binaryPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const logPath = join(this.config.logDir, 'i2pd.log');
      try {
        this.logStream = createWriteStream(logPath, { flags: 'a' });
        this.logStream.write(`\n\n=== i2pd started at ${new Date().toISOString()} ===\n`);
      } catch (error) {
        console.warn('[I2P] Could not create log file:', error);
      }

      const args = [
        '--datadir', this.config.dataDir,
        '--sam.enabled', 'true',
        '--sam.address', this.config.samHost,
        '--sam.port', this.config.samPort.toString(),
        '--http.enabled', 'true',
        '--http.address', this.config.httpHost,
        '--http.port', this.config.httpPort.toString(),
        '--httpproxy.enabled', 'false',
        '--socksproxy.enabled', 'false',
        '--bob.enabled', 'false',
        '--i2cp.enabled', 'false',
        '--upnp.enabled', 'true',
        '--nat', 'true',
        '--bandwidth', '256',
        '--share', '10',
        '--floodfill', 'false',
        '--log', 'info',
        '--logfile', join(this.config.logDir, 'i2pd-internal.log'),
      ];

      console.log('[I2P] Spawning process:', binaryPath);

      this.process = spawn(binaryPath, args, {
        detached: false,
        windowsHide: true,
        cwd: dirname(binaryPath),
      });

      this.process.on('error', (error) => {
        console.error('[I2P] Process error:', error);
        this.logStream?.write(`ERROR: ${error.message}\n`);
        resolve(false);
      });

      this.process.stdout?.on('data', (data) => {
        const line = data.toString().trim();
        console.log('[i2pd]', line);
        this.logStream?.write(`[stdout] ${line}\n`);
      });

      this.process.stderr?.on('data', (data) => {
        const line = data.toString().trim();
        console.log('[i2pd]', line);
        this.logStream?.write(`[stderr] ${line}\n`);
      });

      this.process.on('exit', (code, signal) => {
        console.log(`[I2P] Process exited (code: ${code}, signal: ${signal})`);
        this.logStream?.write(`EXIT: code=${code}, signal=${signal}\n`);
        this.process = null;
      });

      setTimeout(() => {
        if (this.process && !this.process.killed) {
          resolve(true);
        } else {
          resolve(false);
        }
      }, 1000);
    });
  }

  private async waitForSamPort(): Promise<boolean> {
    console.log('[I2P] Waiting for SAM port...');
    
    for (let attempt = 0; attempt < this.config.maxPortCheckAttempts; attempt++) {
      if (await this.isPortOpen(this.config.samPort)) {
        console.log(`[I2P] SAM port ready after ${attempt + 1} attempts`);
        return true;
      }
      
      if (!this.process || this.process.killed) {
        console.error('[I2P] Process died while waiting for SAM port');
        return false;
      }
      
      await this.sleep(this.config.portCheckInterval);
    }
    
    return false;
  }

  private isPortOpen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.connect(port, this.config.samHost);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

let i2pManager: I2PManager | null = null;

export function getI2PManager(): I2PManager {
  if (!i2pManager) {
    i2pManager = new I2PManager();
  }
  return i2pManager;
}

export async function startI2pd(): Promise<boolean> {
  return getI2PManager().start();
}

export async function stopI2pd(): Promise<void> {
  return getI2PManager().stop();
}

export async function isI2pReady(): Promise<boolean> {
  return getI2PManager().isReady();
}
