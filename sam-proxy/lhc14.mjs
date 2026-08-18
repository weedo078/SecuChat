/**
 * lhc14: like lhc13 + while loop with local buf variable
 */
import { WebSocket } from '/home/g/dev/SecuChat/sam-proxy/node_modules/ws/wrapper.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = path.join(os.homedir(), '.secuchat-linux');
const B32 = fs.readFileSync(path.join(HOME, 'destination.b32'), 'utf8').trim();

console.log(`[lhc14] Starting`);

const ctl = new WebSocket('ws://127.0.0.1:7657');

ctl.on('open', () => {
  console.log('[lhc14] CTRL WS open');
  ctl.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
});

ctl.on('message', (data) => {
  console.log('[lhc14] MSG RX');
  let buf = '';
  buf += data.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.substring(0, nl).trim();
    buf = buf.substring(nl + 1);
    if (!line) continue;
    console.log(`[lhc14] line: ${line}`);
  }
});

ctl.on('error', (e) => console.error('[lhc14] error:', e.message));
ctl.on('close', () => { console.log('[lhc14] closed'); process.exit(0); });

setTimeout(() => process.exit(0), 5000);