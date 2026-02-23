/**
 * SAM PROXY - WebSocket zu TCP Bridge für I2P SAM Verbindungen
 * 
 * Ermöglicht der Electron-App über WebSocket mit dem i2pd SAM-Port zu kommunizieren.
 * WebSocket (Renderer) ←→ SAM Proxy (Main) ←→ TCP (i2pd SAM)
 */

import { WebSocketServer, WebSocket, RawData } from 'ws';
import * as net from 'net';

// WebSocket readyState Konstanten
const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSING = 2;
const WS_CLOSED = 3;

// Konfiguration
const SAM_PROXY_WS_PORT = 7657;
const SAM_PROXY_SAM_HOST = '127.0.0.1';
const SAM_PROXY_SAM_PORT = 7656;
const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_PENDING_MESSAGES = 100; // Schutz vor Memory-Leak
const TCP_RETRY_DELAY = 2000; // 2 Sekunden zwischen Retry-Versuchen
const TCP_MAX_RETRIES = 5; // Maximale Retry-Versuche
const WS_HEARTBEAT_INTERVAL = 30000; // 30 Sekunden Heartbeat
const CONNECTION_TIMEOUT = 10000; // 10 Sekunden Timeout für SAM-Verbindung

// Globale Referenz für Cleanup
let samProxyWss: WebSocketServer | null = null;

/**
 * Prüft ob ein Port verfügbar ist
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close();
        resolve(true);
      })
      .listen(port, '127.0.0.1');
  });
}

/**
 * Findet einen verfügbaren Port
 */
async function findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`Kein verfügbarer Port gefunden zwischen ${startPort} und ${startPort + maxAttempts - 1}`);
}

/**
 * Startet den SAM Proxy Server
 */
