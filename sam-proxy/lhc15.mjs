/**
 * lhc15: full headless pattern with SESSION CREATE after HELLO REPLY
 */
import { WebSocket } from '/home/g/dev/SecuChat/sam-proxy/node_modules/ws/wrapper.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = path.join(os.homedir(), '.secuchat-linux');
const PRIV = fs.readFileSync(path.join(HOME, 'destination.priv'), 'utf8').trim();
const B32 = fs.readFileSync(path.join(HOME, 'destination.b32'), 'utf8').trim();

console.log(`[lhc15] Starting, b32=${B32.substring(0, 30)}`);

const ctl = new WebSocket('ws://127.0.0.1:7657');
let ctlBuf = '';
const sessionId = `lhc15-${Date.now()}`;

ctl.on('open', () => {
  console.log('[lhc15] CTRL WS open');
  ctl.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
});

ctl.on('message', (data) => {
  ctlBuf += data.toString();
  let nl;
  while ((nl = ctlBuf.indexOf('\n')) !== -1) {
    const line = ctlBuf.substring(0, nl).trim();
    ctlBuf = ctlBuf.substring(nl + 1);
    if (!line) continue;
    console.log(`[lhc15 CTRL] ${line.substring(0, 100)}`);
    if (line.startsWith('HELLO REPLY')) {
      console.log('[lhc15] sending SESSION CREATE');
      ctl.send(`SESSION CREATE STYLE=STREAM ID=${sessionId} DESTINATION=${PRIV} SIGNATURE_TYPE=EdDSA_SHA512_Ed25519\n`);
    }
  }
});

ctl.on('error', (e) => console.error('[lhc15] error:', e.message));
ctl.on('close', () => { console.log('[lhc15] closed'); process.exit(0); });

setTimeout(() => process.exit(0), 8000);