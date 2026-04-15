import { contextBridge, ipcRenderer } from 'electron';

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

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.env.npm_package_version ?? '0.0.1',
  isElectron: true,
  i2pdBundled: true,

  // Storage IPC methods — validated against allowlist
  storageInvoke: (channel: string, ...args: unknown[]) => {
    if (!ALLOWED_STORAGE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
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
