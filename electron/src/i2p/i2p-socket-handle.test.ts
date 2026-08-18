import { describe, it, expect } from 'vitest';
import { Duplex } from 'node:stream';
import { I2PSocketHandle } from './i2p-socket-handle';

function makeFakeSocket(opts?: { onWrite?: (chunk: Buffer) => void }): Duplex {
  const s = new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      opts?.onWrite?.(chunk as Buffer);
      cb();
    },
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

  it('fires onClose("error") when newlineBuffer exceeds MAX_BUFFER_BYTES', async () => {
    const socket = makeFakeSocket();
    const handle = new I2PSocketHandle(5, socket, 'peer-b32');
    let closeReason = '';
    handle.setOnClose((ev) => { closeReason = ev.reason; });
    handle.startReadThread();

    // Push a chunk with no newline larger than the cap (1 MiB).
    const oversized = Buffer.alloc(I2PSocketHandle.MAX_BUFFER_BYTES + 1, 0x41); // 'A' * (cap + 1)
    socket.push(oversized);
    await new Promise(r => setImmediate(r));

    expect(closeReason).toBe('error');
    expect(handle.isClosed()).toBe(true);

    // send() after buffer-overflow close must throw (socket is closed).
    await expect(handle.send(Buffer.from('late'))).rejects.toThrow(/closed/);
  });

  it('send() appends \\n and receiver observes the line as a DataEvent', async () => {
    // receiver side (separate handle on its own socket)
    const receiverSocket = makeFakeSocket();
    const receiver = new I2PSocketHandle(7, receiverSocket, 'peer-b32');
    const lines: string[] = [];
    receiver.setOnData((ev) => lines.push(Buffer.from(ev.data).toString('utf8')));
    receiver.startReadThread();

    // sender side: hook the writable side so every byte the sender writes
    // gets pushed into the receiver socket's readable side.
    const senderSocket = makeFakeSocket({
      onWrite: (chunk) => receiverSocket.push(chunk),
    });
    const sender = new I2PSocketHandle(6, senderSocket, 'peer-b32');

    await sender.send(Buffer.from('hello'));

    // Give the receiver loop a couple of ticks to process the pushed chunk.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));

    expect(lines).toEqual(['hello']);
  });
});