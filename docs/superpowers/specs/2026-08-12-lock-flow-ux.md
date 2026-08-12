# Spec: Lock-Flow UX Refactor

**Date:** 2026-08-12
**Branch:** feat/android-port
**Author:** Brainstorming session (User + Claude)

## Problem

SecuChat sperrt sich nach Inaktivität (`autoLockTimeout`, default 5min). Aktuell hat die UX zwei nervige Bugs:

1. **Auto-Lock öffnet Unlock-Dialog nicht automatisch** — User muss App neu starten, weil `unlockDismissed` nach erstem Unlock nie zurückgesetzt wird.
2. **Nachrichten bleiben verschlüsselt nach Unlock** — Im aktiven Chat zeigen Messages `[Verschlüsselt]`, bis User den Chat wechselt und zurückkommt. `loadMessages` läuft nur bei `activeChat`-Wechsel.

Zusätzlich: das aktuelle Lock-UI (Modal mit sichtbarem Hintergrund) ist Privacy-zweifelhaft — User sieht Chats-Struktur, wenn auch ohne Inhalt.

## Goals

- Auto-Lock-Dialog öffnet sich zuverlässig jedes Mal, wenn App in Lock-State ist
- Nach erfolgreichem Unlock sind Messages im aktiven Chat sofort entschlüsselt sichtbar
- Lock-State zeigt komplette UI nicht — Privacy-First
- Quick-Lock mit einem Tap/Finger-Tap auf Mobile, einem Klick im Header auf Desktop
- Keine Vorwarnung beim Auto-Lock — Activity-Tracker reicht; User behält Workflow

## Non-Goals

- Onboarding-UX-Verbesserungen (eigenes Backlog)
- Mobile-Tiefpass (Back-Button, Touch-Target-Sweep, Screenshot-Banner)
- Empty-States, Loading-Skeletons für Chat-Liste, Microcopy-Polish (eigenes Backlog)
- Multi-Window-Lock-Synchronisation (Electron Desktop hat aktuell kein Multi-Window)

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Lock-Screen = Vollbild-Ersatz** (kein App-Untergrund sichtbar) | Maximaler Privacy-Schutz, eindeutiger Lock-Status, kein "ist das jetzt gesperrt oder nicht?"-Zweifel |
| D2 | **Keine Auto-Lock-Vorwarnung** | Activity-Tracker resettet Timer bei jeder User-Aktion. Lock kommt nur bei echter Inaktivität, also nie mitten im Tippen |
| D3 | **Re-Decrypt-Feedback = Skeleton → Inhalt** | ~500ms sichtbarer Lade-Zustand, signalisiert "wird entschlüsselt" ohne Drama. **Hinweis:** In Kombination mit D4 (Chat-Liste nach Unlock) wird Skeleton nie gezeigt, weil kein aktiver Chat zum Re-Decrypten existiert. D3 ist "vorbereitet für den Fall, dass D4 je gelockert wird" |
| D4 | **Nach Unlock = Chat-Liste (kein aktiver Chat)** | Privacy-First: weniger Kontext-Leak. User wählt bewusst, welchen Chat sie öffnen |
| D5 | **Quick-Lock = Mobile FAB + Desktop Header-Icon** | 1-Tap auf Mobile (Daumen-Zone), unauffällig auf Desktop. Beide Pfade teilen `onLock`-Callback |
| D6 | **Tests = Component-Tests für die 2 Bugs** | Pragmatisch. Keine breite E2E-Coverage |

## Architecture

### Root Causes

**Bug 1 (Auto-Lock öffnet Dialog nicht):**
- `app/src/App.tsx:51` setzt `setUnlockDismissed(true)` nach erfolgreichem Unlock
- Wird nie zurückgesetzt, wenn `lockApp()` später feuert
- Sobald dismissed: Dialog öffnet nicht mehr, bis App-Restart

**Bug 2 (Messages bleiben verschlüsselt):**
- `app/src/contexts/AppContext.tsx:1242-1251` triggert `loadMessages` nur bei `activeChat`-Wechsel (via `lastActiveChatIdRef`-Vergleich)
- Nach Unlock ändert sich `activeChat` nicht → kein Re-Decrypt

### Komponenten

#### Neu: `FullScreenLock` (in `app/src/components/custom/FullScreenLock.tsx`)

Vollbild-Ersatz für `UnlockDialog`. Layout: zentriert, Logo oben, 🔒-Icon groß, Passphrase-Input, Unlock-Button, Fehlertext darunter.

```typescript
interface FullScreenLockProps {
  onUnlock: (passphrase: string) => Promise<boolean>;
  error?: string;
}
```

Mounted in `App.tsx` wenn `isLocked === true`. Ersetzt den bestehenden `UnlockDialog`-Pfad.

