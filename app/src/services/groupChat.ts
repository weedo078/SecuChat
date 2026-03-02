/**
 * Group Chat Service — Mesh-based group messaging (max 10 members)
 * 
 * Symmetric AES-256 group key, fan-out to all members,
 * admin functions, invite protocol.
 */

import { i2pService } from './i2p';
import { logger } from '@/utils/logger';

const MAX_GROUP_SIZE = 10;

export interface GroupMember {
  contactId: string;
  name: string;
  i2pAddress: string;
  publicKey: string;
  role: 'admin' | 'member';
  joinedAt: string;
}

export interface Group {
  groupId: string;
  name: string;
  members: GroupMember[];
  symmetricKey: string; // Base64 AES-256 key
  createdAt: string;
  createdBy: string; // contactId of creator
}

export interface GroupMessage {
  type: 'group-message';
  groupId: string;
  messageId: string;
  senderId: string;
  senderName: string;
  encryptedContent: string; // AES encrypted
  timestamp: number;
}

export interface GroupInvite {
  type: 'group-invite';
  groupId: string;
  groupName: string;
  symmetricKey: string; // AES key encrypted with recipient's PGP key
  members: Array<{ name: string; i2pAddress: string; contactId: string }>;
  invitedBy: string;
  invitedByName: string;
}

export interface GroupSystemMessage {
  type: 'group-system';
  groupId: string;
  action: 'member-added' | 'member-removed' | 'member-left' | 'group-created';
  targetName: string;
  actorName: string;
  timestamp: number;
}

export type GroupMessageHandler = (groupId: string, message: GroupMessage | GroupSystemMessage) => void;
export type GroupInviteHandler = (invite: GroupInvite) => Promise<boolean>;

class GroupChatManager {
  private groups: Map<string, Group> = new Map();
  private messageHandlers: GroupMessageHandler[] = [];
  private inviteHandlers: GroupInviteHandler[] = [];
  private selfId: string = '';
  private selfName: string = '';
  private selfI2pAddress: string = '';
  private initialized = false;

  initialize(selfId: string, selfName: string, selfI2pAddress: string): void {
    if (this.initialized) return;
    this.selfId = selfId;
    this.selfName = selfName;
    this.selfI2pAddress = selfI2pAddress;
    this.initialized = true;

    i2pService.onMessage((from: string, data: unknown) => {
      const msg = data as Record<string, unknown>;
      if (!msg?.type) return;

      switch (msg.type) {
        case 'group-message':
          this.handleGroupMessage(from, msg as unknown as GroupMessage);
          break;
        case 'group-invite':
          this.handleGroupInvite(from, msg as unknown as GroupInvite);
          break;
        case 'group-system':
          this.handleSystemMessage(msg as unknown as GroupSystemMessage);
          break;
      }
    });

    // Restore groups from localStorage
    this.loadGroups();
    logger.log('[GroupChat] Initialized');
  }

  /**
   * Create a new group
   */
  async createGroup(name: string, initialMembers: GroupMember[]): Promise<Group> {
    if (initialMembers.length + 1 > MAX_GROUP_SIZE) {
      throw new Error(`Maximum ${MAX_GROUP_SIZE} Mitglieder pro Gruppe`);
    }

    const groupId = crypto.randomUUID();
    const symmetricKey = await this.generateSymmetricKey();

    const selfMember: GroupMember = {
      contactId: this.selfId,
      name: this.selfName,
      i2pAddress: this.selfI2pAddress,
      publicKey: '',
      role: 'admin',
      joinedAt: new Date().toISOString(),
    };

    const group: Group = {
      groupId,
      name,
      members: [selfMember, ...initialMembers.map(m => ({
        ...m,
        role: 'member' as const,
        joinedAt: new Date().toISOString(),
      }))],
      symmetricKey,
      createdAt: new Date().toISOString(),
      createdBy: this.selfId,
    };

    this.groups.set(groupId, group);
    this.saveGroups();

    // Send invites to all members
    for (const member of initialMembers) {
      await this.sendInvite(member, group);
    }

    // Announce group creation
    const sysMsg: GroupSystemMessage = {
      type: 'group-system',
      groupId,
      action: 'group-created',
      targetName: name,
      actorName: this.selfName,
      timestamp: Date.now(),
    };
    this.messageHandlers.forEach(h => h(groupId, sysMsg));

    return group;
  }

