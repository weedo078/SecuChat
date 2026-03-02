# SecuChat - Error Analysis & Fix Plan

## Context

SecuChat is a privacy-focused messaging app with PGP encryption and I2P routing. The comprehensive codebase analysis identified **58 problems**: **7 critical, 12 high, 18 medium, 7 low**. The most serious issues affect the core functionality of the app: end-to-end encryption is not working correctly, and private keys are stored unprotected.

---

## Phase 1: CRITICAL Errors (core functionality broken)

### 1.1 Message decryption not working
- **File:** `app/src/contexts/AppContext.tsx:213-223`
- **Problem:** Incoming messages were never decrypted. `message.decryptedContent` was simply set to `message.encryptedContent` (plaintext copy instead of decryption). The passphrase was not cached after login, so `decryptMessage()` never had it.
- **Also affected:** `app/src/services/crypto.ts:102-125` - `decryptMessage()` needs passphrase as parameter
- **Fix:** Cache passphrase after successful login in memory (e.g., via state or SessionStorage). Alternative: keep decrypted private key in memory so no passphrase is needed.

### 1.2 SAM destination not persisted
- **File:** `app/src/services/i2p.ts:84-89`
- **Problem:** The SAM destination is created in `generateDestination()` but only held in memory. On every app restart, a new I2P address is created, making it impossible for contacts to reach the user.
- **Fix:** Store destination after generation in IndexedDB and restore on startup.

### 1.3 SAM session logic faulty
- **File:** `app/src/services/i2p.ts:92-94`
- **Problem:** Dead code - both branches of a condition set `sessionPrivKey = undefined`. The session therefore always uses `TRANSIENT`, although it should use the stored identity.
- **Fix:** Use `const sessionPrivKey = this.identity?.samDestination || undefined;`.

### 1.4 PGP private keys unencrypted in IndexedDB
- **File:** `app/src/services/storage.ts`
- **Problem:** All data including `pgpPrivateKey` is stored unencrypted in IndexedDB. Anyone with browser DevTools access can read all keys and messages. This completely undermines the E2E promise.
- **Fix:** Encrypt IndexedDB contents with a key derived from the passphrase (PBKDF2/Argon2), or at least store the private keys encrypted.

### 1.5 Backup contains no messages
- **File:** `app/src/services/storage.ts:398`
- **Problem:** `getMessagesByChatId('all')` looks for chatId='all', which never exists. Backups therefore contain 0 messages.
- **Fix:** Implement own `getAllMessages()` method that collects all messages from all chats.

### 1.6 SAM proxy TCP socket leak
- **File:** `sam-proxy/proxy.mjs:60-66`
- **Problem:** On TCP errors, the socket is not destroyed when the WebSocket is not OPEN. Leads to TCP connection leaks.
- **Fix:** Always call `tcp.destroy()`, regardless of WebSocket status.

### 1.7 B32 address fallback is wrong
- **File:** `app/src/services/i2pSam.ts:274-277`
- **Problem:** When `crypto.subtle` fails, Base64 is truncated to 52 characters and `.b32.i2p` is appended - this is not a valid b32 address.
- **Fix:** Correctly propagate error instead of generating invalid address.

---

## Phase 2: HIGH Priority (stability & security)

### 2.1 Event listener memory leak
- **File:** `app/src/contexts/AppContext.tsx:176, 190`
- **Problem:** `i2pService.onMessage()` and `onStatusChange()` register new listeners on every `initialize()` call without removing old ones. Listeners accumulate, messages are processed multiple times.
- **Fix:** Implement listener deregistration (return cleanup function) or check if already registered.

### 2.2 No validation of incoming messages
- **File:** `app/src/contexts/AppContext.tsx:200-210`
- **Problem:** Incoming I2P messages are accepted as `Message` without validation. No check for valid chatId, senderId, timestamp, etc. Attackers can corrupt the local DB.
- **Fix:** Implement schema validation (e.g., with Zod) for incoming messages.

