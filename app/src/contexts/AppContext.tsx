/* eslint-disable react-refresh/only-export-components -- context pattern: hook and provider co-exported */
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { z } from 'zod';
import type { User, Contact, Chat, Message, AppSettings, SecuritySettings, ConnectionState, EncryptionState } from '@/types';
import type { I2PStatus } from '@/services/i2p';
import { storageService } from '@/services/storage';
import { cryptoService } from '@/services/crypto';
import { i2pService } from '@/services/i2p';

// Zod Schema for incoming message validation
const incomingMessageSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string().uuid(),
  senderId: z.string().uuid(),
  encryptedContent: z.string().min(1),
  timestamp: z.string().datetime(),
  sequenceNumber: z.number().int().nonnegative(),
  replyTo: z.string().uuid().optional(),
});

interface AppContextType {
  // User
  user: User | null;
  setUser: (user: User | null) => void;
  
  // Contacts
  contacts: Contact[];
  addContact: (contact: Contact) => Promise<void>;
  removeContact: (id: string) => Promise<void>;
  updateContact: (contact: Contact) => Promise<void>;
  
  // Chats
  chats: Chat[];
  activeChat: Chat | null;
  setActiveChat: (chat: Chat | null) => void;
  createChat: (contact: Contact) => Promise<Chat>;
  deleteChat: (id: string) => Promise<void>;
  
  // Messages
  messages: Message[];
  sendMessage: (content: string) => Promise<void>;
  sendFile: (to: string, file: File) => Promise<void>;
  loadMessages: (chatId: string) => Promise<void>;
  
  // Settings
  settings: AppSettings;
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>;
  securitySettings: SecuritySettings;
  updateSecuritySettings: (settings: Partial<SecuritySettings>) => Promise<void>;
  
  // Connection
  connectionState: ConnectionState;
  encryptionState: EncryptionState;
  
  // I2P Status
  i2pStatus: I2PStatus | null;
  
  // Auth
  isAuthenticated: boolean;
  isLocked: boolean;
  lockApp: () => void;
  unlockApp: (passphrase: string) => Promise<boolean>;
  
  // Loading
  isLoading: boolean;
  
  // Initialization
  initialize: () => Promise<void>;
}

const defaultSettings: AppSettings = {
  theme: 'dark',
  language: 'de',
  notifications: true,
  soundEnabled: true,
  autoLock: true,
  lockTimeout: 5,
  screenshotProtection: true,
  syncEnabled: true,
  deviceName: 'My Device',
  i2p: {
    mode: 'auto',
    sam: {
      enabled: false,
      host: '127.0.0.1',
      port: 7657,
      nickname: 'securechat',
    },
  },
};

