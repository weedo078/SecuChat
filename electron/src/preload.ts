import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

/**
 * Allowed IPC channels for storage operations.
 * Must match StorageIpcChannels in app/src/services/storage/types.ts
 * and the handlers registered in electron/src/storage/ipc-handlers.ts.
 */
const ALLOWED_STORAGE_CHANNELS: ReadonlySet<string> = new Set([
  // Initialization
  'storage:init',
  // Passphrase management
  'storage:setPassphrase',
  'storage:clearPassphrase',
  'storage:hasPassphrase',
  // User operations
  'storage:saveUser',
  'storage:getUser',
  'storage:deleteUser',
  // Contact operations
  'storage:saveContact',
  'storage:getContact',
  'storage:getContactByFingerprint',
  'storage:getAllContacts',
  'storage:deleteContact',
  // Chat operations
  'storage:saveChat',
  'storage:getChat',
  'storage:getChatByContactId',
  'storage:getAllChats',
  'storage:deleteChat',
  // Message operations
  'storage:saveMessage',
  'storage:getMessage',
  'storage:getMessagesByChat',
  'storage:getMessagesByChatId',
  'storage:getLastSequence',
  'storage:getAllMessages',
  'storage:deleteMessage',
  'storage:deleteMessagesByChat',
  // Settings operations
  'storage:saveSettings',
  'storage:getSettings',
  'storage:saveSecuritySettings',
  'storage:getSecuritySettings',
  // Device operations
  'storage:saveDevice',
  'storage:getDevice',
  'storage:getDeviceByI2p',
  'storage:getAllDevices',
  'storage:deleteDevice',
  // Backup operations
  'storage:createBackup',
  'storage:restoreBackup',
  'storage:clearAllData',
] as const);

/**
 * Allowed IPC channels for I2P operations.
 * MUST mirror the public methods on `I2PPlugin` (electron/src/i2p/i2p-plugin.ts).
 * If you add a public method to `I2PPlugin` that the renderer should be able
 * to call, add the corresponding `i2p:<method>` channel here AND register
 * an `ipcMain.handle(...)` in main.ts (Task 9).
 *
 * Currently allowed:
 *   - start            : bootstrap an I2CP session against the local i2pd
 *   - connectTo        : open an outbound stream to a base64 destination
 *   - acceptIncoming   : no-op (accept loop runs as background task)
 *   - send             : write UTF-8 data to an open stream
 *   - close            : close an open stream
 *   - disconnect       : tear down the I2CP session
 *   - getB32Address    : return the local destination as b32
 *   - isAvailable      : TCP probe to the I2P router's I2CP port
 */
const ALLOWED_I2P_CHANNELS: ReadonlySet<string> = new Set([
  'i2p:start',
  'i2p:connectTo',
  'i2p:acceptIncoming',
  'i2p:send',
  'i2p:close',
  'i2p:disconnect',
  'i2p:getB32Address',
  'i2p:isAvailable',
] as const);

/**
 * I2P event names that the renderer is allowed to subscribe to.
 * MUST mirror the event channels emitted by `I2PPlugin` (i2p-plugin.ts).
 * Channel wire format: `i2p:event:<eventName>`.
 */
const I2P_EVENTS = ['i2pStatus', 'i2pMessage', 'i2pStreamConnected', 'i2pStreamClosed'] as const;

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.env.npm_package_version ?? '0.0.1',
  isElectron: true,
  i2pdBundled: false,
  // Set by the main process after `I2PPlugin.isI2pAvailable()` probe runs
  // (Task 9 wires a `i2p:setAvailable` IPC handler that overwrites this
  // value at runtime via `contextBridge.exposeInMainWorld` re-exposure).
  // Until then, renderers should treat `false` as "probe not yet complete".
  i2pAvailable: false,

  // Storage IPC methods — validated against allowlist
  storageInvoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_STORAGE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  // I2P IPC methods — validated against allowlist.
  // Renderer-facing call shape: `i2pInvoke('start', { host, port, nickname })`.
  // The method name is joined with the `i2p:` prefix to form the channel
  // string; any method NOT in `ALLOWED_I2P_CHANNELS` is rejected.
  i2pInvoke: (method: string, ...args: unknown[]) => {
    const channel = `i2p:${method}`;
    if (!ALLOWED_I2P_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`I2P IPC channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },

  // I2P event listener — validated against allowlist.
  // Renderer-facing callback signature: `(data: unknown) => void`.
  // Internally we receive Electron's `(event: IpcRendererEvent, data: unknown)`
  // tuple and unwrap it so callers don't see the raw Electron event object.
  // Returns an unsubscribe function that removes the listener.
  onI2pEvent: (eventName: string, callback: (data: unknown) => void): (() => void) => {
    if (!(I2P_EVENTS as readonly string[]).includes(eventName)) {
      throw new Error(`Unknown I2P event: ${eventName}`);
    }
    const channel = `i2p:event:${eventName}` as const;
    const wrapped = (_event: IpcRendererEvent, data: unknown): void => callback(data);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },

  // Auto-updater methods
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),

  // Auto-updater event listeners
  onUpdateChecking: (callback: () => void) => {
    ipcRenderer.on('update:checking', callback);
    return () => ipcRenderer.removeListener('update:checking', callback);
  },
  onUpdateAvailable: (callback: (event: unknown, data: { version: string; releaseDate: string }) => void) => {
    ipcRenderer.on('update:available', callback);
    return () => ipcRenderer.removeListener('update:available', callback);
  },
  onUpdateNotAvailable: (callback: () => void) => {
    ipcRenderer.on('update:not-available', callback);
    return () => ipcRenderer.removeListener('update:not-available', callback);
  },
  onUpdateProgress: (callback: (event: unknown, data: { percent: number; speed: number }) => void) => {
    ipcRenderer.on('update:progress', callback);
    return () => ipcRenderer.removeListener('update:progress', callback);
  },
  onUpdateDownloaded: (callback: (event: unknown, data: { version: string }) => void) => {
    ipcRenderer.on('update:downloaded', callback);
    return () => ipcRenderer.removeListener('update:downloaded', callback);
  },
  onUpdateError: (callback: (event: unknown, error: string) => void) => {
    ipcRenderer.on('update:error', callback);
    return () => ipcRenderer.removeListener('update:error', callback);
  },
});
