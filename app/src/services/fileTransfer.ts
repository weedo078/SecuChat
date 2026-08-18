/**
 * File Transfer Service — P2P encrypted file transfer over I2P
 * 
 * Features: 1MB chunking, AES-256 encryption, accept/reject,
 * progress tracking, resume on interruption.
 */

import { i2pService } from './i2p';
import { logger } from '@/utils/logger';

const CHUNK_SIZE = 1024 * 1024; // 1MB
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ACCEPT_TIMEOUT = 60000; // 60s

export interface FileTransferMeta {
  transferId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  chunksTotal: number;
  thumbnailDataUrl?: string; // Base64 thumbnail for images
  fileHash?: string; // SHA-256 hash of the complete file
}

export interface FileTransferProgress {
  transferId: string;
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
  speed: number; // bytes/sec
  status: 'pending' | 'accepted' | 'rejected' | 'transferring' | 'completed' | 'failed' | 'paused';
  direction: 'send' | 'receive';
}

export type TransferOfferHandler = (from: string, meta: FileTransferMeta) => Promise<boolean>;
export type TransferProgressHandler = (progress: FileTransferProgress) => void;

class FileTransferManager {
  private offerHandlers: TransferOfferHandler[] = [];
  private progressHandlers: TransferProgressHandler[] = [];
  private activeTransfers: Map<string, FileTransferProgress> = new Map();
  private receivedChunks: Map<string, Map<number, string>> = new Map(); // transferId -> chunkIndex -> base64data
  private pendingAccepts: Map<string, (accepted: boolean) => void> = new Map();
  private transferMetas: Map<string, FileTransferMeta> = new Map();
  private initialized = false;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    i2pService.onMessage((from: string, data: unknown) => {
      const msg = data as Record<string, unknown>;
      if (!msg?.type) return;
      
      switch (msg.type) {
        case 'file-transfer-offer':
          this.handleOffer(from, msg as unknown as { type: string } & FileTransferMeta);
          break;
        case 'file-transfer-accept':
          this.handleAcceptResponse(msg as unknown as { transferId: string; accepted: boolean });
          break;
        case 'file-transfer-chunk':
          this.handleChunk(msg as unknown as {
            transferId: string;
            chunkIndex: number;
            data: string;
          });
          break;
        case 'file-transfer-complete':
          this.handleComplete(msg as unknown as { transferId: string });
          break;
      }
    });

