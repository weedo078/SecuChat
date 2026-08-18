# Lock-Flow UX Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two lock-flow bugs (auto-lock dialog doesn't reopen, messages stay encrypted after unlock) and replace the modal lock-screen with a fullscreen replacement + adaptive quick-lock button.

**Architecture:** Centralize lock/unlock/re-decrypt lifecycle in `AppContext.tsx`. Extract pure logic (which action to take on lock/unlock given current state) into testable helpers so the existing pure-logic vitest setup can cover it. Replace `UnlockDialog` with a new `FullScreenLock` component and add `QuickLockButton` (FAB on mobile, Header icon on desktop).

**Tech Stack:** React 19, TypeScript, shadcn/ui (`Skeleton` already exists), lucide-react icons, vitest (pure-logic, no React Testing Library available in this project).

## Global Constraints

- TypeScript strict mode; no `any` unless wrapping 3rd-party plugin types.
- Components use existing shadcn/ui primitives from `app/src/components/ui/*`.
- All `useTranslation()` strings must be added to both `de.json` and `en.json`.
- No new npm packages — Skeleton already exists at `app/src/components/ui/skeleton.tsx`, icons already imported from `lucide-react`.
- Run `cd app && npm run lint` before final commit per CLAUDE.md.
- Run `cd app && npx tsc --noEmit` before final commit per CLAUDE.md.
- Existing vitest setup: `cd app && npm test` runs `vitest run` — no jsdom/RTL, so all tests must be pure-logic (no React rendering).
- Branch: `feat/android-port`. Commit after each task.

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `app/src/components/custom/FullScreenLock.tsx` | Vollbild-Lock-Ersatz: Logo, 🔒, Passphrase-Input, Unlock-Button, Fehlertext. Ersetzt `UnlockDialog` als Lock-UI. |
| `app/src/components/custom/QuickLockButton.tsx` | Adaptive: FAB auf Mobile, Header-Icon auf Desktop. Reines UI, ruft `onLock`-Callback auf. |
| `app/src/components/custom/MessageSkeleton.tsx` | 5 Skeleton-Blöcke (Pulse-Animation) als Platzhalter für Messages während Decrypt. |
| `app/src/utils/lockStateMachine.ts` | Pure-Logic Helper: `getPostLockState`, `getPostUnlockDecryptAction`, `shouldShowFullScreenLock`. Testbar ohne React. |
| `app/src/__tests__/lockStateMachine.test.ts` | Tests für Pure-Logic Helper. |

### Modified Files

| File | Change |
|------|--------|
| `app/src/App.tsx` | `unlockDismissed`-State entfernen. `UnlockDialog` durch `FullScreenLock` ersetzen. `QuickLockButton`-FAB im Layout-Root. |
| `app/src/contexts/AppContext.tsx` | `lockApp` clearet `activeChat` + `messages`. `decrypting` State + neuer useEffect für Re-Decrypt. Cold-Start: `setIsLocked(true)` bei `keysEncrypted && !testModeAutoUnlock`. |
| `app/src/components/custom/Header.tsx` | Lock-Icon-Button zwischen Connection-Status und User-Menü (Desktop). Dropdown-Lock-Item bleibt für Backward-Compat, aber Icon-Button ist primärer Pfad. |
| `app/src/components/custom/ChatView.tsx` | `MessageSkeleton` rendern wenn `decrypting && messages.length === 0`. |
| `app/src/locales/de.json` | Neue Keys: `lock.fullscreen.title`, `lock.fullscreen.description`, `lock.quickLock` |
| `app/src/locales/en.json` | Selbe Keys auf Englisch. |

### Deprecated (nicht löschen)

- `app/src/components/custom/UnlockDialog.tsx` — bleibt im Code, wird nicht mehr gemounted. Kann in separatem Cleanup entfernt werden.

---

## Task 1: Pure-Logic Helper für Lock-State-Entscheidungen

**Files:**
- Create: `app/src/utils/lockStateMachine.ts`
- Create: `app/src/__tests__/lockStateMachine.test.ts`

**Purpose:** Da das Projekt keine React-Testing-Library hat, extrahieren wir die Entscheidungslogik (was passiert beim Lock, was beim Unlock) in eine pure-function-Sammlung. Diese Funktionen sind das "Gehirn" der Lock-Flow-UX und vollständig testbar.

**Interfaces:**
- Consumes: nichts (pure functions)
- Produces: Helper-Funktionen die später in `AppContext.tsx` verwendet werden