  /**
   * Send a message to a group
   */
  async sendGroupMessage(groupId: string, content: string): Promise<GroupMessage> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('Gruppe nicht gefunden');

    const encryptedContent = await this.encryptAES(content, group.symmetricKey);

    const message: GroupMessage = {
      type: 'group-message',
      groupId,
      messageId: crypto.randomUUID(),
      senderId: this.selfId,
      senderName: this.selfName,
      encryptedContent,
      timestamp: Date.now(),
    };

    // Fan-out to all members
    const otherMembers = group.members.filter(m => m.contactId !== this.selfId);
    const results = await Promise.allSettled(
      otherMembers.map(m => i2pService.sendMessage(m.i2pAddress, message))
    );

    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
      logger.warn(`[GroupChat] Failed to deliver to ${failed}/${otherMembers.length} members`);
    }

    return message;
  }

  /**
   * Add a member (admin only)
   */
  async addMember(groupId: string, newMember: GroupMember): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('Gruppe nicht gefunden');

    const selfMember = group.members.find(m => m.contactId === this.selfId);
    if (selfMember?.role !== 'admin') throw new Error('Nur Admins können Mitglieder hinzufügen');

    if (group.members.length >= MAX_GROUP_SIZE) {
      throw new Error(`Maximum ${MAX_GROUP_SIZE} Mitglieder erreicht`);
    }

    if (group.members.some(m => m.contactId === newMember.contactId)) {
      throw new Error('Kontakt ist bereits Mitglied');
    }

    group.members.push({
      ...newMember,
      role: 'member',
      joinedAt: new Date().toISOString(),
    });
    this.saveGroups();

    // Send invite to new member
    await this.sendInvite(newMember, group);

    // Notify existing members
    const sysMsg: GroupSystemMessage = {
      type: 'group-system',
      groupId,
      action: 'member-added',
      targetName: newMember.name,
      actorName: this.selfName,
      timestamp: Date.now(),
    };

    await this.fanOutSystemMessage(group, sysMsg);
    this.messageHandlers.forEach(h => h(groupId, sysMsg));
  }

  /**
   * Remove a member (admin only)
   */
  async removeMember(groupId: string, contactId: string): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('Gruppe nicht gefunden');

    const selfMember = group.members.find(m => m.contactId === this.selfId);
    if (selfMember?.role !== 'admin') throw new Error('Nur Admins können Mitglieder entfernen');

    const member = group.members.find(m => m.contactId === contactId);
    if (!member) throw new Error('Mitglied nicht gefunden');

    group.members = group.members.filter(m => m.contactId !== contactId);
    this.saveGroups();

    // Notify remaining members
    const sysMsg: GroupSystemMessage = {
      type: 'group-system',
      groupId,
      action: 'member-removed',
      targetName: member.name,
      actorName: this.selfName,
      timestamp: Date.now(),
    };

    await this.fanOutSystemMessage(group, sysMsg);
    this.messageHandlers.forEach(h => h(groupId, sysMsg));
  }

  /**
   * Leave a group
   */
  async leaveGroup(groupId: string): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('Gruppe nicht gefunden');

    const sysMsg: GroupSystemMessage = {
      type: 'group-system',
      groupId,
      action: 'member-left',
      targetName: this.selfName,
      actorName: this.selfName,
      timestamp: Date.now(),
    };

    await this.fanOutSystemMessage(group, sysMsg);

    this.groups.delete(groupId);
    this.saveGroups();
  }

  /**
   * Get all groups
   */
  getGroups(): Group[] {
    return Array.from(this.groups.values());
  }

  /**
   * Get a specific group
   */
  getGroup(groupId: string): Group | undefined {
    return this.groups.get(groupId);
  }

  /**
   * Decrypt a group message
   */
  async decryptGroupMessage(groupId: string, encryptedContent: string): Promise<string> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error('Gruppe nicht gefunden');

    return this.decryptAES(encryptedContent, group.symmetricKey);
  }

  // === Private methods ===

  private async sendInvite(member: GroupMember, group: Group): Promise<void> {
    const invite: GroupInvite = {
      type: 'group-invite',
      groupId: group.groupId,
      groupName: group.name,
      symmetricKey: group.symmetricKey, // In production: encrypt with member's PGP key
      members: group.members.map(m => ({
        name: m.name,
        i2pAddress: m.i2pAddress,
        contactId: m.contactId,
      })),
      invitedBy: this.selfId,
      invitedByName: this.selfName,
    };

    await i2pService.sendMessage(member.i2pAddress, invite);
  }

  private async handleGroupMessage(from: string, msg: GroupMessage): Promise<void> {
    const group = this.groups.get(msg.groupId);
    if (!group) {
      logger.warn('[GroupChat] Message for unknown group:', msg.groupId);
      return;
    }

    this.messageHandlers.forEach(h => h(msg.groupId, msg));
  }

  private async handleGroupInvite(_from: string, invite: GroupInvite): Promise<void> {
    let accepted = false;
    for (const handler of this.inviteHandlers) {
      accepted = await handler(invite);
      if (accepted) break;
    }

    if (accepted) {
      const group: Group = {
        groupId: invite.groupId,
        name: invite.groupName,
        members: invite.members.map(m => ({
          ...m,
          publicKey: '',
          role: m.contactId === invite.invitedBy ? 'admin' as const : 'member' as const,
          joinedAt: new Date().toISOString(),
        })),
        symmetricKey: invite.symmetricKey,
        createdAt: new Date().toISOString(),
        createdBy: invite.invitedBy,
      };

      // Add self as member
      if (!group.members.some(m => m.contactId === this.selfId)) {
        group.members.push({
          contactId: this.selfId,
          name: this.selfName,
          i2pAddress: this.selfI2pAddress,
          publicKey: '',
          role: 'member',
          joinedAt: new Date().toISOString(),
        });
      }

      this.groups.set(invite.groupId, group);
      this.saveGroups();

      const sysMsg: GroupSystemMessage = {
        type: 'group-system',
        groupId: invite.groupId,
        action: 'group-created',
        targetName: invite.groupName,
        actorName: invite.invitedByName,
        timestamp: Date.now(),
      };
      this.messageHandlers.forEach(h => h(invite.groupId, sysMsg));
    }
  }

  private handleSystemMessage(msg: GroupSystemMessage): void {
    const group = this.groups.get(msg.groupId);
    if (!group) return;

    // Update member list based on system message
    if (msg.action === 'member-left' || msg.action === 'member-removed') {
      group.members = group.members.filter(m => m.name !== msg.targetName);
      this.saveGroups();
    }

    this.messageHandlers.forEach(h => h(msg.groupId, msg));
  }

  private async fanOutSystemMessage(group: Group, msg: GroupSystemMessage): Promise<void> {
    const otherMembers = group.members.filter(m => m.contactId !== this.selfId);
    await Promise.allSettled(
      otherMembers.map(m => i2pService.sendMessage(m.i2pAddress, msg))
    );
  }

  private async generateSymmetricKey(): Promise<string> {
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    const exported = await crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
  }

  private async encryptAES(plaintext: string, keyBase64: string): Promise<string> {
    const keyBytes = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plaintext)
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return btoa(String.fromCharCode(...combined));
  }

  private async decryptAES(cipherBase64: string, keyBase64: string): Promise<string> {
    const cipherBytes = Uint8Array.from(atob(cipherBase64), c => c.charCodeAt(0));
    const keyBytes = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    const iv = cipherBytes.slice(0, 12);
    const data = cipherBytes.slice(12);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );
    return new TextDecoder().decode(decrypted);
  }

  private loadGroups(): void {
    try {
      const raw = localStorage.getItem('securechat_groups');
      if (raw) {
        const groups: Group[] = JSON.parse(raw);
        groups.forEach(g => this.groups.set(g.groupId, g));
      }
    } catch {
      logger.warn('[GroupChat] Failed to load groups from storage');
    }
  }

  private saveGroups(): void {
    try {
      const groups = Array.from(this.groups.values());
      localStorage.setItem('securechat_groups', JSON.stringify(groups));
    } catch {
      logger.warn('[GroupChat] Failed to save groups to storage');
    }
  }

  onMessage(handler: GroupMessageHandler): void {
    this.messageHandlers.push(handler);
  }

  offMessage(handler: GroupMessageHandler): void {
    this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
  }

  onInvite(handler: GroupInviteHandler): void {
    this.inviteHandlers.push(handler);
  }

  offInvite(handler: GroupInviteHandler): void {
    this.inviteHandlers = this.inviteHandlers.filter(h => h !== handler);
  }

  destroy(): void {
    this.messageHandlers = [];
    this.inviteHandlers = [];
    this.groups.clear();
    this.initialized = false;
  }
}

export const groupChatManager = new GroupChatManager();
