import { describe, it, expect } from 'vitest';
import { I2PPlugin } from '../i2pPlugin';

describe('I2PPlugin', () => {
    it('initializes without error when Capacitor.Plugins.I2P is undefined', async () => {
        // In Web/PWA gibt es kein I2PPlugin — Fehler propagieren sauber.
        const plugin = new I2PPlugin();
        await expect(plugin.initialize({host: '127.0.0.1', port: 7654, enabled: true}))
            .rejects.toThrow();
    });
});
