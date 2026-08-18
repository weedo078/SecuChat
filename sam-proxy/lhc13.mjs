/**
 * lhc13: like lhc12 but NO ctlBuf / while loop — just log raw data
 */
import { WebSocket } from '/home/g/dev/SecuChat/sam-proxy/node_modules/ws/wrapper.mjs';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = path.join(os.homedir(), '.secuchat-linux');
const B32 = fs.readFileSync(path.join(HOME, 'destination.b32'), 'utf8').trim();

console.log(`[lhc13] Starting`);

const ctl = new WebSocket('ws://127.0.0.1:7657');

ctl.on('open', () => {
  console.log('[lhc13] CTRL WS open');
  ctl.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
});

ctl.on('message', (data) => {
  console.log('[lhc13] MSG RX raw bytes len:', data.toString().length);
  console.log('[lhc13] MSG RX content:', JSON.stringify(data.toString()));
});

ctl.on('error', (e) => console.error('[lhc13] error:', e.message));
ctl.on('close', () => { console.log('[lhc13] closed'); process.exit(0); });

setTimeout(() => process.exit(0), 5000);