export async function startSamProxy(): Promise<void> {
  // Finde verfügbaren Port (für Port-Konflikt-Behandlung)
  const wsPort = await findAvailablePort(SAM_PROXY_WS_PORT);
  if (wsPort !== SAM_PROXY_WS_PORT) {
    console.log(`[SAM-Proxy] Port ${SAM_PROXY_WS_PORT} belegt, verwende stattdessen ${wsPort}`);
  }

  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: wsPort, host: '127.0.0.1' });
    samProxyWss = wss;

    wss.on('listening', () => {
      console.log(`[SAM-Proxy] Listening on ws://127.0.0.1:${wsPort}`);
      resolve();
    });

    wss.on('error', (err: any) => {
      console.error('[SAM-Proxy] Server error:', err.message);
      reject(err);
    });

    wss.on('connection', (ws: WebSocket, req) => {
      console.log(`[SAM-Proxy] Client connected from ${req.socket.remoteAddress}`);
      
      // Verbindungszustand
      let tcpConnected = false;
      let tcpDestroyed = false;
      let pendingMessages: string[] = [];
      let buffer = '';
      let tcpRetryCount = 0;
      let heartbeatInterval: NodeJS.Timeout | null = null;
      let connectionTimeout: NodeJS.Timeout | null = null;
      
      // TCP Socket für SAM-Verbindung
      let tcp: net.Socket | null = null;

      /**
       * Bereinigt alle Ressourcen
       */
      const cleanup = () => {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
          connectionTimeout = null;
        }
        if (tcp && !tcpDestroyed) {
          tcp.destroy();
          tcpDestroyed = true;
        }
        pendingMessages = [];
        buffer = '';
      };

      /**
       * Sendet Fehlermeldung an WebSocket Client
       */
      const sendError = (error: string, message: string) => {
        if (ws.readyState === WS_OPEN) {
          try {
            ws.send(JSON.stringify({ error, message }));
          } catch (e) {
            console.error('[SAM-Proxy] Failed to send error to client:', e);
          }
        }
      };

      /**
       * Verbindet zu SAM mit Retry-Logik
       */
      const connectToSam = () => {
        if (tcpDestroyed || tcpConnected) return;

        tcp = new net.Socket();
        
        // Verbindungs-Timeout
        connectionTimeout = setTimeout(() => {
          console.error('[SAM-Proxy] Connection timeout to SAM');
          tcp?.destroy();
          attemptReconnect();
        }, CONNECTION_TIMEOUT);

        tcp.connect(SAM_PROXY_SAM_PORT, SAM_PROXY_SAM_HOST, () => {
          if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            connectionTimeout = null;
          }
          
          tcpConnected = true;
          tcpRetryCount = 0;
          console.log('[SAM-Proxy] Connected to i2pd SAM');
          
          // Sende pending messages
          if (pendingMessages.length > 0) {
            console.log(`[SAM-Proxy] Sending ${pendingMessages.length} pending messages`);
            for (const msg of pendingMessages) {
              tcp?.write(msg);
            }
            pendingMessages = [];
          }

          // Starte Heartbeat
          heartbeatInterval = setInterval(() => {
            if (ws.readyState === WS_OPEN) {
              ws.ping();
            }
          }, WS_HEARTBEAT_INTERVAL);
        });

        // Buffer-Verarbeitung
        tcp.on('data', (data: Buffer) => {
          buffer += data.toString('utf-8');
          
          // Buffer-Overflow-Schutz
          if (buffer.length > MAX_BUFFER_SIZE) {
            console.error('[SAM-Proxy] Buffer overflow, closing connection');
            sendError('Buffer overflow', 'Response too large');
            cleanup();
            if (ws.readyState === WS_OPEN) {
              ws.close(1011, 'Buffer overflow');
            }
            return;
          }

          // Zeilen-basierte Verarbeitung
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // Unvollständige Zeile bleibt im Buffer
          
          for (const line of lines) {
            if (line.trim() && ws.readyState === WS_OPEN) {
              try {
                ws.send(line);
              } catch (e) {
                console.error('[SAM-Proxy] Failed to send to WebSocket:', e);
              }
            }
          }
        });

        tcp.on('error', (err: Error) => {
          console.error('[SAM-Proxy] TCP error:', err.message);
          tcpConnected = false;
          cleanup();
          attemptReconnect();
        });

        tcp.on('close', () => {
          if (tcpConnected) {
            console.log('[SAM-Proxy] TCP connection closed');
            tcpConnected = false;
            cleanup();
            
            // Informiere Client
            sendError('SAM_DISCONNECTED', 'Connection to i2pd SAM lost');
            
            if (ws.readyState === WS_OPEN) {
              ws.close(1011, 'SAM connection lost');
            }
          }
        });
      };

      /**
       * Wiederverbindungsversuch
       */
      const attemptReconnect = () => {
        if (tcpRetryCount >= TCP_MAX_RETRIES) {
          console.error(`[SAM-Proxy] Max retries (${TCP_MAX_RETRIES}) exceeded`);
          sendError('SAM_CONNECT_FAILED', `Failed to connect to SAM after ${TCP_MAX_RETRIES} attempts`);
          if (ws.readyState === WS_OPEN) {
            ws.close(1011, 'SAM connection failed');
          }
          return;
        }
        
        tcpRetryCount++;
        console.log(`[SAM-Proxy] Reconnecting to SAM (attempt ${tcpRetryCount}/${TCP_MAX_RETRIES})...`);
        setTimeout(connectToSam, TCP_RETRY_DELAY);
      };

      // Initial verbinden
      connectToSam();

      // WebSocket Event Handler
      
      ws.on('message', (data: RawData) => {
        const msg = data.toString();
        const formattedMsg = msg.endsWith('\n') ? msg : msg + '\n';
        
        if (!tcpConnected) {
          // Begrenze pending messages (Memory-Leak-Schutz)
          if (pendingMessages.length >= MAX_PENDING_MESSAGES) {
            console.error('[SAM-Proxy] Pending messages limit reached');
            sendError('PENDING_LIMIT', 'Too many messages queued, SAM not connected');
            return;
          }
          pendingMessages.push(formattedMsg);
          return;
        }
        
        try {
          tcp?.write(formattedMsg);
        } catch (e) {
          console.error('[SAM-Proxy] Failed to write to TCP:', e);
          sendError('WRITE_ERROR', 'Failed to send message to SAM');
        }
      });

      ws.on('ping', () => {
        if (ws.readyState === WS_OPEN) {
          ws.pong();
        }
      });

      ws.on('pong', () => {
        // Verbindung ist aktiv
      });

      ws.on('close', (code: number, reason: Buffer) => {
        console.log(`[SAM-Proxy] WebSocket closed: ${code} ${reason.toString()}`);
        cleanup();
      });

      ws.on('error', (err: Error) => {
        console.error('[SAM-Proxy] WebSocket error:', err.message);
        cleanup();
      });
    });
  });
}

/**
 * Stoppt den SAM Proxy Server
 */
export function stopSamProxy(): Promise<void> {
  return new Promise((resolve) => {
    if (samProxyWss) {
      console.log('[SAM-Proxy] Stopping server...');
      samProxyWss.close(() => {
        console.log('[SAM-Proxy] Server stopped');
        samProxyWss = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
