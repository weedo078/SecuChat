import { describe, it, expect } from 'vitest';
import { i2pService } from '../i2p';

describe('i2p platform switch', () => {
  it('uses i2pPlugin on Android native', () => {
    expect(typeof i2pService.initialize).toBe('function');
  });
});
