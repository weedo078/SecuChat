import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.env.npm_package_version ?? '0.0.1',
  isElectron: true,
  i2pdBundled: true,
  
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