- [ ] **Step 1: Write failing tests for lockStateMachine**

Write `app/src/__tests__/lockStateMachine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getPostLockActions,
  getPostUnlockActions,
  shouldShowFullScreenLock,
} from '../utils/lockStateMachine';

describe('lockStateMachine', () => {
  describe('getPostLockActions', () => {
    it('returns all cleanup actions when locking from unlocked state', () => {
      const actions = getPostLockActions({ wasActive: true });
      expect(actions.clearActiveChat).toBe(true);
      expect(actions.clearMessages).toBe(true);
      expect(actions.clearKeyPair).toBe(true);
    });

    it('does not skip cleanup when no chat was active', () => {
      const actions = getPostLockActions({ wasActive: false });
      expect(actions.clearActiveChat).toBe(true);
      expect(actions.clearMessages).toBe(true);
    });
  });

  describe('getPostUnlockActions', () => {
    it('triggers re-decrypt when an active chat exists', () => {
      const actions = getPostUnlockActions({
        hasActiveChat: true,
        hasKeyPair: true,
      });
      expect(actions.shouldReDecrypt).toBe(true);
      expect(actions.shouldShowSkeleton).toBe(true);
    });

    it('skips re-decrypt when no active chat (user lands on chat list)', () => {
      const actions = getPostUnlockActions({
        hasActiveChat: false,
        hasKeyPair: true,
      });
      expect(actions.shouldReDecrypt).toBe(false);
      expect(actions.shouldShowSkeleton).toBe(false);
    });

    it('skips re-decrypt when key pair not loaded yet', () => {
      const actions = getPostUnlockActions({
        hasActiveChat: true,
        hasKeyPair: false,
      });
      expect(actions.shouldReDecrypt).toBe(false);
    });
  });

  describe('shouldShowFullScreenLock', () => {
    it('shows fullscreen lock when isLocked is true', () => {
      expect(shouldShowFullScreenLock({ isLocked: true })).toBe(true);
    });

    it('hides fullscreen lock when isLocked is false', () => {
      expect(shouldShowFullScreenLock({ isLocked: false })).toBe(false);
    });

    it('ignores the dismissed flag (bug 1 fix — no dismiss state)', () => {
      // Vorher: `isLocked && !unlockDismissed`. Jetzt: nur `isLocked`.
      // Der `wasDismissed`-Parameter existiert nicht mehr absichtlich.
      expect(shouldShowFullScreenLock({ isLocked: true })).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- lockStateMachine`
Expected: FAIL — "Cannot find module '../utils/lockStateMachine'"

- [ ] **Step 3: Implement lockStateMachine.ts**

Write `app/src/utils/lockStateMachine.ts`:

```typescript
/**
 * Pure-Logic Helper für Lock/Unlock-State-Entscheidungen.
 *
 * Diese Funktionen kapseln die Entscheidungslogik ohne React-Abhängigkeiten,
 * damit sie mit dem bestehenden vitest-Setup (kein jsdom/RTL) getestet werden
 * können. Die tatsächlichen Side-Effects (setState, cryptoService.*) bleiben
 * in AppContext.tsx.
 */

export interface PostLockState {
  /** War vor dem Lock ein Chat aktiv? (für zukünftige Erweiterungen — aktuell egal) */
  wasActive: boolean;
}

export interface LockCleanupActions {
  clearActiveChat: boolean;
  clearMessages: boolean;
  clearKeyPair: boolean;
}

/**
 * Welche Side-Effects sollen beim Lock ausgeführt werden?
 * Aktuell: immer alle. Der `wasActive`-Parameter ist Vorrätig für später.
 */
export function getPostLockActions(state: PostLockState): LockCleanupActions {
  void state; // aktuell ungenutzt, aber API-stabil für zukünftige Logik
  return {
    clearActiveChat: true,
    clearMessages: true,
    clearKeyPair: true,
  };
}

export interface PostUnlockState {
  hasActiveChat: boolean;
  hasKeyPair: boolean;
}

export interface UnlockActions {
  shouldReDecrypt: boolean;
  shouldShowSkeleton: boolean;
}

/**
 * Welche Aktionen sollen direkt nach erfolgreichem Unlock laufen?
 *
 * - Re-Decrypt: nur wenn ein Chat aktiv war UND der Key geladen ist.
 * - Skeleton: nur wenn Re-Decrypt läuft (sonst kein User-Feedback nötig).
 *
 * Hinweis: Mit D4 (Chat-Liste nach Unlock) ist hasActiveChat in der Regel false,
 * weil `lockApp` `activeChat` clearet. Diese Funktion deckt trotzdem den Fall
 * ab, falls D4 je gelockert wird.
 */
export function getPostUnlockActions(state: PostUnlockState): UnlockActions {
  const shouldReDecrypt = state.hasActiveChat && state.hasKeyPair;
  return {
    shouldReDecrypt,
    shouldShowSkeleton: shouldReDecrypt,
  };
}

export interface LockUiState {
  isLocked: boolean;
}

/**
 * Soll der FullScreenLock gerendert werden?
 *
 * Fix für Bug 1: kein `unlockDismissed`-Flag mehr. Der State ist redundant mit
 * `isLocked` und wurde im Original vergessen zurückzusetzen.
 */
export function shouldShowFullScreenLock(state: LockUiState): boolean {
  return state.isLocked;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- lockStateMachine`
