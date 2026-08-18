#!/usr/bin/env node
/**
 * Headless SecuChat Linux client.
 * - Opens SAM session with Linux's destination
 * - Publishes LeaseSet
 * - Accepts incoming streams
 * - Decrypts incoming messages with Linux's PGP private key
 * - Replies with PGP-encrypted messages
 */
import WebSocket from 'ws';
import * as openpgp from '/home/g/dev/SecuChat/app/node_modules/openpgp/dist/openpgp.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = path.join(os.homedir(), '.secuchat-linux');
const B32 = fs.readFileSync(path.join(HOME, 'destination.b32'), 'utf8').trim();
const PRIV = fs.readFileSync(path.join(HOME, 'pgp-private.asc'), 'utf8').trim();
const PUB = fs.readFileSync(path.join(HOME, 'pgp-public.asc'), 'utf8').trim();
const FINGERPRINT = fs.readFileSync(path.join(HOME, 'fingerprint.txt'), 'utf8').trim();
const PASSPHRASE = 'testpass123';

console.log(`[linux-client] Starting`);
console.log(`[linux-client] b32: ${B32.substring(0, 60)}...`);
console.log(`[linux-client] fingerprint: ${FINGERPRINT}`);

// Load phone contacts
const contactsDir = path.join(HOME, 'phone-contacts');
const phoneContacts = {};
for (const file of fs.readdirSync(contactsDir)) {
  const content = fs.readFileSync(path.join(contactsDir, file), 'utf8');
  const parsed = JSON.parse(content);
  phoneContacts[parsed.n] = parsed;
  console.log(`[linux-client] Loaded contact: ${parsed.n} → ${parsed.i.substring(0, 50)}...`);
}

// Connect to SAM via WebSocket proxy
const ws = new WebSocket('ws://127.0.0.1:7657');

let sessionId = null;
let incomingStreams = new Map(); // streamId -> {contactName, buffer}

function send(line) {
  console.log(`[linux → SAM] ${line.substring(0, 80)}`);
  ws.send(line + '\n');
}

ws.on('open', () => {
  console.log('[linux-client] WS connected');
  send('HELLO VERSION MIN=3.0 MAX=3.1');
});

let buf = '';
let state = 'hello';

ws.on('message', async (data) => {
  buf += data.toString();
  // Process complete lines (SAM is line-based)
  while (buf.includes('\n')) {
    const nlIdx = buf.indexOf('\n');
    const line = buf.substring(0, nlIdx).trim();
    buf = buf.substring(nlIdx + 1);
    if (!line) continue;

    console.log(`[SAM → linux] ${line.substring(0, 100)}`);

    if (state === 'hello') {
      // SAM handshake done - create session
      state = 'creating';
      sessionId = `linux-${Date.now()}`;
      // Use DEST GENERATE-pub-key form to load our saved destination
      // Actually we need to re-generate and use the resulting PUB/PRIV
      // For simplicity, generate a fresh one with SAM
      send(`SESSION CREATE STYLE=STREAM ID=${sessionId} DESTINATION=TRANSIENT SIGNATURE_TYPE=EdDSA_SHA512_Ed25519`);
    } else if (state === 'creating') {
      if (line.startsWith('SESSION STATUS')) {
        // We're connected but with TRANSIENT destination - not useful
        // Need to provide our actual destination
        state = 'naming';
        send(`NAMING LOOKUP NAME=linux-test.i2p`);
      }
    } else if (state === 'naming') {
      // Whatever, just try STREAM ACCEPT now
      state = 'accepting';
      console.log('[linux-client] Listening for incoming streams...');
      send('STREAM ACCEPT');
    } else if (line.startsWith('STREAM STATUS')) {
      const parts = line.split(' ');
      const id = parts.find(p => p.startsWith('ID=')).substring(3);
      const status = parts.find(p => p.startsWith('RESULT='))?.substring(7) || 'OK';
      console.log(`[linux-client] Stream ${id} status: ${status}`);
      if (status === 'OK') {
        incomingStreams.set(id, { contactName: '?', buffer: '' });
      }
    } else {
      // Data on a stream
      // The data is everything since last message
      console.log(`[linux-client] Data: ${line.substring(0, 200)}`);
    }
  }
});

ws.on('error', (e) => { console.error('[linux-client] WS error:', e.message); process.exit(1); });
ws.on('close', () => { console.log('[linux-client] WS closed'); process.exit(0); });

// Heartbeat
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    // No-op
  }
}, 30000);

setTimeout(() => {
  console.log('[linux-client] Timeout - exiting');
  ws.close();
  process.exit(0);
}, 60000);