#### Neu: `QuickLockButton` (in `app/src/components/custom/QuickLockButton.tsx`)

```typescript
interface QuickLockButtonProps {
  onLock: () => void;
}
```

- **Mobile (Viewport ≤ 640px):** Fixed FAB bottom-right (56×56px, 16px Inset), `z-40` unter Header
- **Desktop (Viewport > 640px):** Icon-Button im `Header` neben Connection-Status
- Sichtbar nur wenn `!isLocked && user`
- Icon: Lucide `Lock` (solid)

#### Neu: `MessageSkeleton` (in `app/src/components/custom/ChatView.tsx`)

Rendert 5 Skeleton-Blöcke statt Messages wenn `decrypting=true`. Graue Balken mit Pulse-Animation, ~80% width alternierend.

#### Modifikation: `AppContext.tsx`

**Neuer State:**
```typescript
const [decrypting, setDecrypting] = useState(false);
```

**`lockApp` Änderungen:**
```typescript
const lockApp = useCallback(() => {
  setIsLocked(true);
  setActiveChatState(null);     // NEU: clears active chat reference
  setMessages([]);              // NEU: clears in-memory messages
  cryptoService.clearKeyPair();
  storageService.clearEncryptionPassphrase();
  setEncryptionState('unencrypted');
}, []);
```

**Neuer `useEffect` für Re-Decrypt:**
```typescript
useEffect(() => {
  // Re-decrypt active chat when unlock succeeds
  if (!isLocked && user && activeChatRef.current && cryptoService.hasKeyPair()) {
    setDecrypting(true);
    void loadMessages(activeChatRef.current.id).finally(() => {
      // Skeleton visible ~500ms minimum for UX feedback
      setTimeout(() => setDecrypting(false), 500);
    });
  }
}, [isLocked, user, loadMessages]);
```

**`decrypting` exposed via Context:**
```typescript
const value = {
  // ... existing
  decrypting,
};
```

#### Modifikation: `App.tsx`

**Entfernt:** `unlockDismissed` State komplett (Bug 1 Fix). State ist redundant mit `isLocked`.

**Ersetzt:** `UnlockDialog` durch `FullScreenLock`.

**Reset beim Lock:** `lockApp` triggert automatisch Re-Mount des `FullScreenLock`.

```typescript
// Alt:
const [unlockDismissed, setUnlockDismissed] = useState(false);
const showUnlockDialog = isLocked && !unlockDismissed;

// Neu:
const showFullScreenLock = isLocked;
```

```typescript
const handleUnlock = async (passphrase: string): Promise<boolean> => {
  return await unlockApp(passphrase);
  // Kein setUnlockDismissed mehr nötig
};
```

**Quick-Lock-Button:**
- Mobile: `<QuickLockButton variant="fab" onLock={lockApp} />` in der Layout-Root
- Desktop: Integration in `Header.tsx` als zusätzlicher Icon-Button

#### Modifikation: `Header.tsx`

Neuer Icon-Button "Sperren" zwischen Connection-Status und Settings. Ruft `lockApp()` auf. Identisches Styling wie Settings-Button.

#### Modifikation: `ChatView.tsx`

Skeleton-Wrapper:
```typescript
{decrypting ? <MessageSkeleton /> : messages.map(...)}
```

Skeleton wird nur gerendert wenn `messages.length === 0` UND `decrypting === true` — sonst zeigt normale Liste. Damit verhindern wir Skeleton-Flash bei leerem Chat.

### Daten-Flow

```
[Idle-Timer expires] (5min ohne mouse/key/touch/click)
  └→ lockApp()
       ├─ setIsLocked(true)
       ├─ setActiveChat(null)         ← NEU
       ├─ setMessages([])              ← NEU
       ├─ cryptoService.clearKeyPair()
       └─ storageService.clearEncryptionPassphrase()
            ↓
       isLocked=true → App.tsx rendert <FullScreenLock />
            ↓ (User tippt Passphrase)
[FullScreenLock.onUnlock(pw)]
  └→ unlockApp(pw)
       ├─ cryptoService.importKeyPair(...)
       ├─ setUser(decryptedUser)
       ├─ setIsLocked(false)
       └─ setDecrypting(true)
            ↓
       useEffect [isLocked, user] fires
       └→ Guard: `if (activeChatRef.current && cryptoService.hasKeyPair())`
            └→ activeChatRef.current ist null (lockApp hat activeChat geclearet, per D4)
            └→ useEffect no-op, bleibt in Chat-Liste
       └→ setDecrypting(false) nach 500ms (falls je gesetzt)

[isLocked=false, decrypting=false, activeChat=null]
  └→ ChatView zeigt MobileChatList / Sidebar als Default (D4)
  └→ User klickt Chat → setActiveChat → loadMessages normal
```

