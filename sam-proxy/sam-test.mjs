// SAM v3.1 test: HELLO + DEST GENERATE
import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:7657');
let buf = '';
let state = 'greeting';

ws.on('open', () => {
  ws.send('HELLO VERSION MIN=3.0 MAX=3.1\n');
});

ws.on('message', (data) => {
  buf += data.toString();
  // Messages from SAM are newline-terminated
  if (buf.includes('\n')) {
    const lines = buf.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      console.log(`[${state}] ${line.substring(0, 80)}${line.length > 80 ? '...' : ''}`);
    }
    buf = lines[lines.length - 1];

    if (state === 'greeting') {
      state = 'generating';
      console.log('--- Sending DEST GENERATE ---');
      ws.send('DEST GENERATE\n');
    } else if (state === 'generating') {
      state = 'done';
      console.log('--- Got destination, closing ---');
      ws.close();
    }
  }
});

ws.on('error', (e) => { console.error('ERR', e.message); process.exit(1); });
ws.on('close', () => process.exit(0));

setTimeout(() => {
  console.log('--- Timeout ---');
  ws.close();
  process.exit(0);
}, 90000);