Expected: PASS (alle 8 Tests grün)

- [ ] **Step 5: Commit**

```bash
cd /home/g/dev/SecuChat
git add app/src/utils/lockStateMachine.ts app/src/__tests__/lockStateMachine.test.ts
git commit -m "feat(lock): extract pure-logic state machine for lock/unlock decisions

Decisions extracted:
- getPostLockActions: cleanup side-effects on lock
- getPostUnlockActions: re-decrypt + skeleton triggers after unlock
- shouldShowFullScreenLock: replaces buggy isLocked && !unlockDismissed

Pure functions enable testing without React/jsdom (project uses vitest pure-logic only).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: AppContext — lockApp clearet State, decrypting State, Cold-Start-Fix

**Files:**
- Modify: `app/src/contexts/AppContext.tsx`

**Purpose:** Diese Änderungen sind der Kern von Bug 1 + Bug 2 Fix. `lockApp` clearet jetzt zusätzlich `activeChat` und `messages`, sodass nach Unlock keine verschlüsselten Messages mehr im State liegen.

- [ ] **Step 1: Modify lockApp to clear activeChat and messages**

In `app/src/contexts/AppContext.tsx`, locate the `lockApp` useCallback (around line 1074):

```typescript
const lockApp = useCallback(() => {
  setIsLocked(true);
  cryptoService.clearKeyPair();
  storageService.clearEncryptionPassphrase();
  setEncryptionState('unencrypted');
}, []);
```

Replace with:

```typescript
const lockApp = useCallback(() => {
  setIsLocked(true);
  setActiveChatState(null);   // NEU: clears active chat
  setMessages([]);            // NEU: clears in-memory messages
  cryptoService.clearKeyPair();
  storageService.clearEncryptionPassphrase();
  setEncryptionState('unencrypted');
}, []);
```

- [ ] **Step 2: Add `decrypting` state**

In `app/src/contexts/AppContext.tsx`, find the `messages` state declaration (around line 191):

```typescript
const [messages, setMessages] = useState<Message[]>([]);
```

Add directly below it:

```typescript
const [decrypting, setDecrypting] = useState(false);
```

- [ ] **Step 3: Add re-decrypt useEffect**

In `app/src/contexts/AppContext.tsx`, locate the existing re-decrypt useEffect area (after `loadMessages` definition, around line 1038). Add this useEffect directly after `loadMessages`:

```typescript
// Re-decrypt active chat when unlock succeeds.
// Hinweis: Mit D4 (Chat-Liste nach Unlock) ist activeChatRef.current in der
// Regel null, weil lockApp activeChat clearet. Dieser useEffect deckt trotzdem
// den Fall ab, falls D4 je gelockert wird.
useEffect(() => {
  if (!isLocked && user && activeChatRef.current && cryptoService.hasKeyPair()) {
    const chatId = activeChatRef.current.id;
    setDecrypting(true);
    void loadMessages(chatId).finally(() => {
      // Skeleton mindestens 500ms sichtbar für UX-Feedback
      setTimeout(() => setDecrypting(false), 500);
    });
  }
}, [isLocked, user, loadMessages]);
```

- [ ] **Step 4: Cold-Start-Fix in initialize()**

In `app/src/contexts/AppContext.tsx`, locate the `initialize` function and find the section where `keysEncrypted` is checked (around line 258-330). Find this block:

```typescript
if (keysEncrypted && testPassphrase) {
  // ... test-mode auto-unlock path
}
// Keys are encrypted in storage — need passphrase to unlock
needsUnlock = true;
setIsLocked(true);
```

The pattern is: when `keysEncrypted` is true AND no test-mode auto-unlock is happening, we need to mark the app as locked. Add `setIsLocked(true)` immediately after `needsUnlock = true;` (or in the same line where it's set). Find the existing `needsUnlock = true; setIsLocked(true);` line in the non-test path (around line 326-327):

```typescript
// Keys are encrypted in storage — need passphrase to unlock
needsUnlock = true;
setIsLocked(true);
```

Verify this is correct. If the existing code already has `setIsLocked(true)` in the keysEncrypted-no-test-passphrase path, no change needed — skip to Step 5.

If not, add `setIsLocked(true);` after `needsUnlock = true;` in that specific block.

- [ ] **Step 5: Expose decrypting via Context value**

In `app/src/contexts/AppContext.tsx`, find the `value` object (around line 1253):

```typescript
const value: AppContextType = {
  user,
  // ...
  isLoading,
  initialize,
};
```

Add `decrypting` to the value object:

```typescript
const value: AppContextType = {
  user,
  // ...
  isLoading,
  initialize,
  decrypting,
};
```

Also add `decrypting: boolean` to the `AppContextType` interface (around line 67-110). Find the interface block:

```typescript
export interface AppContextType {
  // ... existing properties
  isLoading: boolean;
  initialize: () => Promise<void>;
}
```

Add:

```typescript
  decrypting: boolean;
