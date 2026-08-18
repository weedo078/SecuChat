import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { I2CPSocketManager } from './i2cp-socket-manager';

// Mock node:net so the TCP connect in initialize() resolves without a real
// I2P router. The real `net.Socket` inherits from EventEmitter and exposes
// `write/destroy/end/destroyed` — we mirror that shape so I2CPSocketManager
// can interact with it as if it were a connected socket.
vi.mock('node:net', () => {
  const makeFakeSocket = () => {
    const s = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
      destroyed: boolean;
    };
    s.write = vi.fn(() => true);
    s.destroy = vi.fn(() => {
      s.destroyed = true;
      // Match Node's behavior: destroy() emits 'close' asynchronously.
      setImmediate(() => s.emit('close'));
      return s;
    });
    s.end = vi.fn();
    s.destroyed = false;
    return s;
  };

  return {
    connect: vi.fn((_port: number, _host: string) => {
      const s = makeFakeSocket();
      // Emit 'connect' asynchronously, mirroring real Node behavior.
      setImmediate(() => s.emit('connect'));
      return s;
    }),
    // `new net.Socket()` is used in `connectTo()` / `acceptIncoming()`
    // placeholder branches. Provide a no-op factory that returns an
    // EventEmitter-shaped placeholder.
    Socket: vi.fn(() => makeFakeSocket()),
  };
});

// Typed reset helper — avoid `as any` in tests.
function resetSingleton(): void {
  // @ts-expect-error - test-only access to private static
  I2CPSocketManager.instance = null;
}

const baseOpts = () => ({
  host: '127.0.0.1',
  port: 7654,
  privKey: new Uint8Array(384),
  nickname: 'test',
});

describe('I2CPSocketManager (brief)', () => {
  beforeEach(() => {
    resetSingleton();
  });

  it('requireDestination throws on null/empty', () => {
    expect(() => I2CPSocketManager.requireDestination('')).toThrow();
    expect(() => I2CPSocketManager.requireDestination(null as unknown as string)).toThrow();
  });

  it('getInstance returns null before getOrCreate', () => {
    expect(I2CPSocketManager.getInstance()).toBeNull();
  });

  it('getOrCreate returns same instance on second call', async () => {
    const m1 = await I2CPSocketManager.getOrCreate(baseOpts());
    const m2 = await I2CPSocketManager.getOrCreate(baseOpts());
    expect(m1).toBe(m2);
  });
});

describe('I2CPSocketManager (defensive)', () => {
  beforeEach(() => {
    resetSingleton();
  });

  it('connectTo increments streamIdCounter and registers a stream', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    const id1 = await m.connectTo('a'.repeat(52));
    const id2 = await m.connectTo('b'.repeat(52));
    // Monotonically increasing (1 first because streamIdCounter starts at 1).
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(id2).toBeGreaterThan(id1);
    expect(m.getStream(id1)?.peerDestination).toBe('a'.repeat(52));
    expect(m.getStream(id2)?.peerDestination).toBe('b'.repeat(52));
  });

  it('connectTo with empty/null throws (instance-level validator enforced)', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await expect(m.connectTo('')).rejects.toThrow(/destination/i);
    await expect(
      m.connectTo(null as unknown as string),
    ).rejects.toThrow(/destination/i);
  });

  it('acceptIncoming registers an incoming stream', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    const id = await m.acceptIncoming();
    const stream = m.getStream(id);
    expect(stream).toBeDefined();
    expect(stream?.peerDestination).toBe('unknown-peer');
    expect(stream?.isClosed()).toBe(false); // isClosed is false until close() runs
  });

  it('send to unknown streamId throws', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await expect(m.send(999, new Uint8Array([1, 2, 3]))).rejects.toThrow(/not found/);
  });

  it('close of unknown streamId throws', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await expect(m.close(999, 'no-such-stream')).rejects.toThrow(/not found/);
  });

  it('close removes stream from registry', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    const id = await m.connectTo('a'.repeat(52));
    expect(m.getStream(id)).toBeDefined();
    await m.close(id, 'user');
    expect(m.getStream(id)).toBeUndefined();
  });

  it('disconnect is idempotent', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    await m.connectTo('a'.repeat(52));
    expect(m.isConnected()).toBe(true);

    await m.disconnect();
    expect(m.isConnected()).toBe(false);
    expect(I2CPSocketManager.getInstance()).toBeNull();

    // Second disconnect is a no-op (instance is null now, but calling on the
    // saved reference should also be safe).
    await m.disconnect(); // should not throw
    expect(m.isConnected()).toBe(false);
  });

  it('getOrCreate after disconnect returns a fresh instance (singleton reset works)', async () => {
    const m1 = await I2CPSocketManager.getOrCreate(baseOpts());
    await m1.disconnect();
    expect(I2CPSocketManager.getInstance()).toBeNull();

    const m2 = await I2CPSocketManager.getOrCreate(baseOpts());
    expect(m2).not.toBe(m1);
    expect(I2CPSocketManager.getInstance()).toBe(m2);

    // Fresh instance must start streamIdCounter at 1 again (no carry-over).
    const id = await m2.connectTo('a'.repeat(52));
    expect(id).toBe(1);
  });

  it('isConnected reflects socket state', async () => {
    const m = await I2CPSocketManager.getOrCreate(baseOpts());
    expect(m.isConnected()).toBe(true);
    await m.disconnect();
    expect(m.isConnected()).toBe(false);
  });
});
