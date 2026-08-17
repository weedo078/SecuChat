import { describe, it, expect } from 'vitest';
import { Duplex } from 'node:stream';
import { I2PSocketHandle } from './i2p-socket-handle';

function makeFakeSocket(): Duplex {
  const s = new Duplex({
    read() {},
    write(_chunk, _enc, cb) { cb(); },
  });
  return s;
}

describe('I2PSocketHandle', () => {
  it('emits data events from socket', async () => {
    const socket = makeFakeSocket();
    const handle = new I2PSocketHandle(1, socket, 'peer-b32');
    const events: number[] = [];
    handle.setOnData((ev) => events.push(ev.streamId));
    handle.startReadThread();

    socket.push(Buffer.from('hello\n'));
    await new Promise(r => setImmediate(r));
    expect(events).toEqual([1]);
  });

  it('emits close event on socket close', async () => {
    const socket = makeFakeSocket();
    const handle = new I2PSocketHandle(2, socket, 'peer-b32');
    let closeReason = '';
    handle.setOnClose((ev) => { closeReason = ev.reason; });
    handle.startReadThread();

    handle.close('user closed');
    await new Promise(r => setImmediate(r));
    expect(closeReason).toBe('closed');
  });

  it('startReadThread is idempotent', () => {
    const socket = makeFakeSocket();
    const handle = new I2PSocketHandle(3, socket, 'peer-b32');
    handle.startReadThread();
    handle.startReadThread();  // should not throw, should not double-register
    expect(handle.isClosed()).toBe(false);
  });

  it('close is idempotent', async () => {
    const socket = makeFakeSocket();
    const handle = new I2PSocketHandle(4, socket, 'peer-b32');
    handle.close('first');
    handle.close('second');  // should not throw
    expect(handle.isClosed()).toBe(true);
  });
});