const defaultSecuritySettings: SecuritySettings = {
  biometricEnabled: false,
  pinEnabled: false,
  autoLockEnabled: true,
  autoLockTimeout: 5,
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  // Refs for tracking listener registration state
  const listenersRegisteredRef = useRef(false);

  // User state
  const [user, setUser] = useState<User | null>(null);
  
  // Contacts state
  const [contacts, setContacts] = useState<Contact[]>([]);
  
  // Chats state
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  
  // Messages state
  const [messages, setMessages] = useState<Message[]>([]);
  
  // Settings state
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [securitySettings, setSecuritySettings] = useState<SecuritySettings>(defaultSecuritySettings);
  
  // Connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [encryptionState, setEncryptionState] = useState<EncryptionState>('unencrypted');
  
  // I2P status
  const [i2pStatus, setI2pStatus] = useState<I2PStatus | null>(null);
  
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  
  // Loading state
  const [isLoading, setIsLoading] = useState(true);

  // Initialize app
  const initialize = useCallback(async () => {
    try {
      setIsLoading(true);
      
      // Initialize storage
      await storageService.init();
      
      // Load user
      const savedUser = await storageService.getUser();
      if (savedUser) {
        setUser(savedUser);
        
        // Load key pair if exists
        if (savedUser.pgpPrivateKey) {
          try {
            await cryptoService.importKeyPair(
              savedUser.pgpPrivateKey,
              savedUser.pgpPublicKey,
              '' // Will need passphrase
            );
            setEncryptionState('encrypted');
          } catch (error) {
            console.error('Error loading key pair:', error);
          }
        }
      }
      
      // Load contacts
      const savedContacts = await storageService.getAllContacts();
      setContacts(savedContacts);
      
      // Load chats
      const savedChats = await storageService.getAllChats();
      // Enrich chats with contact data
      const enrichedChats = savedChats.map(chat => ({
        ...chat,
        contact: savedContacts.find(c => c.id === chat.contactId) || chat.contact,
      }));
      setChats(enrichedChats);
      
      // Load settings
      const savedSettings = await storageService.getSettings();
      if (savedSettings) {
        setSettings(savedSettings);
      }
      
      const savedSecuritySettings = await storageService.getSecuritySettings();
      if (savedSecuritySettings) {
        setSecuritySettings(savedSecuritySettings);
      }
      
      // Initialize I2P
      if (savedUser?.i2pAddress && savedUser.i2pPublicKey && savedUser.i2pPrivateKey) {
        await i2pService.restoreIdentity(
          savedUser.i2pPublicKey, 
          savedUser.i2pPrivateKey, 
          savedUser.i2pSamDestination
        );
        
        // Deregister old listeners if already registered (prevents memory leak)
        if (listenersRegisteredRef.current) {
          i2pService.offMessage(handleIncomingMessage);
          i2pService.offStatusChange(setI2pStatus);
        }
        
        // Register new listeners
        i2pService.onMessage(handleIncomingMessage);
        i2pService.onStatusChange(setI2pStatus);
        listenersRegisteredRef.current = true;
        
        // Initialize with settings
        const i2pSettings = savedSettings?.i2p || defaultSettings.i2p;
        const status = await i2pService.initialize(i2pSettings.sam);
        setI2pStatus(status);
        
        // Save SAM destination if newly generated
        if (status.newDestinationGenerated && savedUser) {
          const identity = i2pService.getIdentity();
          if (identity?.samDestination) {
            const updatedUser = { ...savedUser, i2pSamDestination: identity.samDestination };
            await storageService.saveUser(updatedUser);
            setUser(updatedUser);
          }
        }
      }
      
    } catch (error) {
      console.error('Error initializing app:', error);
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleIncomingMessage intentionally excluded to avoid re-registration on every change
  }, []);

  // Handle incoming messages from I2P
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- incoming I2P messages have dynamic structure
  const handleIncomingMessage = useCallback(async (_from: string, data: any) => {
    try {
      // Only handle chat messages
      if (data?.type !== 'chat-message') return;

      // Validate incoming message with Zod schema
      const validationResult = incomingMessageSchema.safeParse(data);
      if (!validationResult.success) {
        console.warn('[AppContext] Invalid incoming message format:', validationResult.error.issues);
        return;
      }

      const validatedData = validationResult.data;

      const message: Message = {
        id: validatedData.id,
        chatId: validatedData.chatId,
        senderId: validatedData.senderId,
        recipientId: user?.id || '',
        encryptedContent: validatedData.encryptedContent,
        timestamp: validatedData.timestamp,
        sequenceNumber: validatedData.sequenceNumber,
        status: 'delivered',
        type: 'text',
        replyTo: validatedData.replyTo,
      };

      // Try to decrypt if we have our key pair loaded
      if (message.encryptedContent && cryptoService.hasKeyPair()) {
        try {
          const decrypted = await cryptoService.decryptMessage(message.encryptedContent);
          message.decryptedContent = decrypted;
        } catch {
          message.decryptedContent = '[Entschlüsselung fehlgeschlagen]';
        }
      } else {
        message.decryptedContent = message.encryptedContent;
      }

      // Save message to storage
      await storageService.saveMessage(message);

      // Update or create chat
      const chat = await storageService.getChat(message.chatId);
      if (chat) {
        chat.lastMessageTimestamp = message.timestamp;
        chat.unreadCount = (chat.unreadCount || 0) + 1;
        await storageService.saveChat(chat);
        setChats(prev => prev.map(c =>
          c.id === chat!.id ? { ...c, lastMessageTimestamp: message.timestamp, unreadCount: chat!.unreadCount } : c
        ));
      }

      // If message is for active chat, add to messages list
      if (activeChat?.id === message.chatId) {
        setMessages(prev => [...prev, message]);
      }
    } catch (error) {
      console.error('Error handling incoming message:', error);
    }
  }, [activeChat, user]);

  // Handle sync messages (multi-device) - TODO: Implement for I2P
  // This would require a sync protocol over I2P SAM streams
  // For now, sync is disabled in pure I2P mode

  // Sync connectionState with I2P status
  useEffect(() => {
    if (i2pStatus?.samConnected) {
      setConnectionState('connected');
    } else if (i2pStatus?.error) {
      setConnectionState('error');
    } else {
      setConnectionState('disconnected');
    }
  }, [i2pStatus]);

  // Contact operations
  const addContact = useCallback(async (contact: Contact) => {
    await storageService.saveContact(contact);
    setContacts(prev => [...prev, contact]);
  }, []);

  const removeContact = useCallback(async (id: string) => {
    await storageService.deleteContact(id);
    setContacts(prev => prev.filter(c => c.id !== id));

    // Also delete associated chat
    const chat = await storageService.getChatByContactId(id);
    if (chat) {
      await deleteChat(chat.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deleteChat excluded to avoid circular dependency
  }, []);

  const updateContact = useCallback(async (contact: Contact) => {
    await storageService.saveContact(contact);
    setContacts(prev => prev.map(c => c.id === contact.id ? contact : c));
  }, []);

  // Chat operations
  const createChat = useCallback(async (contact: Contact): Promise<Chat> => {
    // Check if chat already exists
    const existingChat = await storageService.getChatByContactId(contact.id);
    if (existingChat) {
      return { ...existingChat, contact };
    }
    
    const newChat: Chat = {
      id: crypto.randomUUID(),
      contactId: contact.id,
      contact,
      unreadCount: 0,
    };
    
    await storageService.saveChat(newChat);
    setChats(prev => [...prev, newChat]);
    return newChat;
  }, []);

  const deleteChat = useCallback(async (id: string) => {
    await storageService.deleteChat(id);
    await storageService.deleteMessagesByChat(id);
    setChats(prev => prev.filter(c => c.id !== id));
    
    if (activeChat?.id === id) {
      setActiveChat(null);
      setMessages([]);
    }
  }, [activeChat]);

  // Message operations
  const sendMessage = useCallback(async (content: string) => {
    if (!activeChat || !user) return;

    const contact = activeChat.contact;
    if (!contact) return;

    try {
      // Encrypt message if we have the contact's PGP key
      let encryptedContent = '';
      if (contact.pgpPublicKey) {
        encryptedContent = await cryptoService.encryptMessage(content, contact.pgpPublicKey);
      }

      // Create message
      const sequenceNumber = await storageService.getLastMessageSequence(activeChat.id);
      const message: Message = {
        id: crypto.randomUUID(),
        chatId: activeChat.id,
        senderId: user.id,
        recipientId: contact.id,
        encryptedContent: encryptedContent || content,
        decryptedContent: content,
        timestamp: new Date().toISOString(),
        sequenceNumber: sequenceNumber + 1,
        status: 'sending',
        type: 'text',
      };

      // Save to storage and update UI immediately
      await storageService.saveMessage(message);
      setMessages(prev => [...prev, message]);

      // Try to send via I2P (i2pService.sendMessage handles JSON.stringify internally)
      let sent = false;
      if (i2pStatus?.samConnected) {
        sent = await i2pService.sendMessage(contact.i2pAddress, {
          type: 'chat-message',
          id: message.id,
          chatId: message.chatId,
          senderId: message.senderId,
          encryptedContent: message.encryptedContent,
          timestamp: message.timestamp,
          sequenceNumber: message.sequenceNumber,
        });
      }

      // Update message status
      const updatedMessage = { ...message, status: (sent ? 'sent' : 'failed') as Message['status'] };
      await storageService.saveMessage(updatedMessage);
      setMessages(prev => prev.map(m => m.id === message.id ? updatedMessage : m));

      // Update chat last message timestamp
      const updatedChat = { ...activeChat, lastMessageTimestamp: message.timestamp };
      await storageService.saveChat(updatedChat);
      setChats(prev => prev.map(c =>
        c.id === activeChat.id ? { ...c, lastMessageTimestamp: message.timestamp } : c
      ));

    } catch (error) {
      console.error('Error sending message:', error);
    }
  }, [activeChat, user, i2pStatus]);

  const loadMessages = useCallback(async (chatId: string) => {
    const chatMessages = await storageService.getMessagesByChatId(chatId);
    setMessages(chatMessages);
  }, []);

  // File operations
  const sendFile = useCallback(async (to: string, file: File) => {
    if (!user) return;
    
    try {
      // Send file via I2P
      await i2pService.sendFile(to, file);
    } catch (error) {
      console.error('Error sending file:', error);
    }
  }, [user]);

  // Settings operations
  const updateSettings = useCallback(async (newSettings: Partial<AppSettings>) => {
    const updated = { ...settings, ...newSettings };
    setSettings(updated);
    await storageService.saveSettings(updated);
  }, [settings]);

  const updateSecuritySettings = useCallback(async (newSettings: Partial<SecuritySettings>) => {
    const updated = { ...securitySettings, ...newSettings };
    setSecuritySettings(updated);
    await storageService.saveSecuritySettings(updated);
  }, [securitySettings]);

  // Auth operations
  const lockApp = useCallback(() => {
    setIsLocked(true);
    cryptoService.clearKeyPair();
    storageService.clearEncryptionPassphrase();
    setEncryptionState('unencrypted');
  }, []);

  const unlockApp = useCallback(async (passphrase: string): Promise<boolean> => {
    if (!user?.pgpPrivateKey) return false;
    
    try {
      // Set encryption passphrase for storage
      storageService.setEncryptionPassphrase(passphrase);
      
      await cryptoService.importKeyPair(user.pgpPrivateKey, user.pgpPublicKey, passphrase);
      setIsLocked(false);
      setIsAuthenticated(true);
      setEncryptionState('encrypted');
      return true;
    } catch (error) {
      console.error('Error unlocking app:', error);
      return false;
    }
  }, [user]);

  // Load active chat messages when changed
  useEffect(() => {
    if (activeChat) {
      loadMessages(activeChat.id);
    } else {
      setMessages([]);
    }
  }, [activeChat, loadMessages]);

  const value: AppContextType = {
    user,
    setUser,
    contacts,
    addContact,
    removeContact,
    updateContact,
    chats,
    activeChat,
    setActiveChat,
    createChat,
    deleteChat,
    messages,
    sendMessage,
    sendFile,
    loadMessages,
    settings,
    updateSettings,
    securitySettings,
    updateSecuritySettings,
    connectionState,
    encryptionState,
    i2pStatus,
    isAuthenticated,
    isLocked,
    lockApp,
    unlockApp,
    isLoading,
    initialize,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
