import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { logger } from '@/utils/logger';
import { type ElectronI2PAPI } from './electronI2pTypes';

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

/**
 * Adapter that lets an Electron `onI2pEvent` unsubscribe function flow
 * through the same `removeAllListeners()` codepath as Capacitor's
 * `PluginListenerHandle.remove()`. Both paths converge on `await l.remove()`.
 */
interface ElectronListenerHandle {
  remove(): Promise<void>;
}

export class I2PPlugin {
  private listeners: PluginListenerHandle[] = [];
  private listenersRegistered = false;
  private messageHandlers: ((from: string, data: string, streamId: number) => void)[] = [];
  private streamConnectedHandlers: ((streamId: number, peerDestination: string) => void)[] = [];
  private streamClosedHandlers: ((streamId: number, reason?: string) => void)[] = [];
  private errorHandlers: ((error: string, streamId: number) => void)[] = [];

  /**
   * Unsubscribe handles for the Electron-I2P IPC event listeners registered
   * by `setupElectronListeners`. Mirrors `i2p.ts`'s `electronI2pUnsubs[]`
   * — needed so a re-`initialize()` (or `disconnect()`) does not stack
   * listeners and emit duplicate `i2pMessage` events.
   */
  private electronUnsubs: Array<() => void> = [];

  /**
   * Returns the typed Electron IPC bridge, or `null` if we're not running
   * inside Electron (browser, Capacitor/Android). Mirror of `getElectronI2P()`
   * in `i2p.ts` — same shape, same guard against `typeof window === 'undefined'`.
   */
  private getElectronI2P(): ElectronI2PAPI | null {
    if (typeof window === 'undefined') return null;
    const api = (window as unknown as { electronAPI?: ElectronI2PAPI }).electronAPI;
    return api ?? null;
  }

  /**
   * Electron is the fallback transport on the Desktop build. It activates
   * only when `window.electronAPI` is present AND Capacitor is absent —
   * CLAUDE.md platform-detection rule: Capacitor first, Electron second.
   * On Android (Capacitor), the native SAM plugin path is always used
   * regardless of any leftover `window.electronAPI` from a WebView preload.
   */
  private isElectronMode(): boolean {
    const hasElectron = this.getElectronI2P() !== null;
    const hasCapacitor = typeof window !== 'undefined'
      && (window as unknown as { Capacitor?: unknown }).Capacitor !== undefined;
    return hasElectron && !hasCapacitor;
  }

  private async ensureNativeListeners(): Promise<void> {
    if (this.listenersRegistered) return;
    if (this.isElectronMode()) {
      await this.setupElectronListeners();
    } else {
      await this.setupListeners();
    }
    this.listenersRegistered = true;
  }

