/**
 * Power Management Service — Android Doze mode and wake lock handling
 *
 * Manages wake locks and battery optimization whitelisting to keep
 * I2P connections alive during Doze mode.
 */

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface PowerManagementPlugin {
  /**
   * Check if the app is whitelisted from battery optimization
   */
  isIgnoringBatteryOptimizations(): Promise<{ isIgnoring: boolean }>;

  /**
   * Request battery optimization exemption
   * Opens system settings for the user to whitelist the app
   */
  requestBatteryOptimizations(): Promise<{ success: boolean }>;

  /**
   * Open battery optimization settings for this app
   */
  openBatteryOptimizationSettings(): Promise<void>;

  /**
   * Acquire a partial wake lock to keep CPU running
   */
  acquireWakeLock(options?: { timeout?: number }): Promise<{ success: boolean }>;

  /**
   * Release the wake lock
   */
  releaseWakeLock(): Promise<void>;

  /**
   * Check if wake lock is currently held
   */
  isWakeLockHeld(): Promise<{ held: boolean }>;

  /**
   * Check if device is currently in Doze mode
   */
  isDeviceIdleMode(): Promise<{ isIdle: boolean }>;

  /**
   * Check if app is in power save mode
   */
  isPowerSaveMode(): Promise<{ isPowerSaveMode: boolean }>;

  /**
   * Listen for Doze mode changes
   */
  addListener(
    eventName: 'dozeModeChange',
    listener: (state: { isIdle: boolean }) => void
  ): Promise<PluginListenerHandle>;

  /**
   * Listen for power save mode changes
   */
  addListener(
    eventName: 'powerSaveModeChange',
    listener: (state: { isPowerSaveMode: boolean }) => void
  ): Promise<PluginListenerHandle>;

  /**
   * Remove all listeners
   */
  removeAllListeners(): Promise<void>;
}

// Register the plugin - will use web implementation if native is not available
const PowerManagement = registerPlugin<PowerManagementPlugin>('PowerManagement', {
  web: () => import('./powerManagementWeb').then(m => new m.PowerManagementWeb()),
});

export interface PowerState {
  isIgnoringBatteryOptimizations: boolean;
  isWakeLockHeld: boolean;
  isDozeMode: boolean;
  isPowerSaveMode: boolean;
}

class PowerManagementService {
  private wakeLockRefreshInterval: ReturnType<typeof setInterval> | null = null;
  private readonly WAKE_LOCK_TIMEOUT = 10 * 60 * 1000; // 10 minutes
  private readonly WAKE_LOCK_REFRESH_INTERVAL = 8 * 60 * 1000; // Refresh every 8 minutes
  private listeners: PluginListenerHandle[] = [];
  private stateChangeCallbacks: ((state: PowerState) => void)[] = [];
  private currentState: PowerState = {
    isIgnoringBatteryOptimizations: false,
    isWakeLockHeld: false,
    isDozeMode: false,
    isPowerSaveMode: false,
  };

  /**
   * Initialize power management service
   */
  async initialize(): Promise<void> {
    try {
      // Check initial state
      await this.refreshState();

      // Set up listeners for power state changes
      await this.setupListeners();
    } catch (error) {
      console.warn('[PowerManagement] Initialization failed:', error);
    }
  }

  /**
   * Get current power state
   */
  getState(): PowerState {
    return { ...this.currentState };
  }

  /**
   * Check if battery optimization is ignored
   */
  async isIgnoringBatteryOptimizations(): Promise<boolean> {
    try {
      const result = await PowerManagement.isIgnoringBatteryOptimizations();
      return result.isIgnoring;
    } catch {
      return false;
    }
  }

  /**
   * Request battery optimization exemption from user
   */
  async requestBatteryOptimizations(): Promise<boolean> {
    try {
      const result = await PowerManagement.requestBatteryOptimizations();
      await this.refreshState();
      return result.success;
    } catch (error) {
      console.warn('[PowerManagement] Failed to request battery optimizations:', error);
      return false;
    }
  }

  /**
   * Open battery optimization settings
   */
  async openBatteryOptimizationSettings(): Promise<void> {
    try {
      await PowerManagement.openBatteryOptimizationSettings();
    } catch (error) {
      console.warn('[PowerManagement] Failed to open settings:', error);
    }
  }

