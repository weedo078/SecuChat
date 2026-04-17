/* eslint-disable react-refresh/only-export-components -- context pattern: hook and provider co-exported */
import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { z } from 'zod';
import type { User, Contact, Chat, Message, AppSettings, SecuritySettings, ConnectionState, EncryptionState } from '@/types';
import type { I2PStatus } from '@/services/i2p';
import { storageService } from '@/services/storage';
import { cryptoService } from '@/services/crypto';
import { i2pService, samService } from '@/services/i2p';
import { platformService } from '@/services/platform';

// Zod Schema for incoming message validation
const incomingMessageSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string().uuid(),
  senderId: z.string().uuid(),
  senderFingerprint: z.string().optional(), // used to find local contact/chat
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

  // Theme
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;

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
  notificationSettings: {
    enabled: true,
    sound: true,
    vibration: true,
    showPreview: true,
    priority: 'high',
  },
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

// In Electron, the bundled SAM proxy always runs on port 7657 — force enabled.
const isElectron = typeof window !== 'undefined' &&
  !!(window as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron;

function effectiveSamConfig(sam: AppSettings['i2p']['sam']): AppSettings['i2p']['sam'] {
  const config = { ...sam };

  // Electron: bundled SAM proxy always runs on port 7657 — force enabled.
  if (isElectron) {
    config.enabled = true;
  }

  // Android native: use direct TCP to i2pd SAM on port 7656, not WebSocket proxy on 7657.
  if (platformService.isAndroidNative()) {
    config.port = 7656;
  }

  return config;
}

export function AppProvider({ children }: { children: ReactNode }) {
  // Refs for tracking listener registration state
  const listenersRegisteredRef = useRef(false);

  // Stable message handler ref — always points to the latest handleIncomingMessage.
  // This avoids stale closure issues when activeChat/user change after initial registration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleIncomingMessageRef = useRef<(from: string, data: any) => void>(() => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stableMessageHandler = useCallback((from: string, data: any) => {
    handleIncomingMessageRef.current(from, data);
  }, []);

  // User state
  const [user, setUser] = useState<User | null>(null);
  
  // Contacts state
  const [contacts, setContacts] = useState<Contact[]>([]);
  
  // Chats state
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChatState] = useState<Chat | null>(null);
  
  // Messages state
  const [messages, setMessages] = useState<Message[]>([]);
  
  // Settings state
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [securitySettings, setSecuritySettings] = useState<SecuritySettings>(defaultSecuritySettings);

  // Theme state
  const [theme, setThemeState] = useState<'dark' | 'light'>(settings.theme);

  // Connection state
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [encryptionState, setEncryptionState] = useState<EncryptionState>('unencrypted');
  
  // I2P status
  const [i2pStatus, setI2pStatus] = useState<I2PStatus | null>(null);
  
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  
  // Inactivity tracking for auto-lock
  const [lastActivity, setLastActivity] = useState(Date.now());
  
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
      let needsUnlock = false;
      if (savedUser) {
        setUser(savedUser);

        // Check if private keys are still encrypted (base64 blob vs PGP armored text)
        // When encryptionPassphrase is not set, getUser() returns encrypted data as-is
        const keysEncrypted = savedUser.pgpPrivateKey &&
          !savedUser.pgpPrivateKey.startsWith('-----BEGIN PGP');

        if (keysEncrypted) {
          // Keys are encrypted in storage — need passphrase to unlock
          needsUnlock = true;
          setIsLocked(true);
        } else if (savedUser.pgpPrivateKey) {
          // Keys are plaintext (freshly created with passphrase still in memory)
          try {
            await cryptoService.importKeyPair(
              savedUser.pgpPrivateKey,
              savedUser.pgpPublicKey,
              '' // PGP key passphrase not needed when key is already decrypted by OpenPGP.js
            );
            setEncryptionState('encrypted');
            setIsAuthenticated(true);
          } catch (error) {
            console.error('Error loading key pair:', error);
          }
        } else {
          // No PGP private key found - this shouldn't happen for existing users
          // Set encryption state to allow UI to function, but log warning
          console.warn('[AppContext] User exists but pgpPrivateKey is missing - setting encryptionState to allow UI');
          setEncryptionState('encrypted');
          setIsAuthenticated(true);
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
        if (savedSettings.theme) {
          setThemeState(savedSettings.theme);
        }
      }
      
      const savedSecuritySettings = await storageService.getSecuritySettings();
      if (savedSecuritySettings) {
        setSecuritySettings(savedSecuritySettings);
      }
      
      // Register I2P listeners and start initialization in the background.
      // We do NOT await i2p init here — the app loads immediately and I2P
      // connects whenever it's ready (status updates via onStatusChange).
      // Skip I2P init if keys are still encrypted (wait for unlock).
      if (!needsUnlock && savedUser?.i2pAddress && savedUser.i2pPublicKey && savedUser.i2pPrivateKey) {
        await i2pService.restoreIdentity(
          savedUser.i2pPublicKey,
          savedUser.i2pPrivateKey,
          savedUser.i2pSamDestination,
          savedUser.i2pAddress  // Pass the stored I2P address (SAM b32)
        );

        // Deregister old listeners if already registered (prevents memory leak)
        if (listenersRegisteredRef.current) {
          i2pService.offMessage(stableMessageHandler);
          i2pService.offStatusChange(setI2pStatus);
        }

        // Register new listeners
        i2pService.onMessage(stableMessageHandler);
        i2pService.onStatusChange(setI2pStatus);
        listenersRegisteredRef.current = true;

        // Await I2P init to ensure SAM destination is persisted before continuing
        const i2pSettings = savedSettings?.i2p || defaultSettings.i2p;
        try {
          const status = await i2pService.initialize(effectiveSamConfig(i2pSettings.sam));
          setI2pStatus(status);
          if (savedUser && status.samConnected) {
            const identity = i2pService.getIdentity();

            // CRITICAL FIX: If identity lacks samDestination but SAM has a session, sync it
            if (identity && !identity.samDestination) {
              const samSession = samService.exportSession();
              if (samSession?.privateKey) {
                console.log('[AppContext] Syncing missing samDestination from SAM session (init)');
                i2pService.setSamDestination(samSession.privateKey);
              }
            }

            let updatedUser = { ...savedUser };
            // CRITICAL: Always persist the SAM destination when:
            // 1. A new destination was just generated, OR
            // 2. We have one in identity but user record doesn't have it stored yet
            // This ensures the destination survives app restarts and we never use TRANSIENT
            const needsSamDestinationUpdate = identity?.samDestination &&
              (!savedUser.i2pSamDestination || status.newDestinationGenerated || savedUser.i2pSamDestination !== identity.samDestination);
            if (needsSamDestinationUpdate) {
              updatedUser = { ...updatedUser, i2pSamDestination: identity.samDestination };
            }
            // Sync the real SAM b32 address into the user record.
            // Addresses stored during onboarding may be the Ed25519 b32 (wrong)
            // if SAM wasn't connected at that time. Correct it now so exported
            // contact files carry the reachable I2P address.
            if (status.address && status.address !== savedUser.i2pAddress) {
              console.log('[AppContext] Updating stored i2p address to SAM b32:', status.address.slice(0, 20) + '...');
              updatedUser = { ...updatedUser, i2pAddress: status.address };
            }
            // Defensive check: if user doesn't have i2pSamDestination but I2P identity now has one, force save
            if (!updatedUser.i2pSamDestination && identity?.samDestination) {
              console.log('[AppContext] Force-saving SAM destination that was missing from storage');
              updatedUser = { ...updatedUser, i2pSamDestination: identity.samDestination };
            }
            if (updatedUser !== savedUser) {
              try {
                await storageService.saveUser(updatedUser);
                setUser(updatedUser);
              } catch (err) {
                console.warn('[AppContext] Failed to save user updates:', err);
              }
            }
          }
        } catch (err) {
          console.error('[AppContext] I2P init failed:', err);
          setI2pStatus({ samConnected: false, samAvailable: false, address: null, error: String(err) });
        }
      }
      
    } catch (error) {
      console.error('[AppContext] Error initializing app:', error);
      if (error instanceof Error) {
        console.error('[AppContext] Error details:', error.name, error.message, error.stack);
      }
      // Even on error, allow the app to proceed to onboarding
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

      // ── Find local contact & chat (Bug 3: sender's chatId/senderId are their local UUIDs)
      // Match by senderFingerprint → contact → local chat
      let localContact: Contact | null = null;
      let localChat: Chat | null = null;

      if (validatedData.senderFingerprint) {
        localContact = await storageService.getContactByFingerprint(validatedData.senderFingerprint);
      }

      if (localContact) {
        localChat = await storageService.getChatByContactId(localContact.id);

        // Bug 6: Auto-create chat if contact exists but no chat yet
        if (!localChat) {
          localChat = {
            id: crypto.randomUUID(),
            contactId: localContact.id,
            contact: localContact,
            unreadCount: 0,
          };
          await storageService.saveChat(localChat);
          setChats(prev => [...prev, localChat!]);
        }
      }

      // Use local chatId (or fall back to sender's chatId if we couldn't resolve)
      const localChatId = localChat?.id ?? validatedData.chatId;

      const message: Message = {
        id: validatedData.id,
        chatId: localChatId,
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
        // Bug 5: show placeholder, not raw PGP ciphertext
        message.decryptedContent = '[Verschlüsselt]';
      }

      // Save message to storage
      await storageService.saveMessage(message);

      // Only increment unread count if chat is not currently active
      const isChatActive = activeChat?.id === localChatId;

      // Update chat unread count & timestamp
      if (localChat) {
        const chatId = localChat.id;
        const updatedChat = {
          ...localChat,
          lastMessageTimestamp: message.timestamp,
          unreadCount: isChatActive ? 0 : (localChat.unreadCount || 0) + 1,
        };
        await storageService.saveChat(updatedChat);
        setChats(prev => prev.map(c => c.id === chatId ? updatedChat : c));
      }

      // Update contact status to online when receiving a message
      if (localContact) {
        const contactId = localContact.id;
        const updatedContact = {
          ...localContact,
          status: 'online' as const,
          lastSeen: new Date().toISOString(),
        };
        await storageService.saveContact(updatedContact);
        setContacts(prev => prev.map(c => c.id === contactId ? updatedContact : c));
        setChats(prev => prev.map(ch =>
          ch.contactId === contactId ? { ...ch, contact: updatedContact } : ch
        ));
      }

      // Add to active chat messages if it's open
      if (isChatActive) {
        setMessages(prev => [...prev, message]);
      }
    } catch (error) {
      console.error('Error handling incoming message:', error);
    }
  }, [activeChat, user]);

  // Keep the ref in sync so the stable handler always calls the latest version
  handleIncomingMessageRef.current = handleIncomingMessage;

  // Handle sync messages (multi-device) - TODO: Implement for I2P
  // This would require a sync protocol over I2P SAM streams
  // For now, sync is disabled in pure I2P mode

  // Auto-retry I2P connection every 30 s when not connected
  useEffect(() => {
    const samCfg = effectiveSamConfig(settings.i2p.sam);
    if (!user || i2pStatus?.samConnected || !samCfg.enabled) return;
    const timer = setTimeout(async () => {
      try {
        const status = await i2pService.initialize(samCfg);
        setI2pStatus(status);
        if (status.samConnected && user) {
          const identity = i2pService.getIdentity();
          if (identity?.samDestination && !user.i2pSamDestination) {
            const updatedUser = { ...user, i2pSamDestination: identity.samDestination };
            await storageService.saveUser(updatedUser);
            setUser(updatedUser);
          }
        }
      } catch (err) {
        setI2pStatus({ samConnected: false, samAvailable: false, address: null, error: String(err) });
      }
    }, 30000);
    return () => clearTimeout(timer);
  }, [user, i2pStatus, settings.i2p.sam]);

  // When I2P connects, try to reach all known contacts and update their status
  useEffect(() => {
    if (!i2pStatus?.samConnected || contacts.length === 0) return;
    contacts.forEach(async (contact) => {
      if (!contact.i2pAddress) return;
      try {
        await i2pService.connectToPeer(contact.i2pAddress);
        const updated = { ...contact, status: 'online' as const };
        await storageService.saveContact(updated);
        setContacts(prev => prev.map(c => c.id === contact.id ? updated : c));
        setChats(prev => prev.map(ch =>
          ch.contactId === contact.id ? { ...ch, contact: updated } : ch
        ));
      } catch {
        // Don't immediately mark offline on first check — I2P tunnel build can take minutes.
        // The periodic status check will handle offline detection after consecutive failures.
        console.log(`[I2P Connect] ${contact.name} not yet reachable, keeping current status`);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run only when SAM connects
  }, [i2pStatus?.samConnected]);

  // Retry failed/sending messages when contact comes back online
  useEffect(() => {
    if (!i2pStatus?.samConnected || contacts.length === 0) return;

    const onlineContacts = contacts.filter(c => c.status === 'online' && c.i2pAddress);
    if (onlineContacts.length === 0) return;

    // Find messages with status 'sending' or 'failed' for online contacts
    const retryMessages = async () => {
      for (const contact of onlineContacts) {
        const chat = await storageService.getChatByContactId(contact.id);
        if (!chat) continue;

        const allMessages = await storageService.getMessagesByChatId(chat.id);
        const pendingMessages = allMessages.filter(m =>
          (m.status === 'sending' || m.status === 'failed') &&
          m.senderId === user?.id
        );

        if (pendingMessages.length > 0) {
          console.log(`[Message Retry] ${pendingMessages.length} pending messages for ${contact.name}, retrying...`);
          for (const message of pendingMessages) {
            try {
              // Re-send the message
              const contactData = await storageService.getContact(contact.id);
              if (!contactData?.pgpPublicKey) continue;

              // Decrypt the content first if needed
              let content = message.encryptedContent;
              if (message.decryptedContent && cryptoService.hasKeyPair()) {
                content = await cryptoService.encryptMessage(message.decryptedContent, contactData.pgpPublicKey);
              }

              const success = await i2pService.sendMessage(contact.i2pAddress, {
                type: 'chat-message',
                id: message.id,
                chatId: chat.id,
                senderId: user?.id,
                senderFingerprint: user?.fingerprint,
                encryptedContent: content,
                timestamp: message.timestamp,
                sequenceNumber: message.sequenceNumber,
                replyTo: message.replyTo,
              });

              if (success) {
                const updatedMessage = { ...message, status: 'sent' as const };
                await storageService.saveMessage(updatedMessage);
                setMessages(prev => prev.map(m => m.id === message.id ? updatedMessage : m));
                console.log(`[Message Retry] Message ${message.id.slice(0, 8)} sent successfully`);
              }
            } catch (err) {
              console.error(`[Message Retry] Failed to resend message ${message.id.slice(0, 8)}:`, err);
            }
          }
        }
      }
    };

    retryMessages();
  }, [i2pStatus?.samConnected, contacts, user?.id, user?.fingerprint]);

  // Periodic status check: retry all contacts regardless of current status
  // In I2P, peers may be temporarily unreachable (LeaseSet propagation, network issues)
  // We continuously retry to detect when they come back online
  useEffect(() => {
    if (!i2pStatus?.samConnected) return;

    // Track consecutive failures per contact — only mark offline after 3 failures
    const consecutiveFailures = new Map<string, number>();
    const FAILURE_THRESHOLD = 3;

    const interval = setInterval(() => {
      // Live-check: if SAM session died, update status so auto-reconnect triggers
      if (!i2pService.isReady()) {
        const status = i2pService.getStatus();
        if (!status.samConnected && i2pStatus?.samConnected) {
          console.log('[Status Check] SAM session lost, updating status');
          setI2pStatus(status);
        }
        return; // Skip peer pings until SAM reconnects
      }

      // Read contacts from current state via functional updater pattern
      setContacts(prevContacts => {
        // Process contacts that have an I2P address
        const contactsToCheck = prevContacts.filter(c => c.i2pAddress);
        if (contactsToCheck.length === 0) return prevContacts;

        // Fire off async checks (don't await — return current state immediately)
        contactsToCheck.forEach(async (contact) => {
          try {
            console.log(`[Status Check] Pinging ${contact.name} (${contact.i2pAddress.slice(0, 20)}...)`);
            await i2pService.connectToPeer(contact.i2pAddress);
            console.log(`[Status Check] ${contact.name} is online`);
            // Reset failure counter on success
            consecutiveFailures.delete(contact.id);
            // Update lastSeen and ensure status is online
            const updated = { ...contact, lastSeen: new Date().toISOString(), status: 'online' as const };
            await storageService.saveContact(updated);
            setContacts(prev => {
              // Only update if still offline/unknown (avoid unnecessary re-renders)
              const existing = prev.find(c => c.id === contact.id);
              if (existing?.status === 'online') return prev;
              return prev.map(c => c.id === contact.id ? updated : c);
            });
            setChats(prev => prev.map(ch =>
              ch.contactId === contact.id && ch.contact?.status !== 'online'
                ? { ...ch, contact: updated }
                : ch
            ));
          } catch (err) {
            // Skip counting if SAM session is dead — the auto-reconnect will handle it
            const errMsg = err instanceof Error ? err.message : String(err);
            if (errMsg.includes('No session created') || errMsg.includes('INVALID_ID')) {
              console.log(`[Status Check] SAM session lost, skipping ping for ${contact.name}`);
              return;
            }
            // Cap at threshold + 1 to avoid unbounded counter growth
            const rawFailures = (consecutiveFailures.get(contact.id) || 0) + 1;
            const failures = Math.min(rawFailures, FAILURE_THRESHOLD + 1);
            consecutiveFailures.set(contact.id, failures);
            console.log(`[Status Check] ${contact.name} unreachable (${failures}/${FAILURE_THRESHOLD})`);
            // Only mark offline after consecutive failures reach threshold
            if (failures === FAILURE_THRESHOLD) {
              const updated = { ...contact, status: 'offline' as const };
              await storageService.saveContact(updated);
              setContacts(prev => prev.map(c => c.id === contact.id ? updated : c));
              setChats(prev => prev.map(ch =>
                ch.contactId === contact.id ? { ...ch, contact: updated } : ch
              ));
            }
          }
        });

        // Return unchanged — actual updates happen in the async callbacks
        return prevContacts;
      });
    }, 30000); // Check every 30 seconds
    console.log('[Status Check] Started periodic status check (30s interval, offline after 3 consecutive failures)');

    return () => clearInterval(interval);
  }, [i2pStatus?.samConnected]);

  // Sync connectionState with I2P status, isLocked and encryptionState
  useEffect(() => {
    if (isLocked) {
      setConnectionState('locked');
    } else if (encryptionState === 'error') {
      setConnectionState('error');
    } else if (i2pStatus?.samConnected) {
      setConnectionState('connected');
    } else if (i2pStatus?.error) {
      setConnectionState('error');
    } else {
      setConnectionState('disconnected');
    }
  }, [i2pStatus, isLocked, encryptionState]);

  // Track user activity for auto-lock
  useEffect(() => {
    const updateActivity = () => setLastActivity(Date.now());
    
    window.addEventListener('mousemove', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('touchstart', updateActivity);
    window.addEventListener('click', updateActivity);
    
    return () => {
      window.removeEventListener('mousemove', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
      window.removeEventListener('click', updateActivity);
    };
  }, []);

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
      setActiveChatState(null);
      setMessages([]);
    }
  }, [activeChat]);

  // Wrapper for setActiveChat that resets unread count
  const setActiveChat = useCallback(async (chat: Chat | null) => {
    // Reset unread count if opening a chat with unread messages
    if (chat && chat.unreadCount > 0) {
      const updatedChat = { ...chat, unreadCount: 0 };
      await storageService.saveChat(updatedChat);
      setChats(prev => prev.map(c => c.id === chat.id ? updatedChat : c));
      setActiveChatState(updatedChat);
    } else {
      setActiveChatState(chat);
    }
  }, []);

  // Message operations
  const sendMessage = useCallback(async (content: string) => {
    if (!activeChat || !user) return;

    const contact = activeChat.contact;
    if (!contact) return;

    // Track whether the message was persisted so the catch block can mark it 'failed'
    let savedMessage: Message | null = null;
    let statusAlreadyUpdated = false;

    try {
      // Require PGP key — no plaintext fallback (Bug 2 fix)
      if (!contact.pgpPublicKey) {
        throw new Error('Kontakt hat keinen PGP-Schlüssel. Bitte Kontaktdatei erneut importieren.');
      }
      const encryptedContent = await cryptoService.encryptMessage(content, contact.pgpPublicKey);

      // Create message
      const sequenceNumber = await storageService.getLastMessageSequence(activeChat.id);
      const message: Message = {
        id: crypto.randomUUID(),
        chatId: activeChat.id,
        senderId: user.id,
        recipientId: contact.id,
        encryptedContent,
        decryptedContent: content,
        timestamp: new Date().toISOString(),
        sequenceNumber: sequenceNumber + 1,
        status: 'sending',
        type: 'text',
      };

      // Save to storage and update UI immediately
      await storageService.saveMessage(message);
      savedMessage = message;
      setMessages(prev => [...prev, message]);

      // Try to send via I2P with retry — peer may need time for LeaseSet propagation
      let sent = false;
      if (i2pStatus?.samConnected) {
        const i2pMessage = {
          type: 'chat-message',
          id: message.id,
          chatId: message.chatId,
          senderId: message.senderId,
          // senderFingerprint lets recipient map this message to their local contact/chat (Bug 3 fix)
          senderFingerprint: user.fingerprint,
          encryptedContent: message.encryptedContent,
          timestamp: message.timestamp,
          sequenceNumber: message.sequenceNumber,
        };

        sent = await i2pService.sendMessage(contact.i2pAddress, i2pMessage);

        // If first attempt failed, retry once after a short delay (tunnel build can be slow)
        if (!sent) {
          console.log('[sendMessage] First attempt failed, retrying in 5s...');
          await new Promise(r => setTimeout(r, 5000));
          sent = await i2pService.sendMessage(contact.i2pAddress, i2pMessage);
        }
      }

      // Update message status
      const newStatus: Message['status'] = sent ? 'sent' : 'failed';
      const updatedMessage = { ...message, status: newStatus };
      await storageService.saveMessage(updatedMessage);
      setMessages(prev => prev.map(m => m.id === message.id ? updatedMessage : m));
      statusAlreadyUpdated = true;

      // Update chat last message timestamp
      const updatedChat = { ...activeChat, lastMessageTimestamp: message.timestamp };
      await storageService.saveChat(updatedChat);
      setChats(prev => prev.map(c =>
        c.id === activeChat.id ? { ...c, lastMessageTimestamp: message.timestamp } : c
      ));

      // Surface failure to the caller so the UI can show an error toast
      if (!sent) {
        const reason = !i2pStatus?.samConnected
          ? 'I2P nicht verbunden. Starten Sie i2pd und sam-proxy.'
          : 'Peer nicht erreichbar. Kontakt ist möglicherweise offline oder I2P baut die Verbindung noch auf.';
        throw new Error(reason);
      }

    } catch (error) {
      console.error('Error sending message:', error);
      // If the message was saved but status update didn't complete, mark it failed
      if (savedMessage && !statusAlreadyUpdated) {
        const failedMessage = { ...savedMessage, status: 'failed' as Message['status'] };
        storageService.saveMessage(failedMessage).catch((e) => console.error('[sendMessage] Failed to persist failed status:', e));
        setMessages(prev => prev.map(m => m.id === savedMessage!.id ? failedMessage : m));
      }
      // Rethrow so ChatView.handleSend can show the error toast
      throw error;
    }
  }, [activeChat, user, i2pStatus]);

  const loadMessages = useCallback(async (chatId: string) => {
    const chatMessages = await storageService.getMessagesByChatId(chatId);
    
    // Try to decrypt messages if we have the key pair loaded
    if (cryptoService.hasKeyPair()) {
      const decryptedMessages = await Promise.all(
        chatMessages.map(async (message) => {
          if (message.encryptedContent && !message.decryptedContent) {
            try {
              const decrypted = await cryptoService.decryptMessage(message.encryptedContent);
              return { ...message, decryptedContent: decrypted };
            } catch {
              // If decryption fails, return message as-is
              return message;
            }
          }
          return message;
        })
      );
      setMessages(decryptedMessages);
    } else {
      setMessages(chatMessages);
    }
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

  // Theme operations
  const setTheme = useCallback(async (newTheme: 'dark' | 'light') => {
    setThemeState(newTheme);
    const updated = { ...settings, theme: newTheme };
    setSettings(updated);
    await storageService.saveSettings(updated);
  }, [settings]);

  // Auth operations
  const lockApp = useCallback(() => {
    setIsLocked(true);
    cryptoService.clearKeyPair();
    storageService.clearEncryptionPassphrase();
    setEncryptionState('unencrypted');
  }, []);

  // Auto-lock after inactivity
  useEffect(() => {
    if (isLocked || !isAuthenticated) return;
    
    const lockTimeout = settings.autoLock ? (settings.lockTimeout ?? 5) : 0;
    if (lockTimeout <= 0) return;
    
    const interval = setInterval(() => {
      const inactiveMs = Date.now() - lastActivity;
      if (inactiveMs > lockTimeout * 60 * 1000) {
        lockApp();
      }
    }, 30000);
    
    return () => clearInterval(interval);
  }, [lastActivity, isLocked, isAuthenticated, settings.autoLock, settings.lockTimeout, lockApp]);

  const unlockApp = useCallback(async (passphrase: string): Promise<boolean> => {
    try {
      // Set encryption passphrase so storage can decrypt private keys
      storageService.setEncryptionPassphrase(passphrase);

      // Re-read user from storage — now decrypted with the passphrase
      const decryptedUser = await storageService.getUser();
      if (!decryptedUser?.pgpPrivateKey) {
        storageService.clearEncryptionPassphrase();
        return false;
      }

      // Import the now-decrypted PGP key pair
      await cryptoService.importKeyPair(
        decryptedUser.pgpPrivateKey,
        decryptedUser.pgpPublicKey,
        passphrase
      );

      // Update user state with decrypted data
      setUser(decryptedUser);
      setIsLocked(false);
      setIsAuthenticated(true);
      setEncryptionState('encrypted');

      // Initialize I2P now that keys are decrypted
      if (decryptedUser.i2pAddress && decryptedUser.i2pPublicKey && decryptedUser.i2pPrivateKey) {
        await i2pService.restoreIdentity(
          decryptedUser.i2pPublicKey,
          decryptedUser.i2pPrivateKey,
          decryptedUser.i2pSamDestination,
          decryptedUser.i2pAddress  // Pass the stored I2P address (SAM b32)
        );

        // Register I2P listeners
        if (listenersRegisteredRef.current) {
          i2pService.offMessage(stableMessageHandler);
          i2pService.offStatusChange(setI2pStatus);
        }
        i2pService.onMessage(stableMessageHandler);
        i2pService.onStatusChange(setI2pStatus);
        listenersRegisteredRef.current = true;

        // Start I2P connection and await to ensure SAM destination is persisted
        const savedSettings = await storageService.getSettings();
        const i2pSettings = savedSettings?.i2p || defaultSettings.i2p;
        try {
          const status = await i2pService.initialize(effectiveSamConfig(i2pSettings.sam));
          setI2pStatus(status);
          if (status.samConnected) {
            const identity = i2pService.getIdentity();
            console.log('[AppContext] I2P connected, identity:', identity ? { hasSamDestination: !!identity.samDestination } : null);

            // CRITICAL FIX: If identity lacks samDestination but SAM has a session, sync it
            if (identity && !identity.samDestination) {
              const samSession = samService.exportSession();
              if (samSession?.privateKey) {
                console.log('[AppContext] Syncing missing samDestination from SAM session');
                i2pService.setSamDestination(samSession.privateKey);
              }
            }

            let updatedUser = { ...decryptedUser };
            // CRITICAL: Always persist the SAM destination when:
            // 1. A new destination was just generated, OR
            // 2. We have one in identity but user record doesn't have it stored yet
            // This ensures the destination survives app restarts and we never use TRANSIENT
            const needsSamDestinationUpdate = identity?.samDestination &&
              (!decryptedUser.i2pSamDestination || status.newDestinationGenerated || decryptedUser.i2pSamDestination !== identity.samDestination);
            console.log('[AppContext] needsSamDestinationUpdate:', needsSamDestinationUpdate, 'userHasDestination:', !!decryptedUser.i2pSamDestination);
            if (needsSamDestinationUpdate) {
              updatedUser = { ...updatedUser, i2pSamDestination: identity.samDestination };
            }
            if (status.address && status.address !== decryptedUser.i2pAddress) {
              console.log('[AppContext] Updating stored i2p address to SAM b32:', status.address.slice(0, 20) + '...');
              updatedUser = { ...updatedUser, i2pAddress: status.address };
            }
            // Defensive check: if user doesn't have i2pSamDestination but I2P identity now has one, force save
            if (!updatedUser.i2pSamDestination && identity?.samDestination) {
              console.log('[AppContext] Force-saving SAM destination that was missing from storage');
              updatedUser = { ...updatedUser, i2pSamDestination: identity.samDestination };
            }
            console.log('[AppContext] Saving user updates:', {
              hasSamDestination: !!updatedUser.i2pSamDestination,
              userChanged: updatedUser !== decryptedUser
            });
            if (updatedUser !== decryptedUser) {
              try {
                await storageService.saveUser(updatedUser);
                setUser(updatedUser);
              } catch (err) {
                console.warn('[AppContext] Failed to save user updates:', err);
              }
            }
          }
        } catch (err) {
          console.error('[AppContext] I2P init failed:', err);
          setI2pStatus({ samConnected: false, samAvailable: false, address: null, error: String(err) });
        }
      }

      return true;
    } catch (error) {
      console.error('Error unlocking app:', error);
      storageService.clearEncryptionPassphrase();
      return false;
    }
  // stableMessageHandler has a stable identity (useCallback with []).
  // All other deps (storageService, cryptoService, i2pService, setters) are stable singletons/refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    theme,
    setTheme,
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
