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
  private messageHandlers: ((from: string, data: string, streamId: number) => void)[] = [];
  private streamConnectedHandlers: ((streamId: number, peerDestination: string) => void)[] = [];
  private streamClosedHandlers: ((streamId: number, reason?: string) => void)[] = [];
  private errorHandlers: ((error: string, streamId: number) => void)[] = [];

  async initialize(config: I2PConfig): Promise<{ b32Address: string }> {
    if (!config.enabled) throw new Error('I2P disabled in config');
    const result = await I2PNative.start({ host: config.host, port: config.port, nickname: 'SecuChat' });

    await this.setupListeners();
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

  onMessage(handler: (from: string, data: string, streamId: number) => void): void {
    this.messageHandlers.push(handler);
  }

  onStreamConnected(handler: (streamId: number, peerDestination: string) => void): void {
    this.streamConnectedHandlers.push(handler);
  }

  onStreamClosed(handler: (streamId: number, reason?: string) => void): void {
    this.streamClosedHandlers.push(handler);
  }

  onError(handler: (error: string, streamId: number) => void): void {
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
