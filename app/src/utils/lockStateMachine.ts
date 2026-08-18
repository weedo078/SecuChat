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
