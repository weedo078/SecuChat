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