  /**
   * Acquire wake lock with automatic refresh
   */
  async acquireWakeLock(): Promise<boolean> {
    try {
      // Release existing wake lock first
      await this.releaseWakeLock();

      // Acquire new wake lock
      const result = await PowerManagement.acquireWakeLock({
        timeout: this.WAKE_LOCK_TIMEOUT,
      });

      if (result.success) {
        this.currentState.isWakeLockHeld = true;
        this.notifyStateChange();

        // Set up refresh interval to keep wake lock alive
        this.wakeLockRefreshInterval = setInterval(async () => {
          try {
            await PowerManagement.acquireWakeLock({
              timeout: this.WAKE_LOCK_TIMEOUT,
            });
            console.log('[PowerManagement] Wake lock refreshed');
          } catch (error) {
            console.warn('[PowerManagement] Failed to refresh wake lock:', error);
          }
        }, this.WAKE_LOCK_REFRESH_INTERVAL);
      }

      return result.success;
    } catch (error) {
      console.warn('[PowerManagement] Failed to acquire wake lock:', error);
      return false;
    }
  }

  /**
   * Release wake lock
   */
  async releaseWakeLock(): Promise<void> {
    // Clear refresh interval
    if (this.wakeLockRefreshInterval) {
      clearInterval(this.wakeLockRefreshInterval);
      this.wakeLockRefreshInterval = null;
    }

    try {
      await PowerManagement.releaseWakeLock();
      this.currentState.isWakeLockHeld = false;
      this.notifyStateChange();
    } catch (error) {
      console.warn('[PowerManagement] Failed to release wake lock:', error);
    }
  }

  /**
   * Check if wake lock is held
   */
  async isWakeLockHeld(): Promise<boolean> {
    try {
      const result = await PowerManagement.isWakeLockHeld();
      return result.held;
    } catch {
      return false;
    }
  }

  /**
   * Check if device is in Doze mode
   */
  async isDeviceIdleMode(): Promise<boolean> {
    try {
      const result = await PowerManagement.isDeviceIdleMode();
      return result.isIdle;
    } catch {
      return false;
    }
  }

  /**
   * Check if device is in power save mode
   */
  async isPowerSaveMode(): Promise<boolean> {
    try {
      const result = await PowerManagement.isPowerSaveMode();
      return result.isPowerSaveMode;
    } catch {
      return false;
    }
  }

  /**
   * Register callback for state changes
   */
  onStateChange(callback: (state: PowerState) => void): () => void {
    this.stateChangeCallbacks.push(callback);
    return () => {
      this.stateChangeCallbacks = this.stateChangeCallbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    // Remove all listeners
    for (const listener of this.listeners) {
      try {
        await listener.remove();
      } catch {
        // Ignore removal errors
      }
    }
    this.listeners = [];

    // Release wake lock
    await this.releaseWakeLock();

    // Remove all Capacitor listeners
    try {
      await PowerManagement.removeAllListeners();
    } catch {
      // Ignore
    }

    this.stateChangeCallbacks = [];
  }

  private async refreshState(): Promise<void> {
    try {
      // Use Promise.allSettled to handle partial failures gracefully
      const results = await Promise.allSettled([
        this.isIgnoringBatteryOptimizations(),
        this.isWakeLockHeld(),
        this.isDeviceIdleMode(),
        this.isPowerSaveMode(),
      ]);

      const [batteryOpt, wakeLock, doze, powerSave] = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value;
        }
        console.warn(`[PowerManagement] Failed to get state at index ${index}:`, result.reason);
        return false;
      });

      this.currentState = {
        isIgnoringBatteryOptimizations: batteryOpt,
        isWakeLockHeld: wakeLock,
        isDozeMode: doze,
        isPowerSaveMode: powerSave,
      };

      this.notifyStateChange();
    } catch (error) {
      console.warn('[PowerManagement] Failed to refresh state:', error);
    }
  }

  private async setupListeners(): Promise<void> {
    try {
      // Listen for Doze mode changes
      const dozeListener = await PowerManagement.addListener('dozeModeChange', (state) => {
        this.currentState.isDozeMode = state.isIdle;
        this.notifyStateChange();
      });
      this.listeners.push(dozeListener);

      // Listen for power save mode changes
      const powerSaveListener = await PowerManagement.addListener('powerSaveModeChange', (state) => {
        this.currentState.isPowerSaveMode = state.isPowerSaveMode;
        this.notifyStateChange();
      });
      this.listeners.push(powerSaveListener);
    } catch (error) {
      console.warn('[PowerManagement] Failed to set up listeners:', error);
    }
  }

  private notifyStateChange(): void {
    for (const callback of this.stateChangeCallbacks) {
      try {
        callback({ ...this.currentState });
      } catch (error) {
        console.warn('[PowerManagement] State change callback error:', error);
      }
    }
  }
}

export const powerManagementService = new PowerManagementService();
export { PowerManagement };
