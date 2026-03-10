// Native Storage Service
// Uses Capacitor Preferences for settings and Filesystem for large data/backup
// Only used when running as a native Android/iOS app

import type { AppSettings, SecuritySettings } from '@/types';

// Lazy-loaded Capacitor modules
let Preferences: typeof import('@capacitor/preferences').Preferences | null = null;
let Filesystem: typeof import('@capacitor/filesystem').Filesystem | null = null;
let Directory: typeof import('@capacitor/filesystem').Directory | null = null;
let Encoding: typeof import('@capacitor/filesystem').Encoding | null = null;

/**
 * Initialize Capacitor plugins (lazy-loaded)
 */
async function initPlugins(): Promise<void> {
  if (Preferences && Filesystem) return;

  try {
    const preferencesModule = await import('@capacitor/preferences');
    const filesystemModule = await import('@capacitor/filesystem');

    Preferences = preferencesModule.Preferences;
    Filesystem = filesystemModule.Filesystem;
    Directory = filesystemModule.Directory;
    Encoding = filesystemModule.Encoding;

    console.log('[NativeStorage] Capacitor plugins initialized');
  } catch (error) {
    console.error('[NativeStorage] Failed to load Capacitor plugins:', error);
    throw new Error('Capacitor plugins not available');
  }
}

/**
 * Check if native storage is available
 */
export function isNativeStorageAvailable(): boolean {
  // Check if we're in a Capacitor native environment
  if (typeof window === 'undefined') return false;

  // Safe check for Capacitor without importing
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() ?? false;
}

/**
 * Native storage service for key-value data using @capacitor/preferences
 */
export const nativePreferences = {
  /**
   * Get a string value from preferences
   */
  async getItem(key: string): Promise<string | null> {
    await initPlugins();
    if (!Preferences) throw new Error('Preferences not initialized');

    const { value } = await Preferences.get({ key });
    return value;
  },

  /**
   * Set a string value in preferences
   */
  async setItem(key: string, value: string): Promise<void> {
    await initPlugins();
    if (!Preferences) throw new Error('Preferences not initialized');

    await Preferences.set({ key, value });
  },

  /**
   * Remove a value from preferences
   */
  async removeItem(key: string): Promise<void> {
    await initPlugins();
    if (!Preferences) throw new Error('Preferences not initialized');

    await Preferences.remove({ key });
  },

  /**
   * Get all keys from preferences
   */
  async keys(): Promise<string[]> {
    await initPlugins();
    if (!Preferences) throw new Error('Preferences not initialized');

    const { keys } = await Preferences.keys();
    return keys;
  },

  /**
   * Clear all preferences
   */
  async clear(): Promise<void> {
    await initPlugins();
    if (!Preferences) throw new Error('Preferences not initialized');

    await Preferences.clear();
  },
};

/**
 * Settings storage using native preferences
 * Migrates settings from IndexedDB on first use
 */
export const nativeSettingsStorage = {
  /**
   * Save app settings to native preferences
   */
  async saveSettings(settings: AppSettings): Promise<void> {
    await nativePreferences.setItem('app_settings', JSON.stringify(settings));
    console.log('[NativeStorage] Settings saved');
  },

  /**
   * Load app settings from native preferences
   */
  async getSettings(): Promise<AppSettings | null> {
    const value = await nativePreferences.getItem('app_settings');
    if (!value) return null;

    try {
      return JSON.parse(value) as AppSettings;
    } catch {
      console.error('[NativeStorage] Failed to parse settings');
      return null;
    }
  },

  /**
   * Save security settings to native preferences
   */
  async saveSecuritySettings(settings: SecuritySettings): Promise<void> {
    await nativePreferences.setItem('security_settings', JSON.stringify(settings));
  },

  /**
   * Load security settings from native preferences
   */
  async getSecuritySettings(): Promise<SecuritySettings | null> {
    const value = await nativePreferences.getItem('security_settings');
    if (!value) return null;

    try {
      return JSON.parse(value) as SecuritySettings;
    } catch {
      console.error('[NativeStorage] Failed to parse security settings');
      return null;
    }
  },

  /**
   * Clear all settings
   */
  async clearSettings(): Promise<void> {
    await nativePreferences.removeItem('app_settings');
    await nativePreferences.removeItem('security_settings');
  },
};

/**
 * Filesystem storage for large data and backups
 */
