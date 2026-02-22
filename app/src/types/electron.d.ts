export {};

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      version: string;
      isElectron: boolean;
      i2pdBundled: boolean;
      
      // Auto-updater
      checkForUpdates?: () => Promise<void>;
      downloadUpdate?: () => Promise<{ success: boolean; error?: string }>;
      installUpdate?: () => Promise<void>;
      
      // Event listeners
      onUpdateChecking?: (callback: () => void) => (() => void);
      onUpdateAvailable?: (callback: (event: unknown, data: { version: string; releaseDate: string }) => void) => (() => void);
      onUpdateNotAvailable?: (callback: () => void) => (() => void);
      onUpdateProgress?: (callback: (event: unknown, data: { percent: number; speed: number }) => void) => (() => void);
      onUpdateDownloaded?: (callback: (event: unknown, data: { version: string }) => void) => (() => void);
      onUpdateError?: (callback: (event: unknown, error: string) => void) => (() => void);
    };
  }
}
