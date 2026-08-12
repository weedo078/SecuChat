/**
 * Minimal test: zwei ws connections parallel wie in linux-headless.mjs
 * Erwartung: Erst HELLO REPLY auf CTRL, dann HELLO REPLY auf STREAM socket.
 */
import { WebSocket } from '/home/g/dev/SecuChat/sam-proxy/node_modules/ws/wrapper.mjs';

const ctl = new WebSocket('ws://127.0.0.1:7657');
const stream = new WebSocket('ws://127.0.0.1:7657');

let ctlReady = false;
let streamReady = false;

ctl.on('open', () => {
  console.log('[CTRL] open');
  ctl.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
});
ctl.on('message', (data) => {
  console.log('[CTRL MSG]', JSON.stringify(data.toString().substring(0, 100)));
});
ctl.on('error', (e) => console.error('[CTRL ERR]', e.message));
ctl.on('close', (code) => console.log('[CTRL CLOSE]', code));

stream.on('open', () => {
  console.log('[STREAM] open');
  stream.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
});
stream.on('message', (data) => {
  console.log('[STREAM MSG]', JSON.stringify(data.toString().substring(0, 100)));
});
stream.on('error', (e) => console.error('[STREAM ERR]', e.message));
stream.on('close', (code) => console.log('[STREAM CLOSE]', code));

setTimeout(() => process.exit(0), 8000);