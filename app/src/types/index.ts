// Secure Chat App - Type Definitions

export interface User {
  id: string;
  username: string;
  deviceId: string;
  deviceName?: string;
  pgpPublicKey: string;
  pgpPrivateKey?: string;
  fingerprint: string;
  i2pAddress: string;  // b32.i2p address (required)
  i2pPublicKey?: string;  // Base64 encoded Ed25519 public key
  i2pPrivateKey?: string;  // Base64 encoded Ed25519 private key
  i2pSamDestination?: string;  // SAM destination for I2P (base64)
  createdAt: string;
}

export interface Contact {
  id: string;
  name: string;
  pgpPublicKey: string;
  fingerprint: string;
  p2pIdentifier: string;
  i2pAddress: string;  // Required for P2P
  lastSeen?: string;
  status: 'online' | 'offline' | 'unknown';
}

export interface Chat {
  id: string;
  contactId: string;
  contact: Contact;
  lastMessageTimestamp?: string;
  unreadCount: number;
}

export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  recipientId: string;
  encryptedContent: string;
  decryptedContent?: string;
  timestamp: string;
  sequenceNumber: number;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  type: 'text' | 'image' | 'file' | 'system';
  replyTo?: string;
  // For file messages
  fileInfo?: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    url?: string;  // blob URL for local display
  };
}

export interface ConnectionFile {
  version: '2.0';
  type: 'contact' | 'device-pairing';
  metadata: {
    timestamp: string;
    username: string;
    deviceId: string;
    deviceName?: string;
  };
  keys: {
    pgpPublicKey: string;
    fingerprint: string;
    i2pAddress: string;
    i2pPublicKey: string;
  };
  // For device pairing
  pairing?: {
    oneTimeToken: string;
    expiresAt: number;
  };
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  i2pAddress: string;
  lastSync?: string;
  status: 'online' | 'offline';
}

export interface SAMSettings {
  enabled: boolean;
  host: string;
  port: number;       // WebSocket proxy port (default 7657)
  nickname: string;
}

export interface I2PSettings {
  mode: 'auto' | 'native' | 'sam';
  sam: SAMSettings;
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
  i2p: I2PSettings;
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

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
export type EncryptionState = 'unencrypted' | 'encrypting' | 'encrypted' | 'error';
export type I2PState = 'unavailable' | 'connecting' | 'connected' | 'error';
