// Platform Types
// Type definitions for platform detection and Capacitor integration

/**
 * Capacitor platform types
 */
export type CapacitorPlatform = 'ios' | 'android' | 'web';

/**
 * Native platform information
 */
export interface NativePlatformInfo {
  /** Whether running in a native environment */
  isNative: boolean;
  /** Capacitor platform (if applicable) */
  capacitorPlatform: CapacitorPlatform | null;
  /** Whether running in Electron */
  isElectron: boolean;
  /** Whether running in web browser */
  isWeb: boolean;
}

/**
 * Platform capabilities for feature detection
 */
export interface PlatformCapabilities {
  /** Can use native file system */
  nativeFileSystem: boolean;
  /** Can use native sharing */
  nativeSharing: boolean;
  /** Can use native storage (Preferences/Filesystem) */
  nativeStorage: boolean;
  /** Can use push notifications */
  pushNotifications: boolean;
  /** Can use biometric auth */
  biometricAuth: boolean;
}
