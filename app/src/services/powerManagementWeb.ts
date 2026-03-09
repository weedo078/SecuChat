/**
 * Web implementation of PowerManagement plugin
 * Provides stubs for web platform where native power management is not available
 */

import type { PowerManagementPlugin } from './powerManagement';
import type { PluginListenerHandle } from '@capacitor/core';

export class PowerManagementWeb implements PowerManagementPlugin {
  private wakeLockHeld = false;
  private dozeMode = false;
  private powerSaveMode = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners: Map<string, Set<(state: any) => void>> = new Map();

  async isIgnoringBatteryOptimizations(): Promise<{ isIgnoring: boolean }> {
    // Web doesn't have battery optimization concept
    return { isIgnoring: true };
  }

  async requestBatteryOptimizations(): Promise<{ success: boolean }> {
    // No-op on web
    return { success: true };
  }

  async openBatteryOptimizationSettings(): Promise<void> {
    // No-op on web
    console.log('[PowerManagementWeb] Battery optimization settings not available on web');
  }

  async acquireWakeLock(_options?: { timeout?: number }): Promise<{ success: boolean }> {
    void _options; // Reserved for future timeout implementation
    // Try to use Screen Wake Lock API if available
    try {
      if ('wakeLock' in navigator) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (navigator as any).wakeLock.request('screen');
        this.wakeLockHeld = true;
        return { success: true };
      }
    } catch (error) {
      console.warn('[PowerManagementWeb] Failed to acquire wake lock:', error);
    }

    // Fallback: just track state
    this.wakeLockHeld = true;
    return { success: true };
  }

  async releaseWakeLock(): Promise<void> {
    this.wakeLockHeld = false;
    // Note: Screen Wake Lock API doesn't have a direct release method
    // It releases when the tab is no longer visible
  }

  async isWakeLockHeld(): Promise<{ held: boolean }> {
    return { held: this.wakeLockHeld };
  }

  async isDeviceIdleMode(): Promise<{ isIdle: boolean }> {
    // Check if document is hidden (similar to background)
    this.dozeMode = document.hidden;
    return { isIdle: this.dozeMode };
  }

  async isPowerSaveMode(): Promise<{ isPowerSaveMode: boolean }> {
    // Check Battery API if available
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const battery = await (navigator as any).getBattery?.();
      if (battery) {
        // Consider power save mode if battery is low (< 20%) and not charging
        this.powerSaveMode = battery.level < 0.2 && !battery.charging;
      }
    } catch {
      // Battery API not available
    }
    return { isPowerSaveMode: this.powerSaveMode };
  }

  async addListener(
    eventName: 'dozeModeChange',
    listener: (state: { isIdle: boolean }) => void
  ): Promise<PluginListenerHandle>;
  async addListener(
    eventName: 'powerSaveModeChange',
    listener: (state: { isPowerSaveMode: boolean }) => void
  ): Promise<PluginListenerHandle>;
  async addListener(
    eventName: 'dozeModeChange' | 'powerSaveModeChange',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener: (state: any) => void
  ): Promise<PluginListenerHandle> {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    this.listeners.get(eventName)!.add(listener);

    // Set up visibility change listener for doze mode simulation
    if (eventName === 'dozeModeChange' && !this.hasDocumentListener) {
      this.setupDocumentListeners();
    }

    return {
      remove: async () => {
        this.listeners.get(eventName)?.delete(listener);
      },
    };
  }

  async removeAllListeners(): Promise<void> {
    this.listeners.clear();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.hasDocumentListener = false;
  }

  private hasDocumentListener = false;
  private visibilityHandler: (() => void) | null = null;

  private setupDocumentListeners(): void {
    if (this.hasDocumentListener) return;

    this.visibilityHandler = () => {
      const isHidden = document.hidden;
      this.dozeMode = isHidden;

      // Notify doze mode listeners
      const dozeListeners = this.listeners.get('dozeModeChange');
      if (dozeListeners) {
        for (const listener of dozeListeners) {
          listener({ isIdle: isHidden });
        }
      }
    };

    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.hasDocumentListener = true;
  }
}
