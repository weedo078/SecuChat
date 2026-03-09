// Platform Detection - Phase 1
// Detects the runtime environment and selects appropriate storage provider

import type { StoragePlatform } from './types';

/**
 * Detect if running in Electron main process
 */
function isElectronMain(): boolean {
  // Main process has 'electron' in versions but no window
  return (
    typeof process !== 'undefined' &&
    process.versions != null &&
    process.versions.electron != null &&
    typeof window === 'undefined'
  );
}

/**
 * Detect if running in Electron renderer process
 */
function isElectronRenderer(): boolean {
  // Renderer has window and window.process (with contextIsolation off)
  // OR window.electronAPI (with contextIsolation on, exposed via preload)
  if (typeof window === 'undefined') return false;

  // Check for exposed electronAPI from preload script
  const hasElectronAPI = !!(window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;

  // Check for window.process (legacy, when nodeIntegration is on)
  const hasProcess = typeof window.process === 'object' &&
    (window.process as { type?: string }).type === 'renderer';

  return hasElectronAPI || hasProcess;
}

/**
 * Detect if running in Electron (main or renderer)
 */
export function isElectron(): boolean {
  return isElectronMain() || isElectronRenderer();
}

/**
 * Detect if running in browser environment
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && !isElectronRenderer();
}

/**
 * Get the current storage platform
 * Returns 'electron' if in Electron, 'browser' otherwise
 */
export function getStoragePlatform(): StoragePlatform {
  if (isElectron()) {
    return 'electron';
  }
  return 'browser';
}

/**
 * Check if secure storage is available (encryption support)
 * In browser: Web Crypto API must be available
 * In Electron: always available (Node.js crypto)
 */
export function isSecureStorageAvailable(): boolean {
  if (isElectron()) {
    return true;
  }
  // Browser: check for Web Crypto API
  return (
    typeof window !== 'undefined' &&
    typeof window.crypto !== 'undefined' &&
    typeof window.crypto.subtle !== 'undefined'
  );
}

/**
 * Platform capabilities
 */
export interface PlatformCapabilities {
  /** Platform type */
  platform: StoragePlatform;
  /** Supports encryption at rest */
  encryption: boolean;
  /** Uses IndexedDB (browser) or SQLite (electron) */
  backend: 'indexeddb' | 'sqlite' | 'localstorage';
  /** Supports synchronous operations */
  syncOperations: boolean;
  /** Maximum storage size (approximate) */
  maxStorageSize: string;
}

/**
 * Get platform capabilities
 */
export function getPlatformCapabilities(): PlatformCapabilities {
  const platform = getStoragePlatform();

  if (platform === 'electron') {
    return {
      platform: 'electron',
      encryption: true,
      backend: 'sqlite',
      syncOperations: true,
      maxStorageSize: 'unlimited (disk space)',
    };
  }

  // Browser
  const isFileProtocol =
    typeof location !== 'undefined' && location.protocol === 'file:';

  return {
    platform: 'browser',
    encryption: isSecureStorageAvailable(),
    backend: isFileProtocol ? 'localstorage' : 'indexeddb',
    syncOperations: false,
    maxStorageSize: isFileProtocol ? '~5MB' : '~50MB+',
  };
}

/**
 * Log platform detection results for debugging
 */
export function logPlatformDetection(): void {
  const caps = getPlatformCapabilities();
  console.log('[Storage] Platform detection:', {
    isElectron: isElectron(),
    isBrowser: isBrowser(),
    platform: caps.platform,
    backend: caps.backend,
    encryption: caps.encryption,
  });
}
