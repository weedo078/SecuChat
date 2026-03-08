// SQLite Repository - Phase 3
// CRUD operations for all entities

import type { Database, Statement } from 'better-sqlite3';
import { getDatabase, runTransaction } from './database';
import { encryptData, decryptData, appearsEncrypted } from './encryption';

// Type definitions matching app/src/types
export interface User {
  id: string;
  username: string;
  deviceId: string;
  deviceName?: string;
  pgpPublicKey: string;
  pgpPrivateKey?: string;
  fingerprint: string;
  i2pAddress: string;
  i2pPublicKey?: string;
  i2pPrivateKey?: string;
  i2pSamDestination?: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  name: string;
  pgpPublicKey: string;
  fingerprint: string;
  p2pIdentifier: string;
  i2pAddress: string;
  lastSeen?: string;
  status: 'online' | 'offline' | 'unknown';
}

export interface Chat {
  id: string;
  contactId: string;
  contact?: Contact;  // Populated when fetching from repository
  lastMessageTimestamp?: string;
  unreadCount: number;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  recipientId: string;
  encryptedContent: string;
  timestamp: string;
  sequenceNumber: number;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  type: 'text' | 'image' | 'file' | 'system';
  replyTo?: string;
  fileInfo?: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    url?: string;
  };
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  i2pAddress: string;
  lastSync?: string;
  status: 'online' | 'offline';
}

export interface AppSettings {
  theme: 'dark' | 'light';
  language: string;
  notifications: boolean;
  soundEnabled: boolean;
  autoLock: boolean;
  lockTimeout: number;
  screenshotProtection: boolean;
  syncEnabled: boolean;
  deviceName: string;
  i2p: {
    mode: 'auto' | 'native' | 'sam';
    sam: {
      enabled: boolean;
      host: string;
      port: number;
      nickname: string;
    };
  };
}

export interface SecuritySettings {
  biometricEnabled: boolean;
  pinEnabled: boolean;
  duressPin?: string;
  autoLockEnabled: boolean;
  autoLockTimeout: number;
}

export interface BackupData {
  version: string;
  timestamp: string;
  user: User;
  contacts: Contact[];
  chats: Chat[];
  messages: Message[];
  devices: DeviceInfo[];
}

/**
 * Repository class for all storage operations
 * Handles encryption/decryption of sensitive fields
 */
export class StorageRepository {
  private db: Database;
  private encryptionPassphrase: string | null = null;

  // Prepared statements cache
  private statements: Map<string, Statement> = new Map();

  constructor(database?: Database) {
    this.db = database || getDatabase();
  }

  /**
   * Set encryption passphrase for sensitive data
   */
  setEncryptionPassphrase(passphrase: string): void {
    this.encryptionPassphrase = passphrase;
  }

  /**
   * Clear encryption passphrase
   */
  clearEncryptionPassphrase(): void {
    this.encryptionPassphrase = null;
  }

  /**
   * Check if encryption passphrase is set
   */
  hasEncryptionPassphrase(): boolean {
    return this.encryptionPassphrase !== null;
  }

  /**
   * Get or prepare a statement
   */
  private getStatement(sql: string): Statement {
    if (!this.statements.has(sql)) {
      this.statements.set(sql, this.db.prepare(sql));
    }
    return this.statements.get(sql)!;
  }

  // User Operations

