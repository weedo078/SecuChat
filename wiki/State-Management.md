# State Management

SecuChat uses a single React context (`AppContext`) as the global state store. There is no Redux, Zustand, or similar library.

## AppContext

**File:** `app/src/contexts/AppContext.tsx`

### Provider

Wrap the component tree with `AppProvider`:

```tsx
<AppProvider>
  <App />
</AppProvider>
```

### Hook

Every component that needs global state uses `useApp()`:

```tsx
const { user, contacts, messages, sendMessage, i2pStatus } = useApp();
```

Calling `useApp()` outside of `AppProvider` throws a descriptive error.

---

## State Shape

```ts
interface AppContextType {
  // Identity
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

  // Messages (active chat only)
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
  theme: 'dark' | 'light' | 'system';
  setTheme: (theme: 'dark' | 'light' | 'system') => void;

  // Connection
  connectionState: ConnectionState;    // derived from i2pStatus + isLocked
  encryptionState: EncryptionState;    // 'encrypted' | 'unencrypted' | 'error'
  i2pStatus: I2PStatus | null;         // raw status from i2pService

  // Auth
  isAuthenticated: boolean;
  isLocked: boolean;
  lockApp: () => void;
  unlockApp: (passphrase: string) => Promise<boolean>;

  // Loading
  isLoading: boolean;

  // Init
  initialize: () => Promise<void>;
}
```

### Default Settings

`AppSettings` includes notification preferences and other platform-aware defaults:

```ts
const defaultSettings: AppSettings = {
  i2p: { enabled: false, sam: { host: '127.0.0.1', port: 7657 } },
  notifications: { enabled: true, soundEnabled: true },
  autoLock: true,
  autoLockTimeout: 5, // minutes
  language: 'auto',   // follows system, falls back to English
};
```

`effectiveSamConfig()` adjusts the SAM port based on platform: Electron forces 7657 (bundled proxy), Android uses 7656 (native plugin), browser uses the user-configured value.

---

## connectionState Derivation

`connectionState` is derived from `i2pStatus`, `isLocked`, and `encryptionState` via a `useEffect`:

```ts
useEffect(() => {
  if (isLocked)                    setConnectionState('locked');
  else if (encryptionState === 'error') setConnectionState('error');
  else if (i2pStatus?.samConnected) setConnectionState('connected');
  else if (i2pStatus?.error)       setConnectionState('error');
  else                             setConnectionState('disconnected');
}, [i2pStatus, isLocked, encryptionState]);
```

| `connectionState` | Meaning |
|------------------|---------|
| `'connected'` | SAM connected and unlocked |
| `'disconnected'` | SAM not connected |
| `'locked'` | App is locked |
| `'error'` | Encryption or connection error |

---

## I2P Status

`i2pStatus` reflects the raw `I2PStatus` from `i2pService`:

```ts
interface I2PStatus {
  samConnected: boolean;
  samAvailable: boolean;
  address: string | null;
  error?: string;
  newDestinationGenerated?: boolean;
  leasesetPublished?: boolean;    // true when inbound tunnels are ready
}
```

The header dot color maps to:
- Green: `samConnected && leasesetPublished`
- Yellow: `samConnected && !leasesetPublished`
- Red: `!samConnected`

---

## Auto-Reconnect

A `useEffect` polls I2P connection every 30 seconds when SAM is enabled but not connected:

```ts
useEffect(() => {
  if (!user || i2pStatus?.samConnected || !sam.enabled) return;
  const timer = setTimeout(() => {
    i2pService.initialize(sam).then(setI2pStatus);
  }, 30000);
  return () => clearTimeout(timer);
}, [user, i2pStatus, settings.i2p.sam]);
```

---

## Initialization Sequence

`initialize()` is called once on mount from `App.tsx`:

1. `storageService.init()` — detect platform, initialize appropriate storage provider (IndexedDB / SQLite / Capacitor)
2. Load user → detect if keys are encrypted → set `isLocked` if so
3. Load contacts, chats, settings
4. `cryptoService.importKeyPair()` — if keys are plaintext
5. `i2pService.restoreIdentity()` — reload Ed25519 keypair
6. `i2pService.initialize()` — fire-and-forget; `setI2pStatus` called on update

`isLoading` is `true` until step 6 completes (or fails). The UI shows a spinner during this time.

---

## Auth Flow

### Lock

```ts
lockApp()
  → cryptoService.clearKeyPair()
  → storageService.clearEncryptionPassphrase()
  → setIsLocked(true)
  → setEncryptionState('unencrypted')
```

### Unlock

```ts
unlockApp(passphrase)
  → storageService.setEncryptionPassphrase(passphrase)
  → storageService.getUser()          // decrypts keys
  → cryptoService.importKeyPair(...)  // loads into memory
  → i2pService.restoreIdentity(...)
  → i2pService.initialize(...)        // reconnect
  → setIsLocked(false)
```

---

## Message Handling

Incoming messages from I2P are handled by `handleIncomingMessage` (registered via `i2pService.onMessage()`):

1. Validate with Zod schema (`incomingMessageSchema`)
2. Look up local contact by `senderFingerprint`
3. Look up or auto-create local chat
4. Decrypt with `cryptoService.decryptMessage()`
5. Save to `storageService`
6. Update `messages` state if the affected chat is currently active

`messages` state only holds the messages for the currently open chat (`activeChat`). Switching chats triggers `loadMessages()`.
