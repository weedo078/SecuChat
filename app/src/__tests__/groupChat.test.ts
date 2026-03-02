/**
 * Tests for Group Chat Service
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/i2p', () => ({
  i2pService: {
    onMessage: vi.fn(),
    offMessage: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(true),
    isReady: vi.fn().mockReturnValue(true),
  },
}));

// Mock localStorage
const storage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, val: string) => { storage[key] = val; },
  removeItem: (key: string) => { delete storage[key]; },
});

// Mock crypto
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${Math.random().toString(36).slice(2, 10)}`,
  subtle: {
    generateKey: vi.fn().mockResolvedValue({}),
    exportKey: vi.fn().mockResolvedValue(new ArrayBuffer(32)),
    importKey: vi.fn().mockResolvedValue({}),
    encrypt: vi.fn().mockResolvedValue(new ArrayBuffer(16)),
    decrypt: vi.fn().mockResolvedValue(new TextEncoder().encode('decrypted')),
  },
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
    return arr;
  },
});

import { groupChatManager } from '../services/groupChat';

describe('GroupChatManager', () => {
  beforeEach(() => {
    groupChatManager.destroy();
    Object.keys(storage).forEach(k => delete storage[k]);
    groupChatManager.initialize('self-id', 'TestUser', 'self.b32.i2p');
  });

  describe('createGroup', () => {
    it('should create a group with members', async () => {
      const group = await groupChatManager.createGroup('Test Group', [
        {
          contactId: 'contact-1',
          name: 'Alice',
          i2pAddress: 'alice.b32.i2p',
          publicKey: 'key1',
          role: 'member',
          joinedAt: new Date().toISOString(),
        },
      ]);

      expect(group.name).toBe('Test Group');
      expect(group.members).toHaveLength(2); // self + alice
      expect(group.createdBy).toBe('self-id');
    });

    it('should enforce max 10 members', async () => {
      const members = Array.from({ length: 10 }, (_, i) => ({
        contactId: `contact-${i}`,
        name: `User${i}`,
        i2pAddress: `user${i}.b32.i2p`,
        publicKey: `key${i}`,
        role: 'member' as const,
        joinedAt: new Date().toISOString(),
      }));

      await expect(
        groupChatManager.createGroup('Big Group', members)
      ).rejects.toThrow('Maximum 10');
    });
  });

  describe('getGroups', () => {
    it('should return all groups', async () => {
      await groupChatManager.createGroup('G1', []);
      await groupChatManager.createGroup('G2', []);
      expect(groupChatManager.getGroups()).toHaveLength(2);
    });
  });

  describe('leaveGroup', () => {
    it('should remove group after leaving', async () => {
      const group = await groupChatManager.createGroup('LeavableGroup', []);
      expect(groupChatManager.getGroup(group.groupId)).toBeDefined();
      await groupChatManager.leaveGroup(group.groupId);
      expect(groupChatManager.getGroup(group.groupId)).toBeUndefined();
    });
  });

  describe('message handlers', () => {
    it('should register and unregister handlers', () => {
      const handler = vi.fn();
      groupChatManager.onMessage(handler);
      groupChatManager.offMessage(handler);
    });
  });
});
