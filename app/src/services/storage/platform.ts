// Platform Detection - Phase 1 + Capacitor Support
// Detects the runtime environment and selects appropriate storage provider

import type { StoragePlatform } from './types';

// Capacitor detection state
let capacitorChecked = false;
let isCapacitorNative = false;

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
 * Detect if running in Capacitor native environment
 * Lazy-loads Capacitor to avoid errors in browser
 */
export async function isCapacitor(): Promise<boolean> {
  if (capacitorChecked) {
    return isCapacitorNative;
  }

  try {
    // Lazy load Capacitor to avoid errors in browser
    const { Capacitor } = await import('@capacitor/core');
    isCapacitorNative = Capacitor.isNativePlatform();
  } catch {
    // Capacitor not available
    isCapacitorNative = false;
  }

  capacitorChecked = true;
  return isCapacitorNative;
}

/**
 * Synchronous check for Capacitor (use after isCapacitor has been called)
 */
export function isCapacitorSync(): boolean {
  return isCapacitorNative;
}

/**
 * Detect if running in browser environment
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && !isElectronRenderer();
}

/**
 * Get the current storage platform
 * Returns 'capacitor' if in Capacitor native, 'electron' if in Electron, 'browser' otherwise
 */
export async function getStoragePlatform(): Promise<StoragePlatform> {
  if (isElectron()) {
    return 'electron';
  }

  if (await isCapacitor()) {
    return 'capacitor';
  }

  return 'browser';
}

/**
 * Synchronous version - use only after platform has been detected
 */
export function getStoragePlatformSync(): StoragePlatform {
  if (isElectron()) {
    return 'electron';
  }

  if (isCapacitorSync()) {
    return 'capacitor';
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
  backend: 'indexeddb' | 'sqlite' | 'localstorage' | 'native';
  /** Supports synchronous operations */
  syncOperations: boolean;
  /** Maximum storage size (approximate) */
  maxStorageSize: string;
}

/**
 * Get platform capabilities
 */
export async function getPlatformCapabilities(): Promise<PlatformCapabilities> {
  const platform = await getStoragePlatform();

  if (platform === 'electron') {
    return {
      platform: 'electron',
      encryption: true,
      backend: 'sqlite',
      syncOperations: true,
      maxStorageSize: 'unlimited (disk space)',
    };
  }

  if (platform === 'capacitor') {
    return {
      platform: 'capacitor',
      encryption: true,
      backend: 'native',
      syncOperations: false,
      maxStorageSize: 'unlimited (device storage)',
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
export async function logPlatformDetection(): Promise<void> {
  const caps = await getPlatformCapabilities();
  console.log('[Storage] Platform detection:', {
    isElectron: isElectron(),
    isCapacitor: isCapacitorSync(),
    isBrowser: isBrowser(),
    platform: caps.platform,
    backend: caps.backend,
    encryption: caps.encryption,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A',
    hasElectronAPI: typeof window !== 'undefined' && !!(window as unknown as { electronAPI?: unknown }).electronAPI,
  });
}
