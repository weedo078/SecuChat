/**
 * QR-Code Signaling Service
 * Serverless WebRTC connection establishment via QR codes
 * Works for: Android, Desktop, iOS (with camera/file fallback)
 */

import QRCode from 'qrcode';
import jsQR from 'jsqr';

export interface QRSignalData {
  version: '1.0';
  type: 'offer' | 'answer';
  timestamp: number;
  identity: {
    username: string;
    i2pAddress: string;
    pgpPublicKey: string;
    pgpFingerprint: string;
  };
  webrtc: {
    sdp: string;
    iceCandidates: RTCIceCandidateInit[];
  };
  expiresAt: number; // 5 minutes
}

export interface ScannedContact {
  username: string;
  i2pAddress: string;
  pgpPublicKey: string;
  pgpFingerprint: string;
  webrtcOffer?: RTCSessionDescriptionInit;
  iceCandidates: RTCIceCandidateInit[];
}

class QRSignalingService {
  private iceServers: RTCIceServer[] = []; // No STUN - LAN only or I2P
  private pendingConnections: Map<string, RTCPeerConnection> = new Map();

  /**
   * Generate a complete QR signal with WebRTC offer
   */
  async generateOfferSignal(options: {
    username: string;
    i2pAddress: string;
    pgpPublicKey: string;
    pgpFingerprint: string;
  }): Promise<{ dataUrl: string; signalData: QRSignalData; pc: RTCPeerConnection }> {
    // Create peer connection without STUN (LAN only)
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.pendingConnections.set(options.pgpFingerprint, pc);

    // Create data channel (required for WebRTC to work)
    pc.createDataChannel('signaling', { ordered: true });
    
    // Collect ICE candidates
    const iceCandidates: RTCIceCandidateInit[] = [];
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        iceCandidates.push(event.candidate.toJSON());
      }
    };

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Wait for ICE gathering (with timeout)
    await this.waitForIceGathering(pc, 5000);

    // Build signal data
    const signalData: QRSignalData = {
      version: '1.0',
      type: 'offer',
      timestamp: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
      identity: {
        username: options.username,
        i2pAddress: options.i2pAddress,
        pgpPublicKey: options.pgpPublicKey,
        pgpFingerprint: options.pgpFingerprint,
      },
      webrtc: {
        sdp: pc.localDescription!.sdp,
        iceCandidates,
      },
    };

    // Generate QR code
    const dataUrl = await this.generateQRCode(signalData);

    return { dataUrl, signalData, pc };
  }

  /**
   * Generate an answer QR code in response to an offer
   */
  async generateAnswerSignal(
    offerSignal: QRSignalData,
    options: {
      username: string;
      i2pAddress: string;
      pgpPublicKey: string;
      pgpFingerprint: string;
    }
  ): Promise<{ dataUrl: string; signalData: QRSignalData; pc: RTCPeerConnection }> {
    // Create peer connection
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });

    // Collect ICE candidates
    const iceCandidates: RTCIceCandidateInit[] = [];
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        iceCandidates.push(event.candidate.toJSON());
      }
    };

    // Handle incoming data channel
    pc.ondatachannel = () => {
      // Data channel received from peer
    };

    // Set remote description (the offer)
    await pc.setRemoteDescription(new RTCSessionDescription({
      type: 'offer',
      sdp: offerSignal.webrtc.sdp,
    }));

    // Add ICE candidates from offer
    for (const candidate of offerSignal.webrtc.iceCandidates) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[QR] Failed to add ICE candidate:', e);
      }
    }

    // Create answer
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Wait for ICE gathering
    await this.waitForIceGathering(pc, 5000);

    // Build answer signal
    const signalData: QRSignalData = {
      version: '1.0',
      type: 'answer',
      timestamp: Date.now(),
      expiresAt: Date.now() + 5 * 60 * 1000,
      identity: {
        username: options.username,
        i2pAddress: options.i2pAddress,
        pgpPublicKey: options.pgpPublicKey,
        pgpFingerprint: options.pgpFingerprint,
      },
      webrtc: {
        sdp: pc.localDescription!.sdp,
        iceCandidates,
      },
    };

    // Generate QR code
    const dataUrl = await this.generateQRCode(signalData);

    return { dataUrl, signalData, pc };
  }

  /**
   * Process an answer QR code (as initiator)
   */
  async processAnswerSignal(
    answerSignal: QRSignalData,
    originalPc: RTCPeerConnection
  ): Promise<RTCPeerConnection> {
    if (answerSignal.type !== 'answer') {
      throw new Error('Expected answer signal');
    }

    // Set remote description
    await originalPc.setRemoteDescription(new RTCSessionDescription({
      type: 'answer',
      sdp: answerSignal.webrtc.sdp,
    }));

    // Add ICE candidates
    for (const candidate of answerSignal.webrtc.iceCandidates) {
      try {
        await originalPc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[QR] Failed to add ICE candidate:', e);
      }
    }

    return originalPc;
  }

  /**
   * Parse scanned QR code data
   */
  parseQRData(qrData: string): QRSignalData | null {
    try {
      const parsed = JSON.parse(qrData) as QRSignalData;
      
      // Validate
      if (parsed.version !== '1.0') {
        throw new Error('Unsupported version');
      }
      if (!['offer', 'answer'].includes(parsed.type)) {
        throw new Error('Invalid type');
      }
      if (Date.now() > parsed.expiresAt) {
        throw new Error('QR code expired');
      }

      return parsed;
    } catch (error) {
      console.error('[QR] Failed to parse QR data:', error);
      return null;
    }
  }

  /**
   * Decode QR code from image file (for iOS)
   */
  async decodeQRFromImage(file: File): Promise<QRSignalData | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, canvas.width, canvas.height);
          if (code) {
            resolve(this.parseQRData(code.data));
          } else {
            resolve(null);
          }
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Export contact as file (for iOS sharing)
   */
  exportContactAsFile(contact: ScannedContact): Blob {
    const data = {
      version: '1.0',
      type: 'securechat-contact',
      exportedAt: Date.now(),
      contact,
    };
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  }

  /**
   * Import contact from file
   */
  async importContactFromFile(file: File): Promise<ScannedContact | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          if (data.type === 'securechat-contact' && data.contact) {
            resolve(data.contact as ScannedContact);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    });
  }

  /**
   * Generate QR code data URL
   */
  private async generateQRCode(data: QRSignalData): Promise<string> {
    const jsonString = JSON.stringify(data);
    
    // Check size - if too big, we might need to compress or use multiple QR codes
    if (jsonString.length > 2000) {
      console.warn('[QR] Signal data is large:', jsonString.length, 'chars');
    }

    return QRCode.toDataURL(jsonString, {
      width: 400,
      margin: 2,
      errorCorrectionLevel: 'L', // Low = more capacity
      type: 'image/png',
    });
  }

  /**
   * Wait for ICE gathering to complete
   */
  private waitForIceGathering(pc: RTCPeerConnection, timeout: number): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        pc.onicegatheringstatechange = null;
        resolve();
      }, timeout);

      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      };
    });
  }

  /**
   * Get anonymity level for a connection method
   */
  getAnonymityLevel(method: 'qr-lan' | 'qr-internet' | 'i2p' | 'file'): {
    level: 'green' | 'yellow' | 'red';
    description: string;
  } {
    switch (method) {
      case 'i2p':
        return {
          level: 'green',
          description: 'Anonym: IP-Adresse verborgen durch I2P',
        };
      case 'qr-lan':
        return {
          level: 'yellow',
          description: 'LAN-only: Nur im selben Netzwerk erreichbar',
        };
      case 'qr-internet':
      case 'file':
        return {
          level: 'red',
          description: 'Nicht anonym: IP-Adresse ist für Kommunikationspartner sichtbar',
        };
      default:
        return {
          level: 'red',
          description: 'Unbekannt',
        };
    }
  }
}

export const qrSignalingService = new QRSignalingService();