### 2.3 SAM timeout handler race condition
- **File:** `app/src/services/i2pSam.ts:371-375`
- **Problem:** Timeout handler looks for `resolve` in array, but `wrappedResolve` was pushed. `indexOf` never finds the entry, resolver stays in array = memory leak + stale resolver.
- **Fix:** Use reference to `wrappedResolve` in timeout.

### 2.4 Pending resolvers not rejected on disconnect
- **File:** `app/src/services/i2pSam.ts:323`
- **Problem:** On `disconnect()`, `pendingResolvers = []` is set, but waiting promises are never rejected. Code hangs forever.
- **Fix:** Reject all resolvers with an error before clearing array.

### 2.5 No React error boundaries
- **Problem:** No ErrorBoundary component exists. A single error in a component crashes the entire app without fallback UI.
- **Fix:** Wrap error boundary around critical areas (chat, settings, etc.).

### 2.6 SAM proxy unlimited buffer
- **File:** `sam-proxy/proxy.mjs:35, 44-49`
- **Problem:** `buffer` has no size limit. Can grow unlimited by malicious SAM responses.
- **Fix:** Implement max buffer size (e.g., 10MB).

### 2.7 SAM proxy reconnection missing
- **File:** `sam-proxy/proxy.mjs:98-101`
- **Problem:** On server error `process.exit(1)` without recovery. Proxy must be manually restarted.
- **Fix:** Graceful recovery with reconnect logic instead of hard exit.

### 2.8 Race condition in SAM reconnection
- **File:** `app/src/services/i2pSam.ts:433-441`
- **Problem:** Multiple reconnect attempts can run simultaneously since no lock exists.
- **Fix:** Introduce `isReconnecting` flag.

### 2.9 I2P config save without error handling
- **File:** `app/src/components/custom/Settings.tsx:632-649`
- **Problem:** `i2pService.initialize()` is called without try-catch. Errors are swallowed.
- **Fix:** Add try-catch with user feedback.

### 2.10 No file size validation in sendFile
- **File:** `app/src/services/i2p.ts:282-330`
- **Problem:** No check on `file.size`. User could accidentally send gigabyte-sized files.
- **Fix:** Check max file size (e.g., 50MB).

### 2.11 Backup restore incomplete
- **File:** `app/src/services/storage.ts:412-446`
- **Problem:** Existing messages/devices are not deleted on restore. Duplicates possible.
- **Fix:** Complete cleanup before restore.

### 2.12 Backup encryption is fake
- **File:** `app/src/components/custom/Settings.tsx:387-398`
- **Problem:** Restore simply does `JSON.parse()` - backup is unencrypted JSON, although encryption is suggested.
- **Fix:** Implement real encryption or remove fake hint.

---

## Phase 3: MEDIUM Priority (UX & robustness)

### 3.1 Service worker disabled
- **File:** `app/index.html:30-44`
- **Problem:** SW registration commented out "for debugging". PWA does not work offline.
- **Fix:** Re-enable SW, implement cache strategy.

### 3.2 SW cache version hardcoded
- **File:** `app/public/sw.js:4`
- **Problem:** `CACHE_NAME = 'securechat-v1'` - updates don't reach users.
- **Fix:** Include build hash or timestamp in cache name.

### 3.3 connectionState incomplete
- **File:** `app/src/contexts/AppContext.tsx:253-261`
- **Problem:** `connectionState` only considers `i2pStatus`, not `isLocked` or `encryptionState`.
- **Fix:** Include all relevant states in derivation.

### 3.4 Race condition: Unmounted component state update
- **File:** `app/src/components/custom/Onboarding.tsx:70-98`
- **Problem:** `generateKeys` can set state after component unmount.
- **Fix:** Use AbortController or `isMounted` ref.

### 3.5 I2P test without timeout
- **File:** `app/src/components/custom/Onboarding.tsx:151-163`
- **Problem:** `samService.isAvailable()` can hang endlessly, no user feedback on error.
- **Fix:** Timeout (10s) + detailed error message.