```

- [ ] **Step 6: Run TypeScript check**

Run: `cd app && npx tsc --noEmit`
Expected: PASS (no errors)

If errors mention `value` not matching interface, ensure `decrypting` is in both interface AND value object.

- [ ] **Step 7: Commit**

```bash
cd /home/g/dev/SecuChat
git add app/src/contexts/AppContext.tsx
git commit -m "feat(lock): clear activeChat+messages on lock, add decrypting state

Bug 2 fix: lockApp now clears activeChat and messages state. After unlock,
no stale encrypted '[Verschlüsselt]' messages remain in memory.

Adds decrypting state + useEffect for re-decrypt of active chat (if any)
after successful unlock. Decrypting exposed via context for skeleton display.

Cold-start fix: setIsLocked(true) is now explicitly set when keysEncrypted
is true and no test-mode auto-unlock is configured, preventing the brief
'unlocked state' flash on app boot.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: FullScreenLock Komponente

**Files:**
- Create: `app/src/components/custom/FullScreenLock.tsx`

**Purpose:** Vollbild-Ersatz für `UnlockDialog`. Layout: zentriert, Logo oben, 🔒-Icon groß, Passphrase-Input, Unlock-Button, Fehlertext darunter.

- [ ] **Step 1: Add translation keys**

Edit `app/src/locales/de.json`. Find the `unlock` section (used by `UnlockDialog`):

```json
"unlock": {
  "title": "App entsperren",
  "description": "Gib deine Passphrase ein, um SecuChat zu entsperren.",
  "passphrasePlaceholder": "Passphrase",
  "enterPassphrase": "Passphrase eingeben",
  "wrongPassphrase": "Falsche Passphrase",
  "unlock": "Entsperren"
}
```

Add a new `lock` section AFTER `unlock` (keep `unlock` for backward compat):

```json
"lock": {
  "fullscreen": {
    "title": "SecuChat gesperrt",
    "description": "Gib deine Passphrase ein, um deine verschlüsselten Nachrichten zu lesen.",
    "appName": "SecuChat"
  },
  "quickLock": "App sperren"
}
```

- [ ] **Step 2: Add same keys to en.json**

Edit `app/src/locales/en.json`. Find the `unlock` section and add the same `lock` block after it:

```json
"lock": {
  "fullscreen": {
    "title": "SecuChat locked",
    "description": "Enter your passphrase to read your encrypted messages.",
    "appName": "SecuChat"
  },
  "quickLock": "Lock app"
}
```

- [ ] **Step 3: Create FullScreenLock.tsx**

Write `app/src/components/custom/FullScreenLock.tsx`:

