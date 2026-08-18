# SecuChat Desktop - Project Continuation with Claude Code

## Current Status

I have started an Electron-based desktop app for anonymous messaging via I2P. The basic structure is in place, but the project is not yet fully functional.

### Project Structure
```
securechat-desktop/
├── src/
│   ├── main/                 # Electron Main & Preload
│   │   ├── main.ts          # Main process with i2pd integration
│   │   └── preload.ts       # IPC Bridge
│   ├── renderer/             # React UI
│   │   ├── components/       # Header, Sidebar, ChatView, Onboarding
│   │   ├── adapters/         # Storage Adapter
│   │   ├── App.tsx
│   │   └── main.tsx
│   └── shared/               # Core Services
│       ├── types/
│       ├── utils/
│       └── services/         # i2p.ts, crypto.ts, storage.ts, qrSignaling.ts
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tailwind.config.js
```

## What already works

- [x] Project structure
- [x] TypeScript configuration
- [x] Electron + Vite setup
- [x] Tailwind CSS
- [x] Core services (PGP, I2P, Storage) - skeleton
- [x] React components (UI) - skeleton

## What still needs to be implemented

### 1. Install dependencies & test build
```bash
npm install
npm run build
npm run dev
```

### 2. Complete I2P SAM service
The file `src/shared/services/i2p.ts` has an I2PService with TCP sockets, but:
- Check/correct SAM protocol implementation
- Improve error handling
- Correctly track connection status
- Implement `connectToPeer()`
- Implement `sendMessage()`

### 3. Fix Electron main process
The file `src/main/main.ts`:
- Start i2pd as child process (when bundled)
- Or detect external i2pd and connect
- IPC handlers for storage, i2pd status
- Window management

### 4. Complete preload script
The file `src/main/preload.ts`:
- Expose all necessary APIs (contextBridge)
- Define TypeScript types
- Secure IPC communication

### 5. Connect React UI
The file `src/renderer/App.tsx`:
- Initialize I2P service
- Communicate with Electron IPC
- Complete onboarding flow
- Error handling for i2pd connection

### 6. Implement storage adapter
The file `src/renderer/adapters/storage.ts`:
- Use Electron Store
- Or local filesystem via IPC
- Persistently store data

### 7. QR code contact exchange
The file `src/shared/services/qrSignaling.ts`:
- Generate QR code (I2P address + PGP key)
- Scan QR code (camera or file)
- Import contact

### 8. Chat functionality
- Send/receive messages via I2P SAM
- PGP encryption before sending
- Store message history
- Real-time updates

### 9. UI polish
- Loading states
- Error messages
- Anonymity indicators (🟢/🔴)
- Responsive design

### 10. i2pd bundling (optional, later)
- Copy i2pd binary to `resources/i2pd/`
- Configure Electron Builder
- Auto-start i2pd

## Important technical details

### I2P SAM protocol
SAM (Simple Anonymous Messaging) is the interface to i2pd:
- Port: 7656 (default)
- Protocol: Plain TCP (no WebSocket!)
- Commands: `HELLO`, `SESSION CREATE`, `STREAM CONNECT`, etc.

**Example connection setup:**
```typescript
// 1. Connect to SAM (TCP)
const socket = new net.Socket();
socket.connect(7656, '127.0.0.1');

// 2. Send HELLO
socket.write('HELLO VERSION MIN=3.1 MAX=3.1\n');
// Response: HELLO REPLY RESULT=OK VERSION=3.1

// 3. Create session
socket.write('SESSION CREATE STYLE=STREAM ID=mysession DESTINATION=TRANSIENT\n');
// Response: SESSION STATUS RESULT=OK DESTINATION=xxx

// 4. Connect to peer
socket.write('STREAM CONNECT ID=mysession DESTINATION=peer.b32.i2p\n');
// Response: STREAM STATUS RESULT=OK
// After that: Raw data can be sent
```

### PGP encryption
Uses OpenPGP.js:
- ECC keys (curve25519) - faster than RSA
- Messages are encrypted before sending via I2P
- Each contact has their own PGP public key

### Anonymity level
- 🟢 **Green**: I2P connected - IP hidden, anonymous
- 🔴 **Red**: Not connected - no communication possible

## Goals (MVP)

1. **App starts** and detects i2pd (external or embedded)
2. **User can register** (generate PGP + I2P keys)
3. **Add contacts** via QR code or manual entry
4. **Send/receive messages** via I2P
5. **Everything is E2E encrypted**

## Non-goals (for MVP)

- [ ] File transfer
- [ ] Voice messages
- [ ] Group chats
- [ ] Mobile apps
- [ ] Sync multiple devices

## First steps (order)

1. Run `npm install` and fix errors
2. Test `npm run dev` - what errors appear?
3. Debug I2P service - does it connect to SAM?
4. Test Electron IPC - does communication between Main and Renderer work?
5. Complete onboarding flow
6. Implement contact manager
7. Chat functionality
8. Testing & bugfixing

## Debug tips

### Test i2pd
```bash
# Check if i2pd is running
telnet 127.0.0.1 7656

# View i2pd logs (Linux/macOS)
tail -f ~/.i2pd/i2pd.log

# Start i2pd manually with SAM
i2pd --sam.enabled=true --sam.address=127.0.0.1 --sam.port=7656
```

### Electron DevTools
- Main process: `console.log()` in terminal
- Renderer process: Open DevTools (F12 or Cmd+Option+I)

### TypeScript errors
```bash
# Type checking
npx tsc --noEmit
```

## Files that need to be modified

| File | What to do |
|-------|------------|
| `src/shared/services/i2p.ts` | Correctly implement SAM protocol |
| `src/main/main.ts` | i2pd integration, IPC handlers |
| `src/main/preload.ts` | Expose APIs |
| `src/renderer/App.tsx` | App logic, I2P initialization |
| `src/renderer/adapters/storage.ts` | Use Electron Store |
| `src/renderer/components/Onboarding.tsx` | Complete flow |
| `src/renderer/components/ChatView.tsx` | Send/receive messages |

## Questions for you (answer before starting)

1. **i2pd integration**: Should i2pd start automatically with the app (embedded) or should users install it themselves?
   - Embedded = more work, but easier for users
   - External = easier to implement

2. **Platform priority**: Which platform is most important? (Windows/macOS/Linux)

3. **Debug mode**: Should there be a debug mode with more logging?

4. **Storage**: Electron Store (simple) or custom file format?

---

## Task for Claude Code

1. Analyze the current code in all files
2. Identify the problems and missing implementations
3. Implement the missing features step by step
4. Test after each step with `npm run dev`
5. Ensure the app can establish REAL TCP connections to i2pd SAM (Port 7656)

**Important:** The app must be able to establish REAL TCP connections to i2pd SAM (Port 7656). This is the most critical part.
