/**
 * Notification Service - Local push notifications for incoming messages
 *
 * Uses @capacitor/local-notifications for privacy-focused local notifications
 * (no FCM/GCM - all notifications are generated locally on the device)
 */

import type { LocalNotificationSchema, ScheduleOptions } from '@capacitor/local-notifications';
import { CapacitorApp } from './capacitorApp';
import type { AppSettings, Contact, Message, NotificationSettings } from '@/types';
import { storageService } from './storage';

let LocalNotifications: typeof import('@capacitor/local-notifications').LocalNotifications | null = null;
let isAvailable = false;

async function loadPlugin() {
  if (typeof window === 'undefined') return;
  try {
    const mod = await import('@capacitor/local-notifications');
    LocalNotifications = mod.LocalNotifications;
    isAvailable = true;
  } catch {
    isAvailable = false;
  }
}

const loadPromise = loadPlugin();

export type NotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export const defaultNotificationSettings: NotificationSettings = {
  enabled: true,
  sound: true,
  vibration: true,
  showPreview: false,
  priority: 'normal',
};

// Legacy interface for backward compatibility
export interface NotificationPreferences {
  enabled: boolean;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  showPreview: boolean;
}

export const defaultNotificationPreferences: NotificationPreferences = {
  enabled: true,
  soundEnabled: true,
  vibrationEnabled: true,
  showPreview: false,
};

// Track pending notifications for grouping
interface PendingNotification {
  contactId: string;
  messageCount: number;
  lastMessage: string;
  timestamp: number;
}

const pendingNotifications = new Map<string, PendingNotification>();
let notificationDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let currentSettings: NotificationSettings = { ...defaultNotificationSettings };

/**
 * Check if local notifications are available (Capacitor native platform)
 */
export async function isNotificationAvailable(): Promise<boolean> {
  await loadPromise;
  return isAvailable;
}

/**
 * Check current notification permission status
 * Returns detailed permission state
 */
export async function checkNotificationPermission(): Promise<NotificationPermission> {
  await loadPromise;

  if (!LocalNotifications) {
    // Fallback to web Notifications API
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    return mapWebPermission(Notification.permission);
  }

  try {
    const result = await LocalNotifications.checkPermissions();
    return mapCapacitorPermission(result.display);
  } catch (error) {
    console.error('[NotificationService] Failed to check permission:', error);
    return 'denied';
  }
}

/**
 * Request notification permission from the user
 * Should be called on first launch or when enabling notifications
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  await loadPromise;

  if (!LocalNotifications) {
    // Fallback to web Notifications API
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    try {
      const result = await Notification.requestPermission();
      return mapWebPermission(result);
    } catch {
      return 'denied';
    }
  }

  try {
    const result = await LocalNotifications.requestPermissions();
    return mapCapacitorPermission(result.display);
  } catch (error) {
    console.error('[NotificationService] Failed to request permission:', error);
    return 'denied';
  }
}

/**
 * Open system notification settings
 * On mobile, opens app settings. On web, shows instructions.
 */
export async function openSystemNotificationSettings(): Promise<void> {
  const isCapacitor = await CapacitorApp.isAvailable();
  if (isCapacitor) {
    try {
      const App = await import('@capacitor/app');
      // App plugin may not have openSettings, handle gracefully
      const appModule = App.App as unknown as { openSettings?: () => Promise<void> };
      if (typeof appModule.openSettings === 'function') {
        await appModule.openSettings();
      } else {
        console.warn('[NotificationService] App.openSettings not available');
      }
      return;
    } catch (error) {
      console.error('[NotificationService] Failed to open app settings:', error);
    }
  }

  // For web, we can't directly open settings
  console.log('[NotificationService] Web platform - cannot open system settings directly');
}

/**
 * Load notification settings from storage
 */
export async function loadNotificationSettings(): Promise<NotificationSettings> {
  try {
    const appSettings = await storageService.getSettings();
    if (appSettings?.notificationSettings) {
      currentSettings = { ...defaultNotificationSettings, ...appSettings.notificationSettings };
      return currentSettings;
    }
  } catch (error) {
    console.error('[NotificationService] Failed to load settings:', error);
  }
  return { ...defaultNotificationSettings };
}

/**
 * Save notification settings to storage
 */