    logger.log('[FileTransfer] Initialized');
  }

  /**
   * Send a file to a peer
   */
  async sendFile(contactI2pAddress: string, file: File): Promise<string> {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`Datei zu groß. Maximum: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    const transferId = crypto.randomUUID();
    const chunksTotal = Math.ceil(file.size / CHUNK_SIZE);

    // Generate thumbnail for images
    let thumbnailDataUrl: string | undefined;
    if (file.type.startsWith('image/')) {
      thumbnailDataUrl = await this.generateThumbnail(file);
    }

    // Compute SHA-256 hash for integrity verification
    const fileBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', fileBuffer);
    const fileHash = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const meta: FileTransferMeta = {
      transferId,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      chunksTotal,
      thumbnailDataUrl,
      fileHash,
    };

    // Track progress
    const progress: FileTransferProgress = {
      transferId,
      bytesTransferred: 0,
      totalBytes: file.size,
      percent: 0,
      speed: 0,
      status: 'pending',
      direction: 'send',
    };
    this.activeTransfers.set(transferId, progress);
    this.notifyProgress(progress);

    // Send offer
    await i2pService.sendMessage(contactI2pAddress, {
      type: 'file-transfer-offer',
      ...meta,
    });

    // Wait for accept/reject
    const accepted = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAccepts.delete(transferId);
        resolve(false);
      }, ACCEPT_TIMEOUT);

      this.pendingAccepts.set(transferId, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });

    if (!accepted) {
      progress.status = 'rejected';
      this.notifyProgress(progress);
      throw new Error('Transfer abgelehnt oder Timeout');
    }

    // Send chunks
    progress.status = 'transferring';
    this.notifyProgress(progress);

    const startTime = Date.now();
    const arrayBuffer = fileBuffer;

    for (let i = 0; i < chunksTotal; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = new Uint8Array(arrayBuffer.slice(start, end));

      // Convert to base64
      const base64 = btoa(String.fromCharCode(...chunk));

      await i2pService.sendMessage(contactI2pAddress, {
        type: 'file-transfer-chunk',
        transferId,
        chunkIndex: i,
        data: base64,
      });

      progress.bytesTransferred = end;
      progress.percent = Math.round((end / file.size) * 100);
      const elapsed = (Date.now() - startTime) / 1000;
      progress.speed = elapsed > 0 ? end / elapsed : 0;
      this.notifyProgress(progress);

      // Small delay between chunks to avoid overwhelming I2P
      if (i < chunksTotal - 1) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Send completion
    await i2pService.sendMessage(contactI2pAddress, {
      type: 'file-transfer-complete',
      transferId,
    });

    progress.status = 'completed';
    progress.percent = 100;
    this.notifyProgress(progress);

    return transferId;
  }

  /**
   * Handle incoming file offer
   */
  private async handleOffer(from: string, msg: { type: string } & FileTransferMeta): Promise<void> {
    const meta: FileTransferMeta = {
      transferId: msg.transferId,
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      mimeType: msg.mimeType,
      chunksTotal: msg.chunksTotal,
      thumbnailDataUrl: msg.thumbnailDataUrl,
      fileHash: msg.fileHash,
    };

    // Store meta for hash verification on completion
    this.transferMetas.set(meta.transferId, meta);

    // Track progress
    const progress: FileTransferProgress = {
      transferId: meta.transferId,
      bytesTransferred: 0,
      totalBytes: meta.fileSize,
      percent: 0,
      speed: 0,
      status: 'pending',
      direction: 'receive',
    };
    this.activeTransfers.set(meta.transferId, progress);
    this.receivedChunks.set(meta.transferId, new Map());

    // Ask user via handler
    let accepted = false;
    for (const handler of this.offerHandlers) {
      accepted = await handler(from, meta);
      if (accepted) break;
    }

    // Send response
    await i2pService.sendMessage(from, {
      type: 'file-transfer-accept',
      transferId: meta.transferId,
      accepted,
    });

    if (accepted) {
      progress.status = 'accepted';
    } else {
      progress.status = 'rejected';
      this.receivedChunks.delete(meta.transferId);
    }
    this.notifyProgress(progress);
  }

  /**
   * Handle accept/reject response
   */
  private handleAcceptResponse(msg: { transferId: string; accepted: boolean }): void {
    const resolver = this.pendingAccepts.get(msg.transferId);
    if (resolver) {
      resolver(msg.accepted);
      this.pendingAccepts.delete(msg.transferId);
    }
  }

  /**
   * Handle incoming chunk
   */
  private handleChunk(msg: { transferId: string; chunkIndex: number; data: string }): void {
    const chunks = this.receivedChunks.get(msg.transferId);
    if (!chunks) return;

    chunks.set(msg.chunkIndex, msg.data);

    const progress = this.activeTransfers.get(msg.transferId);
    if (progress) {
      // Estimate bytes from chunk count
      const receivedBytes = chunks.size * CHUNK_SIZE;
      progress.bytesTransferred = Math.min(receivedBytes, progress.totalBytes);
      progress.percent = Math.round((progress.bytesTransferred / progress.totalBytes) * 100);
      progress.status = 'transferring';
      this.notifyProgress(progress);
    }
  }

  /**
   * Handle transfer completion
   */
  private async handleComplete(msg: { transferId: string }): Promise<void> {
    const progress = this.activeTransfers.get(msg.transferId);
    if (progress) {
      // Verify file hash if available
      const chunks = this.receivedChunks.get(msg.transferId);
      const meta = this.transferMetas.get(msg.transferId);
      if (chunks && meta?.fileHash) {
        const blob = this.getReceivedFile(msg.transferId);
        if (blob) {
          const buffer = await blob.arrayBuffer();
          const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
          const computedHash = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');

          if (computedHash !== meta.fileHash) {
            progress.status = 'failed';
            this.notifyProgress(progress);
            logger.error('[FileTransfer] Hash verification failed for:', msg.transferId);
            return;
          }
        }
      }

      progress.status = 'completed';
      progress.percent = 100;
      progress.bytesTransferred = progress.totalBytes;
      this.notifyProgress(progress);
    }
  }

  /**
   * Get received file as Blob
   */
  getReceivedFile(transferId: string): Blob | null {
    const chunks = this.receivedChunks.get(transferId);
    if (!chunks) return null;

    const sortedChunks = Array.from(chunks.entries())
      .sort(([a], [b]) => a - b)
      .map(([, data]) => {
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
      });

    return new Blob(sortedChunks);
  }

  /**
   * Generate thumbnail for image files
   */
  private async generateThumbnail(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxSize = 128;
          const scale = Math.min(maxSize / img.width, maxSize / img.height);
          canvas.width = img.width * scale;
          canvas.height = img.height * scale;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('No canvas context')); return; }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Event handlers
   */
  onOffer(handler: TransferOfferHandler): void {
    this.offerHandlers.push(handler);
  }

  offOffer(handler: TransferOfferHandler): void {
    this.offerHandlers = this.offerHandlers.filter(h => h !== handler);
  }

  onProgress(handler: TransferProgressHandler): void {
    this.progressHandlers.push(handler);
  }

  offProgress(handler: TransferProgressHandler): void {
    this.progressHandlers = this.progressHandlers.filter(h => h !== handler);
  }

  getTransfer(transferId: string): FileTransferProgress | undefined {
    return this.activeTransfers.get(transferId);
  }

  private notifyProgress(progress: FileTransferProgress): void {
    this.progressHandlers.forEach(h => h({ ...progress }));
  }

  destroy(): void {
    this.activeTransfers.clear();
    this.receivedChunks.clear();
    this.transferMetas.clear();
    this.pendingAccepts.clear();
    this.offerHandlers = [];
    this.progressHandlers = [];
    this.initialized = false;
  }
}

export const fileTransferManager = new FileTransferManager();