### Cold-Start-Fix

Bug: Bei App-Cold-Start wird `isLocked` mit `false` initialisiert, auch wenn Storage verschlüsselt ist. User sieht App ungesperrt, bis `initialize()` läuft.

**Fix:** `AppContext.initialize()` setzt `setIsLocked(true)` wenn `keysEncrypted=true` UND kein Test-Mode-Auto-Unlock (bestehender Pfad Zeile ~325-327). Synchron mit dem bestehenden `needsUnlock=true`-Logik.

```typescript
// In initialize(), nach der keysEncrypted-Prüfung:
if (keysEncrypted && !testPassphrase) {
  needsUnlock = true;
  setIsLocked(true);  // NEU: explizit setzen, nicht nur needsUnlock
}
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Wrong passphrase | Inline error below input: "Falsche Passphrase". Input retains value. No auto-clear |
| Wrong passphrase 5x in 60s | Soft rate-limit: 5s delay between attempts. No hard-lock |
| Single message decrypt fails | Message stays as `[Entschlüsselung fehlgeschlagen]` (existing behavior) |
| `loadMessages` throws | ErrorBoundary catches, chat list stays open, toast "Chat konnte nicht geladen werden" |
| `lockApp` during decrypt | Race-safe: `setMessages([])` is synchronous, decrypt promise resolves against stale state (no setState on unmounted). Cleanup via useEffect |
| Background → Foreground (Mobile) | `visibilitychange` does not reset Activity-Timer explicitly. Existing touchstart listener handles foreground touch |

## Edge Cases

- **Test-Mode Auto-Unlock:** Existing path in `AppContext.initialize()` (~line 258) stays untouched. `FullScreenLock` is never shown in test mode. ✓ Compatible
- **AutoLock disabled:** Activity-Tracker runs but no lock fires. No UI noise. Existing settings logic unchanged
- **`connectionState='locked'`:** Existing logic in `AppContext.tsx:821` stays. Connection-Badge shows "🔒 Gesperrt" in Header when locked

## Out of Scope (Separate Backlog)

- Onboarding-UX-Verbesserungen
- Mobile-Tiefpass: Back-Button-Verhalten, Touch-Target-Sweep, Screenshot-Banner-Verbesserung
- Empty-States, Loading-Skeletons für Chat-Liste, Microcopy-Polish DE/EN
- Multi-Window-Lock-Synchronisation

## Tests

```
src/__tests__/AppLockFlow.test.tsx
  ├─ 'shows FullScreenLock when isLocked=true'           ← P1 Fix
  ├─ 'FullScreenLock unmounts on successful unlock'      ← P1 Fix
  ├─ 'lockApp() clears activeChat and messages'          ← P2 Fix
  ├─ 'unlockApp() triggers re-decrypt of active chat'    ← P2 Fix
  ├─ 'AppContext initializes locked when keysEncrypted and no test-mode auto-unlock'  ← Cold-Start Fix
  └─ 'connectionState is "locked" when isLocked=true'

src/__tests__/QuickLockButton.test.tsx
  ├─ 'renders FAB on mobile viewport'
  ├─ 'renders Header icon on desktop viewport'
  └─ 'calls onLock on click'

src/__tests__/ChatView.test.tsx
  └─ 'shows skeleton when decrypting=true and messages empty'
```

Test-Framework: bestehende Vitest + React Testing Library Setup (siehe `app/src/__tests__/backup.test.ts` als Vorlage).

## Dependencies

- `lucide-react` (Lock/LockOpen Icons) — bereits in use ✓
- shadcn Skeleton-Primitive — via `npx shadcn@latest add skeleton` (falls nicht vorhanden)
- Keine neuen npm-Packages

## Files Modified

| File | Change |
|------|--------|
| `app/src/components/custom/FullScreenLock.tsx` | NEW — Vollbild-Lock-Ersatz |
| `app/src/components/custom/QuickLockButton.tsx` | NEW — FAB + Header-Icon |
| `app/src/components/custom/UnlockDialog.tsx` | DEPRECATED — kann bleiben, wird nicht mehr gemounted |
| `app/src/App.tsx` | MODIFIED — unlockDismissed entfernt, FullScreenLock statt UnlockDialog |
| `app/src/components/custom/Header.tsx` | MODIFIED — Lock-Icon neben Settings |
| `app/src/components/custom/ChatView.tsx` | MODIFIED — Skeleton-Rendering |
| `app/src/contexts/AppContext.tsx` | MODIFIED — decrypting state, lockApp clears state, new useEffect, cold-start fix |
| `app/src/__tests__/AppLockFlow.test.tsx` | NEW |
| `app/src/__tests__/QuickLockButton.test.tsx` | NEW |
| `app/src/__tests__/ChatView.test.tsx` | NEW |