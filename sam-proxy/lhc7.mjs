/**
 * lhc7: same as lhc6, but REMOVE the [CTRL] log prefix from message handler
 * (use the same prefix that lhc5 uses — LINE:)
 */
import { WebSocket } from '/home/g/dev/SecuChat/sam-proxy/node_modules/ws/wrapper.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = path.join(os.homedir(), '.secuchat-linux');
const PRIV = fs.readFileSync(path.join(HOME, 'destination.priv'), 'utf8').trim();
const B32 = fs.readFileSync(path.join(HOME, 'destination.b32'), 'utf8').trim();

console.log(`[lhc7] Starting`);

const ctl = new WebSocket('ws://127.0.0.1:7657');
let ctlBuf = '';

ctl.on('open', () => {
  console.log('[lhc7] CTRL WS open');
  ctl.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
});

ctl.on('message', async (data) => {
  console.log('[lhc7] MSG RX:', data.toString().substring(0, 80));
  ctlBuf += data.toString();
  let nl;
  while ((nl = ctlBuf.indexOf('\n')) !== -1) {
    const line = ctlBuf.substring(0, nl).trim();
    ctlBuf = ctlBuf.substring(nl + 1);
    if (!line) continue;
    console.log(`[lhc7] LINE: ${line.substring(0, 200)}`);
  }
});

ctl.on('error', (e) => console.error('[lhc7] error:', e.message));
ctl.on('close', () => { console.log('[lhc7] closed'); process.exit(0); });

setTimeout(() => process.exit(0), 5000);