```typescript
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import appIcon from '/icon-192x192.png';

interface FullScreenLockProps {
  onUnlock: (passphrase: string) => Promise<boolean>;
  error?: string;
}

/**
 * Vollbild-Ersatz für den UnlockDialog.
 *
 * Layout: zentriert, Logo oben, Lock-Icon groß, Passphrase-Input, Unlock-Button.
 * Kein App-Untergrund sichtbar (Privacy-First). Ersetzt das Modal-Pattern aus
 * UnlockDialog, das den App-State durchscheinen ließ.
 */
export function FullScreenLock({ onUnlock, error }: FullScreenLockProps) {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [localError, setLocalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleUnlock = async () => {
    if (!passphrase || isSubmitting) return;
    setIsSubmitting(true);
    setLocalError('');
    try {
      const success = await onUnlock(passphrase);
      if (!success) {
        setLocalError(t('unlock.wrongPassphrase'));
      } else {
        setPassphrase('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayError = error || localError;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
      className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center px-6"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <img src={appIcon} alt={t('lock.fullscreen.appName')} className="h-16 w-16 mb-6" />
      <h1 id="lock-title" className="text-2xl font-semibold mb-2">
        {t('lock.fullscreen.title')}
      </h1>
      <p className="text-sm text-muted-foreground mb-8 text-center max-w-sm">
        {t('lock.fullscreen.description')}
      </p>
      <Lock className="h-12 w-12 text-primary mb-6" aria-hidden="true" />
      <div className="w-full max-w-sm space-y-4">
        <Input
          type="password"
          placeholder={t('unlock.passphrasePlaceholder')}
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
          aria-label={t('unlock.enterPassphrase')}
          autoFocus
          disabled={isSubmitting}
        />
        {displayError && (
          <p className="text-sm text-destructive" role="alert">{displayError}</p>
        )}
        <Button
          onClick={handleUnlock}
          className="w-full"
          disabled={isSubmitting || !passphrase}
        >
          {t('unlock.unlock')}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run TypeScript check**

Run: `cd app && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/g/dev/SecuChat
git add app/src/components/custom/FullScreenLock.tsx app/src/locales/de.json app/src/locales/en.json
git commit -m "feat(lock): FullScreenLock component replaces UnlockDialog as fullscreen overlay

Layout: centered logo, lock icon, passphrase input, unlock button.
No app background visible — privacy-first (D1).
Adds lock.* translation keys to de.json and en.json.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: App.tsx — unlockDismissed entfernen, FullScreenLock mounten

**Files:**
- Modify: `app/src/App.tsx`

**Purpose:** Bug 1 Fix. `unlockDismissed`-State ist redundant mit `isLocked` und verursacht den Bug, dass nach Auto-Lock der Dialog nicht mehr aufgeht. Wir entfernen ihn komplett.

- [ ] **Step 1: Update imports**

In `app/src/App.tsx`, change:

```typescript
import { UnlockDialog } from '@/components/custom/UnlockDialog';
```

To:

```typescript
import { FullScreenLock } from '@/components/custom/FullScreenLock';
```

- [ ] **Step 2: Remove unlockDismissed state and related logic**

In `app/src/App.tsx`, locate:

```typescript
const [unlockDismissed, setUnlockDismissed] = useState(false);

// Derive unlock dialog from isLocked state without useEffect
const showUnlockDialog = isLocked && !unlockDismissed;
```

Replace with:

```typescript
// Bug 1 fix: kein unlockDismissed-Flag mehr. Der State wurde vergessen
// zurückzusetzen, sodass nach Auto-Lock der Unlock-Dialog nicht mehr öffnete.
// FullScreenLock mounted direkt aus isLocked.
const showFullScreenLock = isLocked;
```

- [ ] **Step 3: Simplify handleUnlock**

In `app/src/App.tsx`, locate:

```typescript
const handleUnlock = async (passphrase: string): Promise<boolean> => {
  const success = await unlockApp(passphrase);
  if (success) {
    setUnlockDismissed(true);
  }
  return success;
};

const handleCloseUnlockDialog = () => {
  // Dialog kann nicht geschlossen werden ohne Entsperrung
  // (optional: könnte auch setUnlockDismissed(false) bleiben)
};
```

Replace with:

```typescript
const handleUnlock = async (passphrase: string): Promise<boolean> => {
  return await unlockApp(passphrase);
};
// Kein handleCloseUnlockDialog mehr nötig — FullScreenLock hat keinen Close-Button.
```

- [ ] **Step 4: Replace UnlockDialog with FullScreenLock**

In `app/src/App.tsx`, locate:

```typescript
<UnlockDialog
  isOpen={showUnlockDialog}
  onClose={handleCloseUnlockDialog}
  onUnlock={handleUnlock}
/>
```

Replace with:

```typescript
{showFullScreenLock && (
  <FullScreenLock onUnlock={handleUnlock} />
)}
```

- [ ] **Step 5: Run TypeScript check**

Run: `cd app && npx tsc --noEmit`
Expected: PASS (no errors related to removed state)

- [ ] **Step 6: Commit**

