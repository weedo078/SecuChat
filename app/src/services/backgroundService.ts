/**
 * Background Service — Android Foreground Service for I2P Connection
 *
 * Maintains I2P connection when app is in background by running a
 * foreground service with persistent notification. Prevents Android
 * from killing the app during background operation.
 */

import { ForegroundService } from '@capawesome-team/capacitor-android-foreground-service';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { Capacitor } from '@capacitor/core';
import { logger } from '@/utils/logger';

export type BackgroundServiceStatus = 'stopped' | 'starting' | 'running' | 'error';

interface ServiceState {
  status: BackgroundServiceStatus;
  error?: string;
}

class BackgroundService {
  private state: ServiceState = { status: 'stopped' };
  private readonly isAndroid: boolean;
  private statusChangeHandlers: ((status: BackgroundServiceStatus) => void)[] = [];

  constructor() {
    this.isAndroid = Capacitor.getPlatform() === 'android';
  }

  /**
   * Check if foreground service is available on this platform
   */
  isAvailable(): boolean {
    return this.isAndroid;
  }

  /**
   * Start the foreground service with persistent notification
   */
  async startService(): Promise<boolean> {
    if (!this.isAndroid) {
      logger.log('[BackgroundService] Not on Android, skipping foreground service');
      return false;
    }

    if (this.state.status === 'running') {
      logger.log('[BackgroundService] Service already running');
      return true;
    }

    this.setState({ status: 'starting' });

    try {
      // Start foreground service with persistent notification
      await ForegroundService.startForegroundService({
        title: 'SecuChat I2P Connection',
        body: 'Maintaining secure connection...',
        smallIcon: 'ic_launcher_foreground',
        id: 1001,
      });

      this.setState({ status: 'running' });
      logger.log('[BackgroundService] Foreground service started');
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[BackgroundService] Failed to start service:', error);
      this.setState({ status: 'error', error: errorMessage });
      return false;
    }
  }

  /**
   * Stop the foreground service
   */
  async stopService(): Promise<boolean> {
    if (!this.isAndroid) {
      return false;
    }

    if (this.state.status === 'stopped') {
      return true;
    }

    try {
      await ForegroundService.stopForegroundService();
      this.setState({ status: 'stopped' });
      logger.log('[BackgroundService] Foreground service stopped');
      return true;
    } catch (error) {
      logger.error('[BackgroundService] Failed to stop service:', error);
      return false;
    }
  }

  /**
   * Update notification text based on connection status
   */
  async updateNotification(status: 'connected' | 'disconnected' | 'connecting' | 'error'): Promise<void> {
    if (!this.isAndroid || this.state.status !== 'running') {
      return;
    }

    let body: string;
    switch (status) {
      case 'connected':
        body = 'I2P connection active - receiving messages';
        break;
      case 'connecting':
        body = 'Establishing I2P connection...';
        break;
      case 'error':
        body = 'I2P connection error - tap to reconnect';
        break;
      case 'disconnected':
      default:
        body = 'I2P disconnected - tap to open app';
        break;
    }

    try {
      await ForegroundService.updateForegroundService({
        title: 'SecuChat I2P Connection',
        body: body,
        id: 1001,
        smallIcon: 'ic_launcher_foreground',
      });
      logger.log('[BackgroundService] Notification updated:', status);
    } catch (error) {
      logger.error('[BackgroundService] Failed to update notification:', error);
    }
  }

  /**
   * Keep the device awake (prevent sleep)
   */
  async keepAwake(): Promise<void> {
    if (!this.isAndroid) {
      return;
    }

    try {
      await KeepAwake.keepAwake();
      logger.log('[BackgroundService] Device kept awake');
    } catch (error) {
      logger.error('[BackgroundService] Failed to keep awake:', error);
    }
  }

  /**
   * Allow device to sleep
   */
  async allowSleep(): Promise<void> {
    if (!this.isAndroid) {
      return;
    }

    try {
      await KeepAwake.allowSleep();
      logger.log('[BackgroundService] Device can sleep');
    } catch (error) {
      logger.error('[BackgroundService] Failed to allow sleep:', error);
    }
  }

  /**
   * Get current service status
   */
  getStatus(): BackgroundServiceStatus {
    return this.state.status;
  }

  /**
   * Check if service is running
   */
  isRunning(): boolean {
    return this.state.status === 'running';
  }

  /**
   * Register status change handler
   */
  onStatusChange(handler: (status: BackgroundServiceStatus) => void): void {
    this.statusChangeHandlers.push(handler);
  }

  /**
   * Unregister status change handler
   */
  offStatusChange(handler: (status: BackgroundServiceStatus) => void): void {
    this.statusChangeHandlers = this.statusChangeHandlers.filter(h => h !== handler);
  }

  private setState(newState: ServiceState): void {
    const oldStatus = this.state.status;
    this.state = newState;
    if (oldStatus !== newState.status) {
      this.statusChangeHandlers.forEach(handler => handler(newState.status));
    }
  }
}

export const backgroundService = new BackgroundService();