  saveUser(user: User): void {
    let userToStore = { ...user };

    // Encrypt sensitive fields if passphrase is set
    if (this.encryptionPassphrase && (user.pgpPrivateKey || user.i2pPrivateKey)) {
      if (user.pgpPrivateKey) {
        userToStore.pgpPrivateKey = encryptData(user.pgpPrivateKey, this.encryptionPassphrase);
      }
      if (user.i2pPrivateKey) {
        userToStore.i2pPrivateKey = encryptData(user.i2pPrivateKey, this.encryptionPassphrase);
      }
    }

    const stmt = this.getStatement(`
      INSERT INTO users (id, username, device_id, device_name, pgp_public_key, pgp_private_key,
        fingerprint, i2p_address, i2p_public_key, i2p_private_key, i2p_sam_destination, created_at)
      VALUES (@id, @username, @deviceId, @deviceName, @pgpPublicKey, @pgpPrivateKey,
        @fingerprint, @i2pAddress, @i2pPublicKey, @i2pPrivateKey, @i2pSamDestination, @createdAt)
      ON CONFLICT(id) DO UPDATE SET
        username = @username,
        device_id = @deviceId,
        device_name = @deviceName,
        pgp_public_key = @pgpPublicKey,
        pgp_private_key = @pgpPrivateKey,
        fingerprint = @fingerprint,
        i2p_address = @i2pAddress,
        i2p_public_key = @i2pPublicKey,
        i2p_private_key = @i2pPrivateKey,
        i2p_sam_destination = @i2pSamDestination,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run({
      id: userToStore.id,
      username: userToStore.username,
      deviceId: userToStore.deviceId,
      deviceName: userToStore.deviceName ?? null,
      pgpPublicKey: userToStore.pgpPublicKey,
      pgpPrivateKey: userToStore.pgpPrivateKey ?? null,
      fingerprint: userToStore.fingerprint,
      i2pAddress: userToStore.i2pAddress,
      i2pPublicKey: userToStore.i2pPublicKey ?? null,
      i2pPrivateKey: userToStore.i2pPrivateKey ?? null,
      i2pSamDestination: userToStore.i2pSamDestination ?? null,
      createdAt: userToStore.createdAt,
    });
  }

  getUser(): User | null {
    const stmt = this.getStatement('SELECT * FROM users LIMIT 1');
    const row = stmt.get() as Record<string, unknown> | undefined;

    if (!row) return null;

    const user = this.rowToUser(row);

    // Decrypt sensitive fields if passphrase is set
    if (this.encryptionPassphrase && (user.pgpPrivateKey || user.i2pPrivateKey)) {
      try {
        if (user.pgpPrivateKey && appearsEncrypted(user.pgpPrivateKey)) {
          user.pgpPrivateKey = decryptData(user.pgpPrivateKey, this.encryptionPassphrase);
        }
        if (user.i2pPrivateKey && appearsEncrypted(user.i2pPrivateKey)) {
          user.i2pPrivateKey = decryptData(user.i2pPrivateKey, this.encryptionPassphrase);
        }
      } catch (error) {
        console.error('Failed to decrypt user data:', error);
        throw new Error('Falsches Passwort oder Daten beschädigt');
      }
    }

    return user;
  }

  deleteUser(): void {
    const stmt = this.getStatement('DELETE FROM users');
    stmt.run();
  }

  // Contact Operations

  saveContact(contact: Contact): void {
    const stmt = this.getStatement(`
      INSERT INTO contacts (id, name, pgp_public_key, fingerprint, p2p_identifier, i2p_address, last_seen, status)
      VALUES (@id, @name, @pgpPublicKey, @fingerprint, @p2pIdentifier, @i2pAddress, @lastSeen, @status)
      ON CONFLICT(id) DO UPDATE SET
        name = @name,
        pgp_public_key = @pgpPublicKey,
        fingerprint = @fingerprint,
        p2p_identifier = @p2pIdentifier,
        i2p_address = @i2pAddress,
        last_seen = @lastSeen,
        status = @status
    `);

    stmt.run({
      id: contact.id,
      name: contact.name,
      pgpPublicKey: contact.pgpPublicKey,
      fingerprint: contact.fingerprint,
      p2pIdentifier: contact.p2pIdentifier,
      i2pAddress: contact.i2pAddress,
      lastSeen: contact.lastSeen ?? null,
      status: contact.status,
    });
  }

  getContact(id: string): Contact | null {
    const stmt = this.getStatement('SELECT * FROM contacts WHERE id = @id');
    const row = stmt.get({ id }) as Record<string, unknown> | undefined;
    return row ? this.rowToContact(row) : null;
  }

  getContactByFingerprint(fingerprint: string): Contact | null {
    const stmt = this.getStatement('SELECT * FROM contacts WHERE fingerprint = @fingerprint');
    const row = stmt.get({ fingerprint }) as Record<string, unknown> | undefined;
    return row ? this.rowToContact(row) : null;
  }

  getAllContacts(): Contact[] {
    const stmt = this.getStatement('SELECT * FROM contacts ORDER BY name');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToContact(row));
  }

  deleteContact(id: string): void {
    const stmt = this.getStatement('DELETE FROM contacts WHERE id = @id');
    stmt.run({ id });
  }

  // Chat Operations

  saveChat(chat: Chat): void {
    const stmt = this.getStatement(`
      INSERT INTO chats (id, contact_id, last_message_timestamp, unread_count)
      VALUES (@id, @contactId, @lastMessageTimestamp, @unreadCount)
      ON CONFLICT(id) DO UPDATE SET
        contact_id = @contactId,
        last_message_timestamp = @lastMessageTimestamp,
        unread_count = @unreadCount
    `);

    stmt.run({
      id: chat.id,
      contactId: chat.contactId,
      lastMessageTimestamp: chat.lastMessageTimestamp ?? null,
      unreadCount: chat.unreadCount,
    });
  }

  getChat(id: string): Chat | null {
    const stmt = this.getStatement('SELECT * FROM chats WHERE id = @id');
    const row = stmt.get({ id }) as Record<string, unknown> | undefined;
    if (!row) return null;
    const chat = this.rowToChat(row);
    // Fetch and attach contact
    const contact = this.getContact(chat.contactId);
    if (contact) {
      chat.contact = contact;
    }
    return chat;
  }

  getChatByContactId(contactId: string): Chat | null {
    const stmt = this.getStatement('SELECT * FROM chats WHERE contact_id = @contactId');
    const row = stmt.get({ contactId }) as Record<string, unknown> | undefined;
    if (!row) return null;
    const chat = this.rowToChat(row);
    // Fetch and attach contact
    const contact = this.getContact(chat.contactId);
    if (contact) {
      chat.contact = contact;
    }
    return chat;
  }

  getAllChats(): Chat[] {
    const stmt = this.getStatement('SELECT * FROM chats ORDER BY last_message_timestamp DESC');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => {
      const chat = this.rowToChat(row);
      // Fetch and attach contact
      const contact = this.getContact(chat.contactId);
      if (contact) {
        chat.contact = contact;
      }
      return chat;
    });
  }

  deleteChat(id: string): void {
    const stmt = this.getStatement('DELETE FROM chats WHERE id = @id');
    stmt.run({ id });
  }

  // Message Operations

  saveMessage(message: Message): void {
    const stmt = this.getStatement(`
      INSERT INTO messages (id, chat_id, sender_id, recipient_id, encrypted_content,
        timestamp, sequence_number, status, type, reply_to, file_info)
      VALUES (@id, @chatId, @senderId, @recipientId, @encryptedContent,
        @timestamp, @sequenceNumber, @status, @type, @replyTo, @fileInfo)
      ON CONFLICT(id) DO UPDATE SET
        status = @status,
        encrypted_content = @encryptedContent
    `);

    stmt.run({
      id: message.id,
      chatId: message.chatId,
      senderId: message.senderId,
      recipientId: message.recipientId,
      encryptedContent: message.encryptedContent,
      timestamp: message.timestamp,
      sequenceNumber: message.sequenceNumber,
      status: message.status,
      type: message.type,
      replyTo: message.replyTo ?? null,
      fileInfo: message.fileInfo ? JSON.stringify(message.fileInfo) : null,
    });
  }

  getMessage(id: string): Message | null {
    const stmt = this.getStatement('SELECT * FROM messages WHERE id = @id');
    const row = stmt.get({ id }) as Record<string, unknown> | undefined;
    return row ? this.rowToMessage(row) : null;
  }

  getMessagesByChat(chatId: string, limit = 100, offset = 0): Message[] {
    const stmt = this.getStatement(`
      SELECT * FROM messages
      WHERE chat_id = @chatId
      ORDER BY timestamp DESC
      LIMIT @limit OFFSET @offset
    `);

    const rows = stmt.all({ chatId, limit, offset }) as Record<string, unknown>[];
    return rows.map((row) => this.rowToMessage(row));
  }

  getMessagesByChatId(chatId: string): Message[] {
    const stmt = this.getStatement(`
      SELECT * FROM messages
      WHERE chat_id = @chatId
      ORDER BY timestamp ASC
    `);

    const rows = stmt.all({ chatId }) as Record<string, unknown>[];
    return rows.map((row) => this.rowToMessage(row));
  }

  getLastMessageSequence(chatId: string): number {
    const stmt = this.getStatement(`
      SELECT MAX(sequence_number) as max_seq
      FROM messages
      WHERE chat_id = @chatId
    `);

    const result = stmt.get({ chatId }) as { max_seq: number | null } | undefined;
    return result?.max_seq ?? 0;
  }

  getAllMessages(): Message[] {
    const stmt = this.getStatement('SELECT * FROM messages ORDER BY timestamp ASC');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToMessage(row));
  }

  deleteMessage(id: string): void {
    const stmt = this.getStatement('DELETE FROM messages WHERE id = @id');
    stmt.run({ id });
  }

  deleteMessagesByChat(chatId: string): void {
    const stmt = this.getStatement('DELETE FROM messages WHERE chat_id = @chatId');
    stmt.run({ chatId });
  }

  // Settings Operations

  saveSettings(settings: AppSettings): void {
    const stmt = this.getStatement(`
      INSERT INTO settings (key, value)
      VALUES ('appSettings', @value)
      ON CONFLICT(key) DO UPDATE SET value = @value
    `);

    stmt.run({ value: JSON.stringify(settings) });
  }

  getSettings(): AppSettings | null {
    const stmt = this.getStatement("SELECT * FROM settings WHERE key = 'appSettings'");
    const row = stmt.get() as Record<string, unknown> | undefined;
    return row ? JSON.parse(row.value as string) as AppSettings : null;
  }

  saveSecuritySettings(settings: SecuritySettings): void {
    const stmt = this.getStatement(`
      INSERT INTO settings (key, value)
      VALUES ('securitySettings', @value)
      ON CONFLICT(key) DO UPDATE SET value = @value
    `);

    stmt.run({ value: JSON.stringify(settings) });
  }

  getSecuritySettings(): SecuritySettings | null {
    const stmt = this.getStatement("SELECT * FROM settings WHERE key = 'securitySettings'");
    const row = stmt.get() as Record<string, unknown> | undefined;
    return row ? JSON.parse(row.value as string) as SecuritySettings : null;
  }

  // Device Operations

  saveDevice(device: DeviceInfo): void {
    const stmt = this.getStatement(`
      INSERT INTO devices (device_id, device_name, i2p_address, last_sync, status)
      VALUES (@deviceId, @deviceName, @i2pAddress, @lastSync, @status)
      ON CONFLICT(device_id) DO UPDATE SET
        device_name = @deviceName,
        i2p_address = @i2pAddress,
        last_sync = @lastSync,
        status = @status
    `);

    stmt.run({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      i2pAddress: device.i2pAddress,
      lastSync: device.lastSync ?? null,
      status: device.status,
    });
  }

  getDevice(deviceId: string): DeviceInfo | null {
    const stmt = this.getStatement('SELECT * FROM devices WHERE device_id = @deviceId');
    const row = stmt.get({ deviceId }) as Record<string, unknown> | undefined;
    return row ? this.rowToDevice(row) : null;
  }

  getDeviceByI2PAddress(i2pAddress: string): DeviceInfo | null {
    const stmt = this.getStatement('SELECT * FROM devices WHERE i2p_address = @i2pAddress');
    const row = stmt.get({ i2pAddress }) as Record<string, unknown> | undefined;
    return row ? this.rowToDevice(row) : null;
  }

  getAllDevices(): DeviceInfo[] {
    const stmt = this.getStatement('SELECT * FROM devices ORDER BY device_name');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToDevice(row));
  }

  deleteDevice(deviceId: string): void {
    const stmt = this.getStatement('DELETE FROM devices WHERE device_id = @deviceId');
    stmt.run({ deviceId });
  }

  // Backup and Restore

  createBackup(): BackupData {
    const user = this.getUser();
    const contacts = this.getAllContacts();
    const chats = this.getAllChats();
    const messages = this.getAllMessages();
    const devices = this.getAllDevices();

    return {
      version: '2.0',
      timestamp: new Date().toISOString(),
      user: user!,
      contacts,
      chats,
      messages,
      devices,
    };
  }

  restoreBackup(backup: BackupData): void {
    runTransaction(() => {
      // Clear existing data
      this.db.prepare('DELETE FROM messages').run();
      this.db.prepare('DELETE FROM chats').run();
      this.db.prepare('DELETE FROM contacts').run();
      this.db.prepare('DELETE FROM devices').run();
      this.db.prepare('DELETE FROM users').run();

      // Restore data
      if (backup.user) {
        this.saveUser(backup.user);
      }

      for (const contact of backup.contacts) {
        this.saveContact(contact);
      }

      for (const chat of backup.chats) {
        this.saveChat(chat);
      }

      for (const message of backup.messages) {
        this.saveMessage(message);
      }

      for (const device of backup.devices || []) {
        this.saveDevice(device);
      }
    });
  }

  clearAllData(): void {
    runTransaction(() => {
      this.db.prepare('DELETE FROM messages').run();
      this.db.prepare('DELETE FROM chats').run();
      this.db.prepare('DELETE FROM contacts').run();
      this.db.prepare('DELETE FROM devices').run();
      this.db.prepare('DELETE FROM users').run();
      this.db.prepare('DELETE FROM settings').run();
    });
  }

  // Row mappers

  private rowToUser(row: Record<string, unknown>): User {
    return {
      id: row.id as string,
      username: row.username as string,
      deviceId: row.device_id as string,
      deviceName: row.device_name as string | undefined,
      pgpPublicKey: row.pgp_public_key as string,
      pgpPrivateKey: row.pgp_private_key as string | undefined,
      fingerprint: row.fingerprint as string,
      i2pAddress: row.i2p_address as string,
      i2pPublicKey: row.i2p_public_key as string | undefined,
      i2pPrivateKey: row.i2p_private_key as string | undefined,
      i2pSamDestination: row.i2p_sam_destination as string | undefined,
      createdAt: row.created_at as string,
    };
  }

  private rowToContact(row: Record<string, unknown>): Contact {
    return {
      id: row.id as string,
      name: row.name as string,
      pgpPublicKey: row.pgp_public_key as string,
      fingerprint: row.fingerprint as string,
      p2pIdentifier: row.p2p_identifier as string,
      i2pAddress: row.i2p_address as string,
      lastSeen: row.last_seen as string | undefined,
      status: row.status as Contact['status'],
    };
  }

  private rowToChat(row: Record<string, unknown>): Chat {
    return {
      id: row.id as string,
      contactId: row.contact_id as string,
      lastMessageTimestamp: row.last_message_timestamp as string | undefined,
      unreadCount: row.unread_count as number,
    };
  }

  private rowToMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      chatId: row.chat_id as string,
      senderId: row.sender_id as string,
      recipientId: row.recipient_id as string,
      encryptedContent: row.encrypted_content as string,
      timestamp: row.timestamp as string,
      sequenceNumber: row.sequence_number as number,
      status: row.status as Message['status'],
      type: row.type as Message['type'],
      replyTo: row.reply_to as string | undefined,
      fileInfo: row.file_info ? JSON.parse(row.file_info as string) : undefined,
    };
  }

  private rowToDevice(row: Record<string, unknown>): DeviceInfo {
    return {
      deviceId: row.device_id as string,
      deviceName: row.device_name as string,
      i2pAddress: row.i2p_address as string,
      lastSync: row.last_sync as string | undefined,
      status: row.status as DeviceInfo['status'],
    };
  }
}
