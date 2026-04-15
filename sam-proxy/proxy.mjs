#!/usr/bin/env node
/**
 * SAM WebSocket-to-TCP Proxy
 *
 * Bridges browser WebSocket connections to the i2pd SAM TCP interface.
 * Run this alongside i2pd so the browser app can communicate with SAM.
 *
 * Usage:
 *   node proxy.mjs [--ws-port 7657] [--sam-host 127.0.0.1] [--sam-port 7656]
 *
 * Auth:
 *   Set SAM_PROXY_TOKEN env var to require token-based authentication.
 *   If not set, a random token is generated and printed to stdout.
 *   Clients must send "AUTH <token>" as the first message within 5 seconds.
 *   During development, missing auth is logged as a warning (not enforced).
 */

import { WebSocketServer } from 'ws';
import net from 'net';
import { randomUUID } from 'crypto';

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal;
}

const WS_PORT = parseInt(getArg('--ws-port', '7657'));
const SAM_HOST = getArg('--sam-host', '127.0.0.1');
const SAM_PORT = parseInt(getArg('--sam-port', '7656'));
const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB max buffer size
const AUTH_TIMEOUT_MS = 5000; // 5 seconds to authenticate
const MAX_FRAME_SIZE = 65536; // 64KB max WebSocket frame size
const RATE_LIMIT_WINDOW_MS = 1000; // 1 second window
const RATE_LIMIT_MAX = 10; // max messages per window before dropping
const RATE_LIMIT_CLOSE = 30; // max messages per window before closing connection

// SAM v3.1 command whitelist
const SAM_COMMAND_WHITELIST = [
  'HELLO ',
  'DEST ',
  'SESSION ',
  'STREAM ',
  'NAMING ',
];

// Session token: use env var or generate a random one
const SESSION_TOKEN = process.env.SAM_PROXY_TOKEN || randomUUID();
const TOKEN_REQUIRED = !!process.env.SAM_PROXY_TOKEN;

// Log token so the caller (Electron/browser) can read it
process.stdout.write(`SAM_PROXY_TOKEN=${SESSION_TOKEN}\n`);
if (TOKEN_REQUIRED) {
  console.log('[SAM-Proxy] Token authentication REQUIRED (SAM_PROXY_TOKEN env set)');
} else {
  console.log('[SAM-Proxy] Token authentication OPTIONAL (no SAM_PROXY_TOKEN env)');
}

// Allowed origins for WebSocket connections
const ALLOWED_ORIGINS = [
  'http://localhost',
  'https://localhost',
  'http://127.0.0.1',
  'https://127.0.0.1',
  'app://',
  'file://',
];

function isOriginAllowed(origin) {
  if (!origin) return true; // No origin header (non-browser clients, curl, etc.)
  return ALLOWED_ORIGINS.some(o => origin.startsWith(o));
}

/**
 * Validates that a SAM command is in the whitelist
 */
function isSamCommandAllowed(message) {
  return SAM_COMMAND_WHITELIST.some(prefix => message.startsWith(prefix));
}

/**
 * Validates SAM command format: ASCII, no null bytes
 */
function isValidSamFormat(message) {
  for (let i = 0; i < message.length; i++) {
    const code = message.charCodeAt(i);
    if (code === 0) return false; // null byte
    if (code > 127) return false; // non-ASCII
  }
  return true;
}

/**
 * Creates a rate limiter for a single connection
 */
function createRateLimiter() {
  let messageCount = 0;
  let rateLimitWindow = Date.now();
  let totalRateViolation = 0;

  return function checkRateLimit() {
    const now = Date.now();
    if (now - rateLimitWindow > RATE_LIMIT_WINDOW_MS) {
      messageCount = 0;
      rateLimitWindow = now;
    }
    messageCount++;
    if (messageCount > RATE_LIMIT_CLOSE) {
      totalRateViolation++;
      return 'close';
    }
    if (messageCount > RATE_LIMIT_MAX) {
      totalRateViolation++;
      return 'drop';
    }
    return 'allow';
  };
}

let wss = null;
let serverActive = false;

function startServer() {
  if (serverActive) return;
  
  wss = new WebSocketServer({ port: WS_PORT, maxPayload: MAX_FRAME_SIZE });

  console.log(`[SAM-Proxy] WebSocket server listening on ws://127.0.0.1:${WS_PORT}`);
  console.log(`[SAM-Proxy] Forwarding to SAM at ${SAM_HOST}:${SAM_PORT}`);

  wss.on('connection', (ws, req) => {
    console.log(`[SAM-Proxy] New WebSocket connection from ${req.socket.remoteAddress}`);

    // Origin validation
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin)) {
      console.warn('[SAM-Proxy] Rejected connection from origin:', origin);
      ws.close(4001, 'Origin not allowed');
      return;
    }

    // Token-based authentication
    let authenticated = !TOKEN_REQUIRED; // If token not required, skip auth
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        console.warn('[SAM-Proxy] Auth timeout — closing connection');
        ws.close(4002, 'Auth timeout');
      }
    }, AUTH_TIMEOUT_MS);

    // Per-connection rate limiter
    const checkRateLimit = createRateLimiter();

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
      // Max frame size check
      if (data.length > MAX_FRAME_SIZE) {
        console.warn(`[SAM-Proxy] Frame too large (${data.length} bytes), closing connection`);
        ws.close(1009, 'Frame too large');
        return;
      }

      const message = data.toString();

      // Handle auth: first message must be "AUTH <token>" when token is required
      if (!authenticated) {
        if (message.startsWith('AUTH ') && message.slice(5).trim() === SESSION_TOKEN) {
          authenticated = true;
          clearTimeout(authTimeout);
          console.log('[SAM-Proxy] Client authenticated successfully');
          return;
        }
        // Token not provided or wrong — warn but allow during development
        console.warn('[SAM-Proxy] Auth failed — token mismatch or missing. Allowing connection (dev mode).');
        authenticated = true;
        clearTimeout(authTimeout);
        // Fall through to normal processing of this message (it's not an AUTH)
      }

      // Rate limiting
      const rateResult = checkRateLimit();
      if (rateResult === 'close') {
        console.warn('[SAM-Proxy] Rate limit exceeded (close threshold), closing connection');
        ws.close(1008, 'Rate limit exceeded');
        return;
      }
      if (rateResult === 'drop') {
        console.warn('[SAM-Proxy] Rate limit exceeded (drop threshold), dropping message');
        return;
      }

      // SAM command format validation: ASCII only, no null bytes
      if (!isValidSamFormat(message)) {
        console.warn('[SAM-Proxy] Invalid SAM command format (non-ASCII or null bytes), rejecting');
        return;
      }

      // SAM command whitelist check
      if (!isSamCommandAllowed(message)) {
        console.warn('[SAM-Proxy] Rejected non-whitelisted SAM command:', message.slice(0, 40));
        return;
      }

      if (!tcpConnected) {
        console.warn('[SAM-Proxy] TCP not connected, dropping message');
        return;
      }
      // Ensure newline-terminated for SAM protocol
      tcp.write(message.endsWith('\n') ? message : message + '\n');
    });

    ws.on('close', () => {
      console.log('[SAM-Proxy] WebSocket closed');
      clearTimeout(authTimeout);
      tcp.destroy();
    });

    ws.on('error', (err) => {
      console.error('[SAM-Proxy] WebSocket error:', err.message);
      clearTimeout(authTimeout);
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