```bash
cd /home/g/dev/SecuChat
git add app/src/App.tsx
git commit -m "fix(lock): remove buggy unlockDismissed state, mount FullScreenLock directly

Bug 1 fix: unlockDismissed was set to true on unlock success but never
reset on subsequent lockApp(). After first unlock, auto-lock would not
reopen the dialog until app restart.

Removes the redundant state entirely. FullScreenLock is mounted directly
when isLocked is true. No close handler needed (fullscreen can't be
dismissed without unlock).

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: QuickLockButton Komponente

**Files:**
- Create: `app/src/components/custom/QuickLockButton.tsx`

**Purpose:** Adaptive Quick-Lock-Button: FAB auf Mobile, Header-Icon auf Desktop. Beide rufen `onLock`-Callback auf. Auf Mobile in Daumen-Zone, auf Desktop unauffällig.

- [ ] **Step 1: Create QuickLockButton.tsx**

Write `app/src/components/custom/QuickLockButton.tsx`:

```typescript
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface QuickLockButtonProps {
  onLock: () => void;
  variant: 'fab' | 'icon';
}

/**
 * Adaptive Quick-Lock-Button.
 *
 * - variant='fab': Mobile FAB, fixed bottom-right, 56x56px, 16px Inset
 * - variant='icon': Desktop Header-Icon-Button
 *
 * Visuell identische Lock-Icon, ruft onLock-Callback auf.
 * Sichtbarkeit (nur wenn !isLocked) wird vom Parent gesteuert.
 */
