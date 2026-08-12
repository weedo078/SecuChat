import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { logger } from '@/utils/logger';

export interface I2PConfig {
  host: string;
  port: number;
  enabled: boolean;
}

interface I2PNativePlugin {
  start(options: { host: string; port: number; nickname?: string }): Promise<{ b32Address: string }>;
  connectTo(options: { destination: string; timeout?: number }): Promise<{ streamId: number }>;
  acceptIncoming(options: Record<string, never>): Promise<void>;
  send(options: { streamId: number; data: string }): Promise<{ success: boolean }>;
  close(options: { streamId: number; reason?: string }): Promise<{ success: boolean }>;
  disconnect(options?: Record<string, never>): Promise<void>;
  isI2pAppInstalled(options?: Record<string, never>): Promise<{ installed: boolean }>;
  getB32Address(options?: Record<string, never>): Promise<{ b32Address: string }>;
  addListener(eventName: string, listener: (event: unknown) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}

interface I2PMessageEvent {
  peerDestination?: string;
  data: string;
  streamId: number;
}

interface I2PStreamConnectedEvent {
  streamId: number;
  peerDestination: string;
}

interface I2PStreamClosedEvent {
  streamId: number;
  reason?: string;
}

const I2PNative = registerPlugin<I2PNativePlugin>('I2P');

export class I2PPlugin {
  private listeners: PluginListenerHandle[] = [];
  private listenersRegistered = false;
  private messageHandlers: ((from: string, data: string, streamId: number) => void)[] = [];
  private streamConnectedHandlers: ((streamId: number, peerDestination: string) => void)[] = [];
  private streamClosedHandlers: ((streamId: number, reason?: string) => void)[] = [];
  private errorHandlers: ((error: string, streamId: number) => void)[] = [];

  private async ensureNativeListeners(): Promise<void> {
    if (this.listenersRegistered) return;
    await this.setupListeners();
    this.listenersRegistered = true;
  }

  async initialize(config: I2PConfig): Promise<{ b32Address: string }> {
    if (!config.enabled) throw new Error('I2P disabled in config');
    // i2pPlugin.initialize() kann mehrere Sekunden hängen, wenn i2pd nicht
    // auf dem erwarteten Port (7654 I2CP) antwortet. Wir geben ihm maximal 8s
    // und werfen dann — der Auto-Onboard fängt das bereits ab, der normale
    // User-Flow sieht stattdessen einen klaren Fehler statt eines Hängers.
    const startPromise = I2PNative.start({ host: config.host, port: config.port, nickname: 'SecuChat' });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`i2pPlugin.initialize timed out after 8s (host=${config.host}:${config.port})`)), 8000)
    );
    const result = await Promise.race([startPromise, timeoutPromise]);

    // Reverse-order safe: drop any previously registered native listeners
    // before re-registering, so a repeated initialize() does not stack
    // listeners and emit duplicate events.
    await this.removeAllListeners();
    this.listenersRegistered = false;
    await this.ensureNativeListeners();
    logger.log('[I2PPlugin] initialized, b32=', result.b32Address.slice(0, 20));
    return result;
  }

  async connectTo(destination: string, timeout = 60000, maxRetries = 5): Promise<number> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await I2PNative.connectTo({ destination, timeout });
        return result.streamId;
      } catch (e) {
        if (attempt === maxRetries) throw e;
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    throw new Error('connectTo exhausted');
  }

  async startAccepting(): Promise<void> {
    await I2PNative.acceptIncoming({});
  }

  async send(streamId: number, data: string): Promise<boolean> {
    const result = await I2PNative.send({ streamId, data });
    return result.success;
  }

  async closeStream(streamId: number): Promise<boolean> {
    const result = await I2PNative.close({ streamId, reason: 'user closed' });
    return result.success;
  }

  async disconnect(): Promise<void> {
    await I2PNative.disconnect({});
    await this.removeAllListeners();
  }

  /** Checks whether the I2P router app (net.i2p.android) is installed. */
  async isI2pAppInstalled(): Promise<boolean> {
    const result = await I2PNative.isI2pAppInstalled({});
    return result.installed;
  }

  /**
   * Returns the live b32 address of the active SAM session. This is the
   * authoritative source of the user's own b32 — it reflects whatever
   * destination the SAM session actually uses. The User object in storage
   * can drift (e.g. after `pm clear` + re-onboarding or after the SAM
   * session was re-keyed); reading from storage alone can yield a stale
   * b32 that no peer can resolve.
   */
  async getB32Address(): Promise<string | null> {
    try {
      const result = await I2PNative.getB32Address({});
      return result.b32Address;
    } catch {
      return null;
    }
  }

  onMessage(handler: (from: string, data: string, streamId: number) => void): void {
    // Ensure native listeners are registered BEFORE we route through them.
    // Race fix: I2PPlugin.initialize() takes 5–15s (SAM session connect +
    // LeaseSet publish); if the WebView's Capacitor Listener for 'i2pMessage'
    // is registered only inside initialize(), any acceptIncoming() that fires
    // during that window is dropped on the floor — Capacitor has no
    // notifications receiver yet. By ensuring listeners the moment a JS
    // handler subscribes, we close the window. ensureNativeListeners() is
    // idempotent: if initialize() hasn't run, start() hasn't either, so
    // acceptIncoming hasn't either, and the listener simply waits.
    void this.ensureNativeListeners();
    this.messageHandlers.push(handler);
  }

  onStreamConnected(handler: (streamId: number, peerDestination: string) => void): void {
    void this.ensureNativeListeners();
    this.streamConnectedHandlers.push(handler);
  }

  onStreamClosed(handler: (streamId: number, reason?: string) => void): void {
    void this.ensureNativeListeners();
    this.streamClosedHandlers.push(handler);
  }

  onError(handler: (error: string, streamId: number) => void): void {
    void this.ensureNativeListeners();
    this.errorHandlers.push(handler);
  }

  private async setupListeners(): Promise<void> {
    const msg = await I2PNative.addListener('i2pMessage', (event: unknown) => {
      const e = event as I2PMessageEvent;
      this.messageHandlers.forEach(h => h(e.peerDestination ?? '', e.data, e.streamId));
    });
    const conn = await I2PNative.addListener('i2pStreamConnected', (event: unknown) => {
      const e = event as I2PStreamConnectedEvent;
      this.streamConnectedHandlers.forEach(h => h(e.streamId, e.peerDestination));
    });
    const close = await I2PNative.addListener('i2pStreamClosed', (event: unknown) => {
      const e = event as I2PStreamClosedEvent;
      this.streamClosedHandlers.forEach(h => h(e.streamId, e.reason));
    });
    this.listeners.push(msg, conn, close);
  }

  private async removeAllListeners(): Promise<void> {
    for (const l of this.listeners) {
      try {
        await l.remove();
      } catch {
        // Listener may already be removed; ignore.
      }
    }
    this.listeners = [];
  }
}

export const i2pPlugin = new I2PPlugin();
