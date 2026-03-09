// IPC Handlers for Storage - Phase 3
// Registers all storage IPC handlers for renderer process communication

import { ipcMain } from 'electron';
import { StorageRepository } from './repository';
import { initializeDatabase, closeDatabase } from './database';

// Repository instance (lazy loaded)
let repository: StorageRepository | null = null;

/**
 * Get or create the storage repository
 */
function getRepository(): StorageRepository {
  if (!repository) {
    initializeDatabase();
    repository = new StorageRepository();
  }
  return repository;
}

/**
 * Register all storage IPC handlers
 * Must be called from main process before app is ready
 */
export function registerStorageIpcHandlers(): void {
  console.log('[Storage] Registering IPC handlers');

  // Initialization
  ipcMain.handle('storage:init', async () => {
    try {
      getRepository();
      return { success: true };
    } catch (error) {
      console.error('[Storage] Init error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Passphrase management
  ipcMain.handle('storage:setPassphrase', (_event, passphrase: string) => {
    try {
      getRepository().setEncryptionPassphrase(passphrase);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Set passphrase error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:clearPassphrase', () => {
    try {
      getRepository().clearEncryptionPassphrase();
      return { success: true };
    } catch (error) {
      console.error('[Storage] Clear passphrase error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:hasPassphrase', () => {
    try {
      return { success: true, data: getRepository().hasEncryptionPassphrase() };
    } catch (error) {
      console.error('[Storage] Has passphrase error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // User operations
  ipcMain.handle('storage:saveUser', (_event, user: unknown) => {
    try {
      getRepository().saveUser(user as Parameters<StorageRepository['saveUser']>[0]);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Save user error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getUser', () => {
    try {
      const user = getRepository().getUser();
      return { success: true, data: user };
    } catch (error) {
      console.error('[Storage] Get user error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:deleteUser', () => {
    try {
      getRepository().deleteUser();
      return { success: true };
    } catch (error) {
      console.error('[Storage] Delete user error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Contact operations
  ipcMain.handle('storage:saveContact', (_event, contact: unknown) => {
    try {
      getRepository().saveContact(contact as Parameters<StorageRepository['saveContact']>[0]);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Save contact error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getContact', (_event, id: string) => {
    try {
      const contact = getRepository().getContact(id);
      return { success: true, data: contact };
    } catch (error) {
      console.error('[Storage] Get contact error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getContactByFingerprint', (_event, fingerprint: string) => {
    try {
      const contact = getRepository().getContactByFingerprint(fingerprint);
      return { success: true, data: contact };
    } catch (error) {
      console.error('[Storage] Get contact by fingerprint error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getAllContacts', () => {
    try {
      const contacts = getRepository().getAllContacts();
      return { success: true, data: contacts };
    } catch (error) {
      console.error('[Storage] Get all contacts error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:deleteContact', (_event, id: string) => {
    try {
      getRepository().deleteContact(id);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Delete contact error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Chat operations
  ipcMain.handle('storage:saveChat', (_event, chat: unknown) => {
    try {
      getRepository().saveChat(chat as Parameters<StorageRepository['saveChat']>[0]);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Save chat error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getChat', (_event, id: string) => {
    try {
      const chat = getRepository().getChat(id);
      return { success: true, data: chat };
    } catch (error) {
      console.error('[Storage] Get chat error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getChatByContactId', (_event, contactId: string) => {
    try {
      const chat = getRepository().getChatByContactId(contactId);
      return { success: true, data: chat };
    } catch (error) {
      console.error('[Storage] Get chat by contact ID error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getAllChats', () => {
    try {
      const chats = getRepository().getAllChats();
      return { success: true, data: chats };
    } catch (error) {
      console.error('[Storage] Get all chats error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:deleteChat', (_event, id: string) => {
    try {
      getRepository().deleteChat(id);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Delete chat error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Message operations
  ipcMain.handle('storage:saveMessage', (_event, message: unknown) => {
    try {
      getRepository().saveMessage(message as Parameters<StorageRepository['saveMessage']>[0]);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Save message error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getMessage', (_event, id: string) => {
    try {
      const message = getRepository().getMessage(id);
      return { success: true, data: message };
    } catch (error) {
      console.error('[Storage] Get message error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getMessagesByChat', (_event, chatId: string, limit?: number, offset?: number) => {
    try {
      const messages = getRepository().getMessagesByChat(chatId, limit, offset);
      return { success: true, data: messages };
    } catch (error) {
      console.error('[Storage] Get messages by chat error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getMessagesByChatId', (_event, chatId: string) => {
    try {
      const messages = getRepository().getMessagesByChatId(chatId);
      return { success: true, data: messages };
    } catch (error) {
      console.error('[Storage] Get messages by chat ID error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getLastSequence', (_event, chatId: string) => {
    try {
      const sequence = getRepository().getLastMessageSequence(chatId);
      return { success: true, data: sequence };
    } catch (error) {
      console.error('[Storage] Get last sequence error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getAllMessages', () => {
    try {
      const messages = getRepository().getAllMessages();
      return { success: true, data: messages };
    } catch (error) {
      console.error('[Storage] Get all messages error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:deleteMessage', (_event, id: string) => {
    try {
      getRepository().deleteMessage(id);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Delete message error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:deleteMessagesByChat', (_event, chatId: string) => {
    try {
      getRepository().deleteMessagesByChat(chatId);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Delete messages by chat error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Settings operations
  ipcMain.handle('storage:saveSettings', (_event, settings: unknown) => {
    try {
      getRepository().saveSettings(settings as Parameters<StorageRepository['saveSettings']>[0]);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Save settings error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getSettings', () => {
    try {
      const settings = getRepository().getSettings();
      return { success: true, data: settings };
    } catch (error) {
      console.error('[Storage] Get settings error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:saveSecuritySettings', (_event, settings: unknown) => {
    try {
      getRepository().saveSecuritySettings(settings as Parameters<StorageRepository['saveSecuritySettings']>[0]);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Save security settings error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getSecuritySettings', () => {
    try {
      const settings = getRepository().getSecuritySettings();
      return { success: true, data: settings };
    } catch (error) {
      console.error('[Storage] Get security settings error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Device operations
  ipcMain.handle('storage:saveDevice', (_event, device: unknown) => {
    try {
      getRepository().saveDevice(device as Parameters<StorageRepository['saveDevice']>[0]);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Save device error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getDevice', (_event, deviceId: string) => {
    try {
      const device = getRepository().getDevice(deviceId);
      return { success: true, data: device };
    } catch (error) {
      console.error('[Storage] Get device error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getDeviceByI2p', (_event, i2pAddress: string) => {
    try {
      const device = getRepository().getDeviceByI2PAddress(i2pAddress);
      return { success: true, data: device };
    } catch (error) {
      console.error('[Storage] Get device by I2P error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:getAllDevices', () => {
    try {
      const devices = getRepository().getAllDevices();
      return { success: true, data: devices };
    } catch (error) {
      console.error('[Storage] Get all devices error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:deleteDevice', (_event, deviceId: string) => {
    try {
      getRepository().deleteDevice(deviceId);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Delete device error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Backup operations
  ipcMain.handle('storage:createBackup', () => {
    try {
      const backup = getRepository().createBackup();
      return { success: true, data: backup };
    } catch (error) {
      console.error('[Storage] Create backup error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:restoreBackup', (_event, backup: unknown) => {
    try {
      getRepository().restoreBackup(backup as Parameters<StorageRepository['restoreBackup']>[0]);
      return { success: true };
    } catch (error) {
      console.error('[Storage] Restore backup error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('storage:clearAllData', () => {
    try {
      getRepository().clearAllData();
      return { success: true };
    } catch (error) {
      console.error('[Storage] Clear all data error:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  console.log('[Storage] IPC handlers registered');
}

/**
 * Unregister all storage IPC handlers
 * Call before app quits to prevent memory leaks
 */
export function unregisterStorageIpcHandlers(): void {
  const channels = [
    'storage:init',
    'storage:setPassphrase',
    'storage:clearPassphrase',
    'storage:hasPassphrase',
    'storage:saveUser',
    'storage:getUser',
    'storage:deleteUser',
    'storage:saveContact',
    'storage:getContact',
    'storage:getContactByFingerprint',
    'storage:getAllContacts',
    'storage:deleteContact',
    'storage:saveChat',
    'storage:getChat',
    'storage:getChatByContactId',
    'storage:getAllChats',
    'storage:deleteChat',
    'storage:saveMessage',
    'storage:getMessage',
    'storage:getMessagesByChat',
    'storage:getMessagesByChatId',
    'storage:getLastSequence',
    'storage:getAllMessages',
    'storage:deleteMessage',
    'storage:deleteMessagesByChat',
    'storage:saveSettings',
    'storage:getSettings',
    'storage:saveSecuritySettings',
    'storage:getSecuritySettings',
    'storage:saveDevice',
    'storage:getDevice',
    'storage:getDeviceByI2p',
    'storage:getAllDevices',
    'storage:deleteDevice',
    'storage:createBackup',
    'storage:restoreBackup',
    'storage:clearAllData',
  ];

  for (const channel of channels) {
    ipcMain.removeHandler(channel);
  }

  // Close database connection
  closeDatabase();
  repository = null;

  console.log('[Storage] IPC handlers unregistered');
}