  async initialize(config: I2PConfig): Promise<{ b32Address: string }> {
    if (!config.enabled) throw new Error('I2P disabled in config');
    // i2pPlugin.initialize() kann mehrere Sekunden hängen, wenn i2pd nicht
    // auf dem erwarteten Port (7654 I2CP) antwortet. Wir geben ihm maximal 8s
    // und werfen dann — der Auto-Onboard fängt das bereits ab, der normale
    // User-Flow sieht stattdessen einen klaren Fehler statt eines Hängers.
    const electronI2p = this.getElectronI2P();
    if (electronI2p && this.isElectronMode()) {
      const startPromise = electronI2p.i2pInvoke('start', {
        host: config.host, port: config.port, nickname: 'SecuChat',
      }) as Promise<{ b32Address: string }>;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`i2pPlugin.initialize timed out after 8s (host=${config.host}:${config.port})`)), 8000)
      );
      const result = await Promise.race([startPromise, timeoutPromise]);

      // Reverse-order safe: drop any previously registered listeners on
      // either path before re-registering, so a repeated initialize()
      // does not stack listeners and emit duplicate events.
      await this.removeAllListeners();
      this.listenersRegistered = false;
      await this.ensureNativeListeners();
      logger.log('[I2PPlugin] initialized via Electron, b32=', result.b32Address.slice(0, 20));
      return result;
    }

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
    const electronI2p = this.getElectronI2P();
    if (electronI2p && this.isElectronMode()) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await electronI2p.i2pInvoke('connectTo', {
            destination, timeout,
          }) as { streamId: number };
          return result.streamId;
        } catch (e) {
          if (attempt === maxRetries) throw e;
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      throw new Error('connectTo exhausted');
    }
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
    const electronI2p = this.getElectronI2P();
    if (electronI2p && this.isElectronMode()) {
      await electronI2p.i2pInvoke('acceptIncoming');
      return;
    }
    await I2PNative.acceptIncoming({});
  }

  async send(streamId: number, data: string): Promise<boolean> {
    const electronI2p = this.getElectronI2P();
    if (electronI2p && this.isElectronMode()) {
      const result = await electronI2p.i2pInvoke('send', { streamId, data }) as { success: boolean };
      return result.success;
    }
    const result = await I2PNative.send({ streamId, data });
    return result.success;
  }

  async closeStream(streamId: number): Promise<boolean> {
    const electronI2p = this.getElectronI2P();
    if (electronI2p && this.isElectronMode()) {
      const result = await electronI2p.i2pInvoke('close', {
        streamId, reason: 'user closed',
      }) as { success: boolean };
      return result.success;
    }
    const result = await I2PNative.close({ streamId, reason: 'user closed' });
    return result.success;
  }

  async disconnect(): Promise<void> {
    const electronI2p = this.getElectronI2P();
    if (electronI2p && this.isElectronMode()) {
      try {
        await electronI2p.i2pInvoke('disconnect');
      } catch (e) {
        logger.warn('[I2PPlugin] Electron disconnect failed:', e);
      }
    } else {
      await I2PNative.disconnect({});
    }
    await this.removeAllListeners();
  }

  /**
   * Checks whether the I2P router app (net.i2p.android) is installed.
   * Electron path does not need this check — the IPC plugin exposes
   * `isAvailable` which is already probed inside `initialize()` via
   * `i2p.ts`. We return `true` to indicate "use the Electron transport".
   */
  async isI2pAppInstalled(): Promise<boolean> {
    if (this.isElectronMode()) return true;
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
    const electronI2p = this.getElectronI2P();
    if (electronI2p && this.isElectronMode()) {
      try {
        const result = await electronI2p.i2pInvoke('getB32Address') as { b32Address: string };
        return result.b32Address;
      } catch {
        return null;
      }
    }
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

  /**
   * Register the three event listeners (`i2pMessage`, `i2pStreamConnected`,
   * `i2pStreamClosed`) on the Electron IPC bridge. Each subscription
   * returns an unsubscribe function; we wrap each in a `PluginListenerHandle`-
   * shaped object so `removeAllListeners()` can stay backend-agnostic, AND
   * we also stash the raw unsubscribe in `electronUnsubs` so
   * `disconnect()` / a re-`initialize()` can drop them in one shot.
   */
  private setupElectronListeners(): void {
    const electronI2p = this.getElectronI2P();
    if (!electronI2p) return;

    const msgUnsub = electronI2p.onI2pEvent('i2pMessage', (event: unknown) => {
      const e = event as I2PMessageEvent;
      this.messageHandlers.forEach(h => h(e.peerDestination ?? '', e.data, e.streamId));
    });
    const connUnsub = electronI2p.onI2pEvent('i2pStreamConnected', (event: unknown) => {
      const e = event as I2PStreamConnectedEvent;
      this.streamConnectedHandlers.forEach(h => h(e.streamId, e.peerDestination));
    });
    const closeUnsub = electronI2p.onI2pEvent('i2pStreamClosed', (event: unknown) => {
      const e = event as I2PStreamClosedEvent;
      this.streamClosedHandlers.forEach(h => h(e.streamId, e.reason));
    });

    this.electronUnsubs.push(msgUnsub, connUnsub, closeUnsub);

    // Wrap each unsubscribe into a PluginListenerHandle-shaped object so
    // the existing Capacitor-codepath `removeAllListeners()` can drop them
    // with the same `await handle.remove()` call. The wrapper swallows the
    // raw unsubscribe's `void` return value to satisfy the `Promise<void>`
    // signature on `PluginListenerHandle.remove()`.
    this.listeners.push(
      this.wrapElectronUnsub(msgUnsub),
      this.wrapElectronUnsub(connUnsub),
      this.wrapElectronUnsub(closeUnsub),
    );
  }

  /** Drop every Electron-I2P event subscription. Idempotent. */
  private clearElectronListeners(): void {
    for (const unsub of this.electronUnsubs) {
      try {
        unsub();
      } catch {
        // Listener may already be detached (e.g. window closed); ignore.
      }
    }
    this.electronUnsubs = [];
  }

  private wrapElectronUnsub(unsub: () => void): ElectronListenerHandle {
    return {
      remove: async () => {
        try {
          unsub();
        } catch {
          // Already detached; ignore.
        }
      },
    };
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
    // Belt-and-braces: if anything was registered through the Electron
    // path but missed in `this.listeners` (e.g. a future code path that
    // pushes to `electronUnsubs` without going through the wrapper), make
    // sure they are torn down too. Idempotent because `clearElectronListeners()`
    // resets `electronUnsubs` to `[]`.
    this.clearElectronListeners();
  }
}

export const i2pPlugin = new I2PPlugin();