export const nativeFilesystem = {
  /**
   * Ensure plugins are initialized
   */
  async init(): Promise<void> {
    await initPlugins();
  },

  /**
   * Write a file to the filesystem
   */
  async writeFile(
    path: string,
    data: string,
    directory: 'documents' | 'downloads' | 'cache' = 'documents'
  ): Promise<string> {
    await initPlugins();
    if (!Filesystem || !Directory || !Encoding) {
      throw new Error('Filesystem not initialized');
    }

    const dir = Directory[directory.toUpperCase() as keyof typeof Directory];

    // Ensure parent directory exists
    const parentDir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '';
    if (parentDir) {
      try {
        await Filesystem.mkdir({
          path: parentDir,
          directory: dir as unknown as import('@capacitor/filesystem').Directory,
          recursive: true,
        });
      } catch {
        // Directory may already exist, ignore error
      }
    }

    const result = await Filesystem.writeFile({
      path,
      data,
      directory: dir as unknown as import('@capacitor/filesystem').Directory,
      encoding: Encoding.UTF8,
      recursive: true,
    });

    return result.uri;
  },

  /**
   * Read a file from the filesystem
   */
  async readFile(
    path: string,
    directory: 'documents' | 'downloads' | 'cache' = 'documents'
  ): Promise<string> {
    await initPlugins();
    if (!Filesystem || !Directory || !Encoding) {
      throw new Error('Filesystem not initialized');
    }

    const dir = Directory[directory.toUpperCase() as keyof typeof Directory];

    const result = await Filesystem.readFile({
      path,
      directory: dir as unknown as import('@capacitor/filesystem').Directory,
      encoding: Encoding.UTF8,
    });

    return result.data as string;
  },

  /**
   * Check if a file exists
   */
  async fileExists(
    path: string,
    directory: 'documents' | 'downloads' | 'cache' = 'documents'
  ): Promise<boolean> {
    await initPlugins();
    if (!Filesystem || !Directory) throw new Error('Filesystem not initialized');

    const dir = Directory[directory.toUpperCase() as keyof typeof Directory];

    try {
      await Filesystem.stat({
        path,
        directory: dir as unknown as import('@capacitor/filesystem').Directory,
      });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Delete a file
   */
  async deleteFile(
    path: string,
    directory: 'documents' | 'downloads' | 'cache' = 'documents'
  ): Promise<void> {
    await initPlugins();
    if (!Filesystem || !Directory) throw new Error('Filesystem not initialized');

    const dir = Directory[directory.toUpperCase() as keyof typeof Directory];

    await Filesystem.deleteFile({
      path,
      directory: dir as unknown as import('@capacitor/filesystem').Directory,
    });
  },

  /**
   * Create a directory
   */
  async mkdir(
    path: string,
    directory: 'documents' | 'downloads' | 'cache' = 'documents',
    recursive = false
  ): Promise<void> {
    await initPlugins();
    if (!Filesystem || !Directory) throw new Error('Filesystem not initialized');

    const dir = Directory[directory.toUpperCase() as keyof typeof Directory];

    await Filesystem.mkdir({
      path,
      directory: dir as unknown as import('@capacitor/filesystem').Directory,
      recursive,
    });
  },

  /**
   * Read directory contents
   */
  async readdir(
    path: string,
    directory: 'documents' | 'downloads' | 'cache' = 'documents'
  ): Promise<string[]> {
    await initPlugins();
    if (!Filesystem || !Directory) throw new Error('Filesystem not initialized');

    const dir = Directory[directory.toUpperCase() as keyof typeof Directory];

    const result = await Filesystem.readdir({
      path,
      directory: dir as unknown as import('@capacitor/filesystem').Directory,
    });

    return result.files.map(f => (typeof f === 'string' ? f : f.name));
  },
};

/**
 * Backup and restore functionality
 */
export const nativeBackup = {
  /**
   * Create a backup file on the device
   */
  async createBackup(filename: string, data: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilename = filename.replace('.json', `-${timestamp}.json`);

    const uri = await nativeFilesystem.writeFile(
      `SecuChat/backups/${backupFilename}`,
      data,
      'documents'
    );

    console.log('[NativeStorage] Backup created:', uri);
    return uri;
  },

  /**
   * List all backup files
   */
  async listBackups(): Promise<Array<{ name: string; uri: string }>> {
    try {
      const files = await nativeFilesystem.readdir('SecuChat/backups', 'documents');
      return files
        .filter(f => f.endsWith('.json'))
        .map(name => ({ name, uri: `SecuChat/backups/${name}` }));
    } catch {
      // Directory doesn't exist yet
      return [];
    }
  },

  /**
   * Read a backup file
   */
  async readBackup(path: string): Promise<string> {
    return nativeFilesystem.readFile(path, 'documents');
  },

  /**
   * Delete a backup file
   */
  async deleteBackup(path: string): Promise<void> {
    return nativeFilesystem.deleteFile(path, 'documents');
  },
};

/**
 * Export contact to device storage
 */
export async function exportContactToFile(
  filename: string,
  content: string
): Promise<string> {
  // Use Downloads directory for user-accessible files
  const uri = await nativeFilesystem.writeFile(
    `Download/${filename}`,
    content,
    'external' as unknown as 'downloads'
  );

  console.log('[NativeStorage] Contact exported to:', uri);
  return uri;
}

/**
 * Initialize native storage (call at app startup)
 */
export async function initNativeStorage(): Promise<void> {
  if (!isNativeStorageAvailable()) {
    console.log('[NativeStorage] Not in native environment, skipping initialization');
    return;
  }

  try {
    await initPlugins();
    console.log('[NativeStorage] Initialized successfully');
  } catch (error) {
    console.error('[NativeStorage] Initialization failed:', error);
    throw error;
  }
}
