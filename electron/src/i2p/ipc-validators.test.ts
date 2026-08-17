import { describe, it, expect } from 'vitest';
import {
  I2P_EVENT_NAMES,
  parseCloseOpts,
  parseConnectToOpts,
  parseSendOpts,
  parseStartOpts,
} from './ipc-validators';

describe('parseStartOpts', () => {
  it('defaults to an empty object for null/undefined', () => {
    expect(parseStartOpts(undefined)).toEqual({});
    expect(parseStartOpts(null)).toEqual({});
  });

  it('passes through valid host/port/nickname', () => {
    expect(parseStartOpts({ host: '127.0.0.1', port: 7654, nickname: 'SecuChat' })).toEqual({
      host: '127.0.0.1',
      port: 7654,
      nickname: 'SecuChat',
    });
  });

  it('accepts partial option objects', () => {
    expect(parseStartOpts({ port: 7654 })).toEqual({ port: 7654 });
    expect(parseStartOpts({})).toEqual({});
  });

  it('strips unknown keys so arbitrary renderer input cannot reach the plugin', () => {
    const parsed = parseStartOpts({
      host: '127.0.0.1',
      privKey: 'attacker-supplied',
      __proto__: { polluted: true },
    });
    expect(parsed).toEqual({ host: '127.0.0.1' });
    expect('privKey' in parsed).toBe(false);
  });

  it('rejects non-object payloads', () => {
    expect(() => parseStartOpts('nope')).toThrow(/i2p:start/);
    expect(() => parseStartOpts(42)).toThrow(/i2p:start/);
    expect(() => parseStartOpts([])).toThrow(/i2p:start/);
  });

  it('rejects a non-string host', () => {
    expect(() => parseStartOpts({ host: 1234 })).toThrow(/host/);
  });

  it('rejects a non-string nickname', () => {
    expect(() => parseStartOpts({ nickname: { evil: true } })).toThrow(/nickname/);
  });

  it('rejects out-of-range or non-integer ports', () => {
    expect(() => parseStartOpts({ port: 0 })).toThrow(/port/);
    expect(() => parseStartOpts({ port: 65536 })).toThrow(/port/);
    expect(() => parseStartOpts({ port: 7654.5 })).toThrow(/port/);
    expect(() => parseStartOpts({ port: NaN })).toThrow(/port/);
    expect(() => parseStartOpts({ port: '7654' })).toThrow(/port/);
  });
});

describe('parseConnectToOpts', () => {
  it('accepts a non-empty destination string', () => {
    expect(parseConnectToOpts({ destination: 'abcdef.b32.i2p' })).toEqual({
      destination: 'abcdef.b32.i2p',
    });
  });

  it('strips unknown keys', () => {
    expect(parseConnectToOpts({ destination: 'x.b32.i2p', extra: 1 })).toEqual({
      destination: 'x.b32.i2p',
    });
  });

  it('rejects a missing/empty/non-string destination', () => {
    expect(() => parseConnectToOpts({})).toThrow(/destination/);
    expect(() => parseConnectToOpts({ destination: '' })).toThrow(/destination/);
    expect(() => parseConnectToOpts({ destination: 123 })).toThrow(/destination/);
    expect(() => parseConnectToOpts(null)).toThrow(/i2p:connectTo/);
  });

  it('caps the offending value in the error message so blobs cannot flood logs', () => {
    const huge = 'x'.repeat(5000);
    let message = '';
    try {
      parseConnectToOpts({ destination: { blob: huge } });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/destination/);
    expect(message.length).toBeLessThan(200);
  });
});

describe('parseSendOpts', () => {
  it('accepts a valid streamId/data pair', () => {
    expect(parseSendOpts({ streamId: 7, data: 'hello' })).toEqual({ streamId: 7, data: 'hello' });
  });

  it('accepts an empty data string', () => {
    expect(parseSendOpts({ streamId: 0, data: '' })).toEqual({ streamId: 0, data: '' });
  });

  it('strips unknown keys', () => {
    expect(parseSendOpts({ streamId: 1, data: 'a', spoof: true })).toEqual({
      streamId: 1,
      data: 'a',
    });
  });

  it('rejects an invalid streamId', () => {
    expect(() => parseSendOpts({ streamId: -1, data: 'a' })).toThrow(/streamId/);
    expect(() => parseSendOpts({ streamId: 1.5, data: 'a' })).toThrow(/streamId/);
    expect(() => parseSendOpts({ streamId: '1', data: 'a' })).toThrow(/streamId/);
    expect(() => parseSendOpts({ data: 'a' })).toThrow(/streamId/);
  });

  it('rejects non-string data', () => {
    expect(() => parseSendOpts({ streamId: 1 })).toThrow(/data/);
    expect(() => parseSendOpts({ streamId: 1, data: Buffer.from('x') })).toThrow(/data/);
  });
});

describe('parseCloseOpts', () => {
  it('accepts a streamId with an optional reason', () => {
    expect(parseCloseOpts({ streamId: 3 })).toEqual({ streamId: 3 });
    expect(parseCloseOpts({ streamId: 3, reason: 'done' })).toEqual({ streamId: 3, reason: 'done' });
  });

  it('strips unknown keys', () => {
    expect(parseCloseOpts({ streamId: 3, nope: 'x' })).toEqual({ streamId: 3 });
  });

  it('rejects an invalid streamId or reason', () => {
    expect(() => parseCloseOpts({})).toThrow(/streamId/);
    expect(() => parseCloseOpts({ streamId: 'a' })).toThrow(/streamId/);
    expect(() => parseCloseOpts({ streamId: 1, reason: 5 })).toThrow(/reason/);
  });
});

describe('I2P_EVENT_NAMES', () => {
  it('mirrors the preload allowlist (electron/src/preload.ts I2P_EVENTS)', () => {
    expect([...I2P_EVENT_NAMES]).toEqual([
      'i2pStatus',
      'i2pMessage',
      'i2pStreamConnected',
      'i2pStreamClosed',
    ]);
  });
});
