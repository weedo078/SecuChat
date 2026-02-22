import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  version: process.env.npm_package_version ?? '0.0.1',
  isElectron: true,
  i2pdBundled: true,
});
