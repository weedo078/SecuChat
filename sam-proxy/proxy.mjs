#!/usr/bin/env node
/**
 * SAM WebSocket-to-TCP Proxy
 *
 * Bridges browser WebSocket connections to the i2pd SAM TCP interface.
 * Run this alongside i2pd so the browser app can communicate with SAM.
 *
 * Usage:
 *   node proxy.mjs [--ws-port 7657] [--sam-host 127.0.0.1] [--sam-port 7656]
 */

import { WebSocketServer } from 'ws';
import net from 'net';

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const WS_PORT = parseInt(getArg('--ws-port', '7657'));
const SAM_HOST = getArg('--sam-host', '127.0.0.1');
const SAM_PORT = parseInt(getArg('--sam-port', '7656'));
const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB max buffer size

let wss = null;
let serverActive = false;

function startServer() {
  if (serverActive) return;
  
  wss = new WebSocketServer({ port: WS_PORT });

  console.log(`[SAM-Proxy] WebSocket server listening on ws://127.0.0.1:${WS_PORT}`);
  console.log(`[SAM-Proxy] Forwarding to SAM at ${SAM_HOST}:${SAM_PORT}`);

  wss.on('connection', (ws, req) => {
    console.log(`[SAM-Proxy] New WebSocket connection from ${req.socket.remoteAddress}`);

    const tcp = new net.Socket();
    let tcpConnected = false;
    let buffer = '';

    tcp.connect(SAM_PORT, SAM_HOST, () => {
      tcpConnected = true;
      console.log('[SAM-Proxy] Connected to SAM bridge');
    });

    // TCP → WebSocket: forward SAM responses to browser
    tcp.on('data', (data) => {
      const text = data.toString('utf-8');
      buffer += text;

      // Check buffer size limit to prevent memory exhaustion attacks
      if (buffer.length > MAX_BUFFER_SIZE) {
        console.error('[SAM-Proxy] Buffer size exceeded limit, closing connection');
        tcp.destroy();
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ error: 'Buffer overflow', message: 'Response too large' }));
          ws.close();
        }
        return;
      }

      // SAM protocol uses \n as message delimiter
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          if (ws.readyState === ws.OPEN) {
            ws.send(line);
          }
        }
      }
    });

    tcp.on('error', (err) => {
      console.error('[SAM-Proxy] TCP error:', err.message);
      tcp.destroy();
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ error: 'SAM connection error', message: err.message }));
        ws.close();
      }
    });

    tcp.on('close', () => {
      tcpConnected = false;
      console.log('[SAM-Proxy] TCP connection closed');
      if (ws.readyState === ws.OPEN) {
        ws.close();
      }
    });

    // WebSocket → TCP: forward browser commands to SAM
    ws.on('message', (data) => {
      if (!tcpConnected) {
        console.warn('[SAM-Proxy] TCP not connected, dropping message');
        return;
      }
      const message = data.toString();
      // Ensure newline-terminated for SAM protocol
      tcp.write(message.endsWith('\n') ? message : message + '\n');
    });

    ws.on('close', () => {
      console.log('[SAM-Proxy] WebSocket closed');
      tcp.destroy();
    });

    ws.on('error', (err) => {
      console.error('[SAM-Proxy] WebSocket error:', err.message);
      tcp.destroy();
    });
  });

  wss.on('error', (err) => {
    console.error('[SAM-Proxy] Server error:', err.message);
    serverActive = false;
    
    // Graceful recovery: try to restart server after delay
    setTimeout(() => {
      console.log('[SAM-Proxy] Attempting to restart server...');
      try {
        wss.close();
      } catch {
        // Ignore close errors
      }
      startServer();
    }, 5000);
  });
  
  serverActive = true;
  console.log(`[SAM-Proxy] Server started successfully`);
}

// Start server initially
startServer();

process.on('SIGINT', () => {
  console.log('\n[SAM-Proxy] Shutting down...');
  serverActive = false;
  if (wss) {
    wss.close();
  }
  process.exit(0);
});