### 3.6 SAM command timeout 30s too long
- **File:** `app/src/services/i2pSam.ts:376`
- **Problem:** 30-second timeout freezes UI.
- **Fix:** Reduce to 10s, with user feedback.

### 3.7 No exponential backoff on reconnect
- **File:** `app/src/services/i2pSam.ts:436-437`
- **Fix:** Exponential backoff with jitter instead of linear.

### 3.8 Sequence number bug (falsy 0)
- **File:** `app/src/contexts/AppContext.tsx:207`
- **Problem:** `(data.sequenceNumber as number) || 0` - `||` also replaces valid `0`.
- **Fix:** Use nullish coalescing `??` instead of `||`.

### 3.9 No I2P address validation
- **File:** `app/src/components/custom/AddContactDialog.tsx:217-218`
- **Fix:** Regex check for `*.b32.i2p` format.

### 3.10 No port validation
- **File:** `app/src/components/custom/Settings.tsx:696-705`
- **Fix:** Validate range 1-65535.

### 3.11 Missing ARIA labels
- **Files:** Header.tsx, ChatView.tsx, Sidebar.tsx
- **Fix:** Add ARIA labels for status dots, buttons, icons.

### 3.12 Add contact button without disabled state
- **File:** `app/src/components/custom/AddContactDialog.tsx:470`
- **Fix:** Disable button during API call.

### 3.13 No user feedback on image upload error
- **File:** `app/src/components/custom/ChatView.tsx:79-83`
- **Fix:** Toast/alert on error instead of only console.error.

### 3.14 Debug plugin in production
- **File:** `app/vite.config.ts:4`
- **Problem:** `kimi-plugin-inspect-react` should only be used in dev.
- **Fix:** Only load in `mode === 'development'`.

### 3.15 Excessive console.log calls
- **Files:** All service files (52+ places)
- **Fix:** Proper logging framework or remove console.log.

---

## Phase 4: LOW Priority (cleanup & polish)

### 4.1 Dead code removal
- `app/src/services/webrtc.ts` (353 lines) - unused
- `app/src/services/qrSignaling.ts` (367 lines) - unused
- **Fix:** Delete files since not imported anywhere.

### 4.2 Unused imports
- **File:** `app/src/components/custom/Onboarding.tsx` - several icons imported but not used.
- **Fix:** Clean up imports.

### 4.3 Device import not implemented
- **File:** `app/src/components/custom/Onboarding.tsx:673-710`
- **Problem:** `DeviceManualImport` validates JSON but doesn't actually import the keys.
- **Fix:** Implement actual import or mark feature as "coming soon".

### 4.4 No localization despite language setting
- **Problem:** All UI strings are hardcoded German, although `language` exists in settings.
- **Fix:** Introduce i18n framework or remove language setting.

### 4.5 PWA manifest incomplete
- **File:** `app/public/manifest.json`
- **Fix:** Add `categories`, `screenshots`, `shortcuts`.

### 4.6 Duplicated unlock dialog
- **Files:** `App.tsx` and `Header.tsx`
- **Fix:** Consolidate into one component.

### 4.7 Outdated dependencies
- **File:** `app/package.json`
- **Problem:** Several major versions outdated (tailwindcss 3→4, recharts 2→3, etc.)
- **Fix:** `npm audit` + gradual updates.

---

## Recommended order

| Phase | Effort | Priority | Number of issues |
|-------|--------|----------|------------------|
| 1: Critical | ~3-4 days | Immediate | 7 |
| 2: High | ~3-4 days | This week | 12 |
| 3: Medium | ~3-4 days | Next week | 15 |
| 4: Low | ~1-2 days | Backlog | 7 |

## Verification

After each phase:
1. `cd app && npx tsc --noEmit` - check TypeScript errors
2. `cd app && npm run lint` - check ESLint errors
3. `cd app && npm run build` - build works
4. Manual test: Start app, send/receive message, create/restore backup
5. Browser DevTools: No console errors, no memory leak in Performance tab
