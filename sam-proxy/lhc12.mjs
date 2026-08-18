/**
 * lhc12: b32 read + ctlBuf var + sync handler
 */
import { WebSocket } from '/home/g/dev/SecuChat/sam-proxy/node_modules/ws/wrapper.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = path.join(os.homedir(), '.secuchat-linux');
const B32 = fs.readFileSync(path.join(HOME, 'destination.b32'), 'utf8').trim();

console.log(`[lhc12] Starting`);

const ctl = new WebSocket('ws://127.0.0.1:7657');
let ctlBuf = '';

ctl.on('open', () => {
  console.log('[lhc12] CTRL WS open');
  ctl.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
});

ctl.on('message', (data) => {
  ctlBuf += data.toString();
  let nl;
  while ((nl = ctlBuf.indexOf('\n')) !== -1) {
    const line = ctlBuf.substring(0, nl).trim();
    ctlBuf = ctlBuf.substring(nl + 1);
    if (!line) continue;
    console.log(`[lhc12] ${line.substring(0, 200)}`);
  }
});

ctl.on('error', (e) => console.error('[lhc12] error:', e.message));
ctl.on('close', () => { console.log('[lhc12] closed'); process.exit(0); });

setTimeout(() => process.exit(0), 5000);