/**
 * Status Messages Service — Read Receipts & Typing Indicators
 * 
 * Handles typing indicators with debouncing and read/delivered receipts
 * over I2P P2P connections.
 */

import { i2pService } from './i2p';
import { logger } from '@/utils/logger';

export type StatusMessageType = 'typing' | 'read' | 'delivered';

export interface TypingStatus {
  type: 'status';
  statusType: 'typing';
  isTyping: boolean;
  timestamp: number;
  senderId: string;
}

export interface ReadReceipt {
  type: 'status';
  statusType: 'read';
  messageId: string;
  readAt: number;
  senderId: string;
}

export interface DeliveredReceipt {
  type: 'status';
  statusType: 'delivered';
  messageId: string;
  deliveredAt: number;
  senderId: string;
}

export type StatusMessage = TypingStatus | ReadReceipt | DeliveredReceipt;

export type TypingHandler = (contactI2pAddress: string, isTyping: boolean) => void;
export type ReceiptHandler = (contactI2pAddress: string, messageId: string, status: 'delivered' | 'read') => void;

class StatusMessenger {
  private typingHandlers: TypingHandler[] = [];
  private receiptHandlers: ReceiptHandler[] = [];
  private typingTimers: Map<string, NodeJS.Timeout> = new Map();
  private peerTypingTimers: Map<string, NodeJS.Timeout> = new Map();
  private userId: string = '';
  private initialized = false;

  /**
   * Initialize the status messenger with the current user ID
   */
  initialize(userId: string): void {
    if (this.initialized) return;
    this.userId = userId;
    this.initialized = true;

    // Listen for incoming status messages via I2P
    i2pService.onMessage((from: string, data: unknown) => {
      const msg = data as Record<string, unknown>;
      if (msg?.type === 'status') {
        this.handleIncomingStatus(from, msg as unknown as StatusMessage);
      }
    });

    logger.log('[StatusMessenger] Initialized');
  }

  /**
   * Handle incoming status messages
   */
  private handleIncomingStatus(from: string, status: StatusMessage): void {
    switch (status.statusType) {
      case 'typing': {
        const typingMsg = status as TypingStatus;
        this.typingHandlers.forEach(h => h(from, typingMsg.isTyping));

        // Auto-clear typing after 5s if no update received
        const existingTimer = this.peerTypingTimers.get(from);
        if (existingTimer) clearTimeout(existingTimer);

        if (typingMsg.isTyping) {
          const timer = setTimeout(() => {
            this.typingHandlers.forEach(h => h(from, false));
            this.peerTypingTimers.delete(from);
          }, 5000);
          this.peerTypingTimers.set(from, timer);
        } else {
          this.peerTypingTimers.delete(from);
        }
        break;
      }
      case 'read': {
        const readMsg = status as ReadReceipt;
        this.receiptHandlers.forEach(h => h(from, readMsg.messageId, 'read'));
        break;
      }
      case 'delivered': {
        const deliveredMsg = status as DeliveredReceipt;
        this.receiptHandlers.forEach(h => h(from, deliveredMsg.messageId, 'delivered'));
        break;
      }
    }
  }

  /**
   * Send typing indicator to a contact (with debouncing)
   */
  sendTyping(contactI2pAddress: string): void {
    if (!contactI2pAddress || !i2pService.isReady()) return;

    const existing = this.typingTimers.get(contactI2pAddress);
    
    // If we already sent typing recently, just reset the stop timer
    if (existing) {
      clearTimeout(existing);
    } else {
      // Send "is typing" immediately
      this.sendStatus(contactI2pAddress, {
        type: 'status',
        statusType: 'typing',
        isTyping: true,
        timestamp: Date.now(),
        senderId: this.userId,
      });
    }

    // After 3s of inactivity, send "stopped typing"
    const timer = setTimeout(() => {
      this.sendStatus(contactI2pAddress, {
        type: 'status',
        statusType: 'typing',
        isTyping: false,
        timestamp: Date.now(),
        senderId: this.userId,
      });
      this.typingTimers.delete(contactI2pAddress);
    }, 3000);

    this.typingTimers.set(contactI2pAddress, timer);
  }

  /**
   * Stop typing indicator immediately (e.g. on message send)
   */
  stopTyping(contactI2pAddress: string): void {
    const existing = this.typingTimers.get(contactI2pAddress);
    if (existing) {
      clearTimeout(existing);
      this.typingTimers.delete(contactI2pAddress);
      this.sendStatus(contactI2pAddress, {
        type: 'status',
        statusType: 'typing',
        isTyping: false,
        timestamp: Date.now(),
        senderId: this.userId,
      });
    }
  }

  /**
   * Send a read receipt for a message
   */
  sendReadReceipt(contactI2pAddress: string, messageId: string): void {
    if (!contactI2pAddress || !i2pService.isReady()) return;

    this.sendStatus(contactI2pAddress, {
      type: 'status',
      statusType: 'read',
      messageId,
      readAt: Date.now(),
      senderId: this.userId,
    });
  }

  /**
   * Send a delivered receipt for a message
   */
  sendDeliveredReceipt(contactI2pAddress: string, messageId: string): void {
    if (!contactI2pAddress || !i2pService.isReady()) return;

    this.sendStatus(contactI2pAddress, {
      type: 'status',
      statusType: 'delivered',
      messageId,
      deliveredAt: Date.now(),
      senderId: this.userId,
    });
  }

  /**
   * Register typing status handler
   */
  onTyping(handler: TypingHandler): void {
    this.typingHandlers.push(handler);
  }

  offTyping(handler: TypingHandler): void {
    this.typingHandlers = this.typingHandlers.filter(h => h !== handler);
  }

  /**
   * Register receipt handler
   */
  onReceipt(handler: ReceiptHandler): void {
    this.receiptHandlers.push(handler);
  }

  offReceipt(handler: ReceiptHandler): void {
    this.receiptHandlers = this.receiptHandlers.filter(h => h !== handler);
  }

  /**
   * Send a status message via I2P
   */
  private async sendStatus(contactI2pAddress: string, status: StatusMessage): Promise<void> {
    try {
      await i2pService.sendMessage(contactI2pAddress, status);
    } catch (error) {
      logger.warn('[StatusMessenger] Failed to send status:', error);
    }
  }

  /**
   * Cleanup
   */
  destroy(): void {
    this.typingTimers.forEach(t => clearTimeout(t));
    this.typingTimers.clear();
    this.peerTypingTimers.forEach(t => clearTimeout(t));
    this.peerTypingTimers.clear();
    this.typingHandlers = [];
    this.receiptHandlers = [];
    this.initialized = false;
  }
}

export const statusMessenger = new StatusMessenger();