export async function saveNotificationSettings(settings: Partial<NotificationSettings>): Promise<void> {
  currentSettings = { ...currentSettings, ...settings };
  try {
    const appSettings = await storageService.getSettings();
    // Merge with existing settings or create new settings object with defaults
    const settingsToSave: AppSettings = appSettings
      ? { ...appSettings, notificationSettings: currentSettings }
      : {
          theme: 'dark',
          language: 'de',
          notifications: true,
          notificationSettings: currentSettings,
          soundEnabled: true,
          autoLock: true,
          lockTimeout: 5,
          screenshotProtection: true,
          syncEnabled: true,
          deviceName: 'SecuChat Device',
          i2p: {
            mode: 'sam' as const,
            sam: {
              enabled: false,
              host: '127.0.0.1',
              port: 7657,
              nickname: 'secuchat',
            },
          },
        };
    await storageService.saveSettings(settingsToSave);
  } catch (error) {
    console.error('[NotificationService] Failed to save settings:', error);
    throw error; // Re-throw to allow caller to handle
  }
}

/**
 * Get current notification settings
 */
export function getNotificationSettings(): NotificationSettings {
  return { ...currentSettings };
}

/**
 * Check if notifications are enabled (permission granted and setting enabled)
 */
export async function areNotificationsEnabled(): Promise<boolean> {
  const permission = await checkNotificationPermission();
  return permission === 'granted' && currentSettings.enabled;
}

/**
 * Schedule a local notification for an incoming message
 * Notifications are grouped by contact and debounced to avoid spam
 */
export async function scheduleMessageNotification(
  contact: Contact,
  message: Message,
  settings?: NotificationSettings
): Promise<void> {
  await loadPromise;
  if (!LocalNotifications) return;

  const notifSettings = settings || currentSettings;

  // Don't show notifications if disabled
  if (!notifSettings.enabled) return;

  // Don't show notifications for own messages
  if (message.senderId === contact.id) return;

  // Check if app is in foreground - don't show notification
  const appState = await CapacitorApp.getState();
  if (appState?.isActive) return;

  // Build notification content
  const messageContent = message.decryptedContent || message.encryptedContent || '';
  const body = notifSettings.showPreview
    ? truncateMessage(messageContent, 100)
    : 'Neue Nachricht';

  // Track pending notification for grouping
  const existing = pendingNotifications.get(contact.id);
  const messageCount = existing ? existing.messageCount + 1 : 1;

  pendingNotifications.set(contact.id, {
    contactId: contact.id,
    messageCount,
    lastMessage: body,
    timestamp: Date.now(),
  });

  // Debounce notification scheduling to group rapid messages
  if (notificationDebounceTimer) {
    clearTimeout(notificationDebounceTimer);
  }

  notificationDebounceTimer = setTimeout(() => {
    void flushPendingNotifications(notifSettings);
  }, 500); // 500ms debounce
}

/**
 * Flush all pending notifications to the system
 */
async function flushPendingNotifications(settings: NotificationSettings): Promise<void> {
  if (!LocalNotifications || pendingNotifications.size === 0) return;

  const notifications: LocalNotificationSchema[] = [];

  for (const [contactId, pending] of pendingNotifications) {
    const notificationBody = buildNotificationBody(pending, settings);

    notifications.push({
      id: generateNotificationId(contactId),
      title: pending.messageCount > 1
        ? `${pending.messageCount} neue Nachrichten`
        : pending.lastMessage,
      body: notificationBody,
      largeBody: pending.lastMessage,
      summaryText: `${pending.messageCount} Nachrichten`,
      iconColor: '#2dd4bf', // emerald-500
      sound: settings.sound ? 'default' : undefined,
      group: contactId, // Group by contact
      // Deep link to open specific chat
      extra: {
        contactId,
        type: 'chat-message',
      },
      // Android channel configuration based on priority
      channelId: getChannelIdForPriority(settings.priority),
    });
  }

  try {
    const options: ScheduleOptions = { notifications };
    await LocalNotifications.schedule(options);
    pendingNotifications.clear();
  } catch (error) {
    console.error('[NotificationService] Failed to schedule notifications:', error);
  }
}

/**
 * Get channel ID based on priority
 */
function getChannelIdForPriority(priority: NotificationSettings['priority']): string {
  switch (priority) {
    case 'high':
      return 'secuchat-messages-high';
    case 'low':
      return 'secuchat-messages-low';
    case 'normal':
    default:
      return 'secuchat-messages';
  }
}

/**
 * Build notification body based on preferences and message count
 */
function buildNotificationBody(
  pending: PendingNotification,
  settings: NotificationSettings
): string {
  if (pending.messageCount === 1) {
    return settings.showPreview ? pending.lastMessage : 'Neue Nachricht';
  }
  return `${pending.messageCount} neue Nachrichten`;
}

/**
 * Generate a consistent numeric notification ID for a contact
 */