export function QuickLockButton({ onLock, variant }: QuickLockButtonProps) {
  if (variant === 'fab') {
    return (
      <Button
        onClick={onLock}
        size="icon"
        className="fixed bottom-4 right-4 z-40 h-14 w-14 rounded-full shadow-lg"
        aria-label="App sperren"
      >
        <Lock className="h-6 w-6" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <Button
      onClick={onLock}
      variant="ghost"
      size="icon"
      aria-label="App sperren"
    >
      <Lock className="h-5 w-5" aria-hidden="true" />
    </Button>
  );
}
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd app && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /home/g/dev/SecuChat
git add app/src/components/custom/QuickLockButton.tsx
git commit -m "feat(lock): QuickLockButton component — FAB or icon variant

Adaptive quick-lock UI:
- fab: mobile (bottom-right, 56x56, thumb-zone)
- icon: desktop (header-style ghost button)

Both variants call onLock callback. Visibility controlled by parent.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Header — Lock-Icon zwischen Connection-Status und User-Menü

**Files:**
- Modify: `app/src/components/custom/Header.tsx`

**Purpose:** Desktop-Quick-Lock-Pfad. Lock-Icon im Header sichtbar wenn User angemeldet und nicht gesperrt. Position: zwischen Connection-Status und User-Menü-Dropdown.

- [ ] **Step 1: Add Lock-Icon-Button to Header**

In `app/src/components/custom/Header.tsx`, locate the `<div className="flex items-center gap-4">` block (around line 98) that contains Connection Status, Encryption Status, and User Menu. Inside this div, add the Lock-Button BEFORE the User Menu block:

```typescript
{/* Quick Lock */}
{user && !isLocked && (
  <Button
    variant="ghost"
    size="icon"
    onClick={lockApp}
    aria-label={t('header.lock') ?? 'Sperren'}
    className="hidden sm:inline-flex"
  >
    <Lock className="h-5 w-5" aria-hidden="true" />
  </Button>
)}
```

The `hidden sm:inline-flex` hides it on mobile (where the FAB shows) and shows it on desktop.

- [ ] **Step 2: Remove redundant Dropdown-Menu-Lock-Item**

The DropdownMenu already has a Lock-Item (around line 146). Since we now have a dedicated Quick-Lock-Button in the header, remove the duplicate from the dropdown to avoid confusion.

In `app/src/components/custom/Header.tsx`, locate:

```typescript
<DropdownMenuItem onClick={isLocked ? () => setShowUnlockDialog(true) : lockApp}>
  {isLocked ? (
    <>
      <Unlock className="h-4 w-4 mr-2" aria-hidden="true" />
      {t('header.unlock')}
    </>
  ) : (
    <>
      <Lock className="h-4 w-4 mr-2" aria-hidden="true" />
      {t('header.lock')}
    </>
  )}
</DropdownMenuItem>
```

Replace with:

```typescript
{/* Lock/Unlock moved to dedicated QuickLockButton in header — no duplicate here */}
{isLocked && (
  <DropdownMenuItem onClick={() => setShowUnlockDialog(true)}>
    <Unlock className="h-4 w-4 mr-2" aria-hidden="true" />
    {t('header.unlock')}
  </DropdownMenuItem>
)}
```

Note: the Unlock-Dropdown-Item is kept for the edge case where isLocked=true (then the QuickLockButton in header is hidden anyway, so the dropdown still offers unlock).

- [ ] **Step 3: Run TypeScript check**

Run: `cd app && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /home/g/dev/SecuChat
git add app/src/components/custom/Header.tsx
git commit -m "feat(lock): desktop lock-icon in Header, dedup dropdown lock-item

Adds dedicated Lock-Button in Header (hidden on mobile where FAB shows).
Removes redundant lock-item from User-Dropdown to avoid confusion.
Unlock-item stays in dropdown as fallback when locked.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: App.tsx — QuickLockButton-FAB integrieren

**Files:**
- Modify: `app/src/App.tsx`

**Purpose:** Mobile-Quick-Lock-Pfad. FAB fixed bottom-right, nur sichtbar wenn User angemeldet und nicht gesperrt, nur auf Mobile.

- [ ] **Step 1: Add imports**

In `app/src/App.tsx`, add to imports:

```typescript
import { QuickLockButton } from '@/components/custom/QuickLockButton';
```

Also extend the `useApp()` destructure to include `lockApp`:

```typescript
const { user, initialize, isLoading, isLocked, lockApp, unlockApp } = useApp();
```

- [ ] **Step 2: Add FAB to layout**

In `app/src/App.tsx`, locate the closing `</div>` of the main `<div className="fixed inset-0 ...">`. Add the FAB just before the closing tag (after the `<UnlockDialog>`-replacement `<FullScreenLock>` block):

```typescript
{/* Quick-Lock FAB (mobile only) */}
{user && !isLocked && (
  <div className="sm:hidden">
    <QuickLockButton variant="fab" onLock={lockApp} />
  </div>
)}
```

The `sm:hidden` hides the wrapper on desktop (where the Header-Icon is the primary path).

- [ ] **Step 3: Run TypeScript check**

Run: `cd app && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /home/g/dev/SecuChat
git add app/src/App.tsx
git commit -m "feat(lock): add mobile QuickLockButton FAB to App layout

FAB fixed bottom-right, 56x56px, only on mobile (sm:hidden wrapper).
Desktop uses the Header-Icon variant.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: MessageSkeleton Komponente + ChatView Integration

**Files:**
- Create: `app/src/components/custom/MessageSkeleton.tsx`
- Modify: `app/src/components/custom/ChatView.tsx`

**Purpose:** Skeleton-Feedback während Decrypt (D3). Mit D4 (Chat-Liste nach Unlock) aktuell selten sichtbar, aber Mechanik vorbereitet.

- [ ] **Step 1: Create MessageSkeleton.tsx**

Write `app/src/components/custom/MessageSkeleton.tsx`:

```typescript
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Skeleton-Loader für Messages während Decrypt.
 *
 * 5 alternierende Skeleton-Blöcke (Pulse-Animation) als Platzhalter.
 * Wird in ChatView gerendert wenn `decrypting && messages.length === 0`.
 */
export function MessageSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4" role="status" aria-label="Nachrichten werden entschlüsselt">
      <div className="flex justify-start">
        <Skeleton className="h-12 w-3/4" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-2/3" />
      </div>
      <div className="flex justify-start">
        <Skeleton className="h-14 w-4/5" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-1/2" />
      </div>
      <div className="flex justify-start">
        <Skeleton className="h-12 w-3/5" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Modify ChatView.tsx to use MessageSkeleton**

In `app/src/components/custom/ChatView.tsx`:

Add to imports:

```typescript
import { MessageSkeleton } from '@/components/custom/MessageSkeleton';
import { useApp } from '@/contexts/AppContext';
```

Inside the `ChatView` component, add:

```typescript
const { decrypting } = useApp();
```

Find the main render block where messages are mapped (likely `<div className="flex-1 overflow-y-auto p-4">`). Locate the messages-render area. Replace with:

```typescript
<div className="flex-1 overflow-y-auto p-4">
  {decrypting && messages.length === 0 ? (
    <MessageSkeleton />
  ) : (
    <>
      {/* existing messages render */}
    </>
  )}
</div>
```

The exact wrapping depends on the existing ChatView structure — wrap only the messages-render-area with the conditional, keep the input-area outside.

- [ ] **Step 3: Run TypeScript check**

Run: `cd app && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Manual smoke test in dev**

Run: `cd app && npm run dev`

Manually verify:
1. App lädt normal
2. Trigger Auto-Lock (oder kurzen Timeout für Test)
3. FullScreenLock erscheint (nicht Modal mit App-Hintergrund)
4. Unlock mit falscher Passphrase → Fehler bleibt sichtbar
5. Unlock mit richtiger Passphrase → Chat-Liste sichtbar (kein aktiver Chat)
6. Header zeigt Lock-Icon (Desktop) bzw. FAB unten rechts (Mobile via DevTools)
7. Klick auf Lock-Icon/FAB → sofort wieder FullScreenLock

- [ ] **Step 5: Commit**

```bash
cd /home/g/dev/SecuChat
git add app/src/components/custom/MessageSkeleton.tsx app/src/components/custom/ChatView.tsx
git commit -m "feat(lock): MessageSkeleton component + ChatView integration

Renders 5 skeleton blocks (pulse animation) when decrypting=true AND
messages empty. Currently rarely triggered due to D4 (chat list on
unlock), but mechanism prepared for future D4 relaxation.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Final Verification — Lint, Type-Check, Full Test Suite

**Files:** None modified.

- [ ] **Step 1: Run full test suite**

Run: `cd app && npm test`
Expected: ALL PASS (existing 6 test files + new `lockStateMachine.test.ts`)

- [ ] **Step 2: Run TypeScript check**

Run: `cd app && npx tsc --noEmit`
Expected: PASS (no errors)

- [ ] **Step 3: Run lint**

Run: `cd app && npm run lint`
Expected: PASS (no errors, no warnings on new code)

- [ ] **Step 4: Run production build**

Run: `cd app && npm run build`
Expected: PASS (vite build succeeds, no TS errors)

- [ ] **Step 5: Manual Android verification (optional but recommended)**

If Android-Emulator verfügbar:
1. `cd app && npm run android`
2. Verify Lock-Flow on real device
3. Take screenshot for verification

- [ ] **Step 6: Final commit if any fixups**

```bash
cd /home/g/dev/SecuChat
git status
# If clean, skip. If changes, commit:
git add -A
git commit -m "chore(lock): final lint/type-check/build fixups"
```

---

## Spec Coverage Matrix

| Spec Section | Task |
|--------------|------|
| Bug 1: Auto-Lock öffnet Dialog nicht | T1 (`shouldShowFullScreenLock`), T4 (remove `unlockDismissed`) |
| Bug 2: Messages bleiben verschlüsselt | T2 (`lockApp` clears state + `decrypting` re-decrypt effect), T8 (skeleton) |
| Lock-Screen Vollbild-Ersatz (D1) | T3 (FullScreenLock component), T4 (App.tsx integration) |
| Keine Auto-Lock-Vorwarnung (D2) | Kein Code nötig — bestehende Activity-Tracker-Implementierung bleibt |
| Re-Decrypt-Feedback (D3) | T8 (MessageSkeleton + ChatView) |
| Nach Unlock Chat-Liste (D4) | T2 (`lockApp` clearet `activeChat`) |
| Quick-Lock Mobile+Desktop (D5) | T5 (QuickLockButton), T6 (Header), T7 (App.tsx FAB) |
| Cold-Start-Fix | T2 (setIsLocked(true) in initialize path) |
| Component-Tests für Bugs (D6) | T1 (lockStateMachine.test.ts) |
| Architecture: lockApp clearet state | T2 |
| Architecture: Re-Decrypt useEffect | T2 |
| Architecture: shouldShowFullScreenLock ersetzt showUnlockDialog | T1, T4 |
| Architecture: QuickLockButton variant=icon in Header | T5, T6 |
| Architecture: QuickLockButton variant=fab in App.tsx | T5, T7 |
| Architecture: MessageSkeleton in ChatView | T8 |
| Files: `FullScreenLock.tsx` | T3 |
| Files: `QuickLockButton.tsx` | T5 |
| Files: `MessageSkeleton.tsx` | T8 |
| Files: `lockStateMachine.ts` | T1 |
| Files: `AppContext.tsx` modifications | T2 |
| Files: `App.tsx` modifications | T4, T7 |
| Files: `Header.tsx` modifications | T6 |
| Files: `ChatView.tsx` modifications | T8 |
| Files: locales modifications | T3 |
| Files: `__tests__/lockStateMachine.test.ts` | T1 |

All spec requirements covered.