function generateNotificationId(contactId: string): number {
  // Simple hash of contactId to number
  let hash = 0;
  for (let i = 0; i < contactId.length; i++) {
    const char = contactId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash) % 2147483647; // Max int32
}

/**
 * Truncate message text for notification preview
 */
function truncateMessage(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Cancel all pending notifications for a contact
 * Call this when user opens the chat
 */
export async function cancelNotificationsForContact(contactId: string): Promise<void> {
  await loadPromise;
  if (!LocalNotifications) return;

  try {
    const notificationId = generateNotificationId(contactId);
    await LocalNotifications.cancel({ notifications: [{ id: notificationId }] });
    pendingNotifications.delete(contactId);
  } catch (error) {
    console.error('[NotificationService] Failed to cancel notifications:', error);
  }
}

/**
 * Cancel all pending notifications
 */
export async function cancelAllNotifications(): Promise<void> {
  await loadPromise;
  if (!LocalNotifications) return;

  try {
    await LocalNotifications.cancel({ notifications: [] });
    pendingNotifications.clear();
  } catch (error) {
    console.error('[NotificationService] Failed to cancel all notifications:', error);
  }
}

/**
 * Create notification channels for different priorities (Android)
 * Should be called during app initialization
 */
export async function createNotificationChannels(): Promise<void> {
  await loadPromise;
  if (!LocalNotifications) return;

  try {
    // Check if createChannel method exists (Android-specific)
    const ln = LocalNotifications as unknown as {
      createChannel?: (options: { channel: unknown }) => Promise<void>;
      deleteChannel?: (options: { id: string }) => Promise<void>;
    };

    if (typeof ln.createChannel === 'function') {
      // High priority channel
      await ln.createChannel({
        channel: {
          id: 'secuchat-messages-high',
          name: 'SecuChat Nachrichten (Hoch)',
          description: 'Wichtige Benachrichtigungen mit hoher Priorität',
          importance: 5, // Max importance
          visibility: 1, // Public visibility
          sound: 'default',
          vibration: true,
          lights: true,
          lightColor: '#2dd4bf',
        },
      });

      // Normal priority channel (default)
      await ln.createChannel({
        channel: {
          id: 'secuchat-messages',
          name: 'SecuChat Nachrichten',
          description: 'Standard-Benachrichtigungen für eingehende Nachrichten',
          importance: 4, // High importance
          visibility: 1,
          sound: 'default',
          vibration: true,
          lights: true,
          lightColor: '#2dd4bf',
        },
      });

      // Low priority channel
      await ln.createChannel({
        channel: {
          id: 'secuchat-messages-low',
          name: 'SecuChat Nachrichten (Niedrig)',
          description: 'Unwichtige Benachrichtigungen ohne Störung',
          importance: 2, // Low importance
          visibility: 1,
          sound: undefined,
          vibration: false,
          lights: false,
        },
      });
    }
  } catch (error) {
    console.error('[NotificationService] Failed to create notification channels:', error);
  }
}

/**
 * @deprecated Use createNotificationChannels instead
 */
export async function createNotificationChannel(): Promise<void> {
  await createNotificationChannels();
}

/**
 * Set up notification action listeners (tapping notification)
 * Returns a cleanup function
 */
export function setupNotificationListeners(
  onNotificationTap: (contactId: string) => void
): () => void {
  let cleanup = () => {};

  loadPromise.then(() => {
    if (!LocalNotifications) return;

    // Listen for notification taps
    const listener = LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
      const contactId = event.notification.extra?.contactId as string | undefined;
      if (contactId) {
        onNotificationTap(contactId);
      }
    });

    cleanup = () => {
      listener.then(l => l.remove());
    };
  });

  return () => cleanup();
}

/**
 * Initialize notification service
 * - Loads settings from storage
 * - Creates notification channels
 * - Sets up listeners
 * - Returns cleanup function
 */
export function initializeNotificationService(
  onNotificationTap: (contactId: string) => void
): () => void {
  // Load settings
  void loadNotificationSettings();

  // Create channels on init
  void createNotificationChannels();

  // Set up tap listener
  const cleanupListener = setupNotificationListeners(onNotificationTap);

  return () => {
    cleanupListener();
  };
}

// Helper functions for permission mapping
function mapCapacitorPermission(permission: string): NotificationPermission {
  switch (permission) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'prompt':
    default:
      return 'default';
  }
}

function mapWebPermission(permission: NotificationPermission | string): NotificationPermission {
  switch (permission) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'default':
    default:
      return 'default';
  }
}
