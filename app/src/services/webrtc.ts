import type { Message } from '@/types';

export interface WebRTCConnection {
  peerId: string;
  connection: RTCPeerConnection;
  dataChannel?: RTCDataChannel;
  status: 'connecting' | 'connected' | 'disconnected' | 'failed';
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'ping' | 'pong';
  sender: string;
  recipient: string;
  data: unknown;
  timestamp: string;
}

export interface MessageHandler {
  (message: Message): void;
}

export interface ConnectionStateHandler {
  (peerId: string, state: WebRTCConnection['status']): void;
}

export class WebRTCService {
  private static instance: WebRTCService;
  private connections: Map<string, WebRTCConnection> = new Map();
  private messageHandlers: MessageHandler[] = [];
  private stateHandlers: ConnectionStateHandler[] = [];
  private localPeerId: string = '';
  private signalingServer: WebSocket | null = null;
  private iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  static getInstance(): WebRTCService {
    if (!WebRTCService.instance) {
      WebRTCService.instance = new WebRTCService();
    }
    return WebRTCService.instance;
  }

  setLocalPeerId(peerId: string): void {
    this.localPeerId = peerId;
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  onConnectionStateChange(handler: ConnectionStateHandler): void {
    this.stateHandlers.push(handler);
  }

  private notifyMessageHandlers(message: Message): void {
    this.messageHandlers.forEach(handler => handler(message));
  }

  private notifyStateHandlers(peerId: string, state: WebRTCConnection['status']): void {
    this.stateHandlers.forEach(handler => handler(peerId, state));
  }

  /**
   * Connect to signaling server (simplified - in production would use I2P)
   */
  async connectSignaling(serverUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.signalingServer = new WebSocket(serverUrl);
        
        this.signalingServer.onopen = () => {
          console.log('Connected to signaling server');
          // Register with server
          this.sendSignalingMessage({
            type: 'ping',
            sender: this.localPeerId,
            recipient: 'server',
            data: { action: 'register', peerId: this.localPeerId },
            timestamp: new Date().toISOString(),
          });
          resolve();
        };

        this.signalingServer.onmessage = (event) => {
          const message: SignalingMessage = JSON.parse(event.data);
          this.handleSignalingMessage(message);
        };

        this.signalingServer.onerror = (error) => {
          console.error('Signaling server error:', error);
          reject(error);
        };

        this.signalingServer.onclose = () => {
          console.log('Signaling server connection closed');
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private sendSignalingMessage(message: SignalingMessage): void {
    if (this.signalingServer?.readyState === WebSocket.OPEN) {
      this.signalingServer.send(JSON.stringify(message));
    }
  }

  private async handleOffer(msg: SignalingMessage): Promise<void> {
    const { offer, peerId } = msg.data as { offer: RTCSessionDescriptionInit; peerId: string };
    const connection = await this.createPeerConnection(peerId);
    
    await connection.connection.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await connection.connection.createAnswer();
    await connection.connection.setLocalDescription(answer);
    
    this.sendSignalingMessage({
      type: 'answer',
      sender: this.localPeerId,
      recipient: peerId,
      data: { answer, peerId: this.localPeerId },
      timestamp: new Date().toISOString(),
    });
  }

  private async handleAnswer(msg: SignalingMessage): Promise<void> {
    const { answer, peerId } = msg.data as { answer: RTCSessionDescriptionInit; peerId: string };
    const connection = this.connections.get(peerId);
    if (connection) {
      await connection.connection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  private async handleIceCandidate(msg: SignalingMessage): Promise<void> {
    const { candidate, peerId } = msg.data as { candidate: RTCIceCandidateInit; peerId: string };
    const connection = this.connections.get(peerId);
    if (connection) {
      await connection.connection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  private async handleSignalingMessage(message: SignalingMessage): Promise<void> {
    if (message.recipient !== this.localPeerId) return;

    switch (message.type) {
      case 'offer':
        await this.handleOffer(message);
        break;
      case 'answer':
        await this.handleAnswer(message);
        break;
      case 'ice-candidate':
        await this.handleIceCandidate(message);
        break;
      case 'ping':
        this.sendSignalingMessage({
          type: 'pong',
          sender: this.localPeerId,
          recipient: message.sender,
          data: {},
          timestamp: new Date().toISOString(),
        });
        break;
    }
  }

  /**
   * Create a new peer connection
   */
  private async createPeerConnection(peerId: string): Promise<WebRTCConnection> {
    const existingConnection = this.connections.get(peerId);
    if (existingConnection) {
      return existingConnection;
    }

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    
    const connection: WebRTCConnection = {
      peerId,
      connection: pc,
      status: 'connecting',
    };

    // Create data channel for messaging
    const dataChannel = pc.createDataChannel('messages', {
      ordered: true,
    });
    
    this.setupDataChannel(connection, dataChannel);
    connection.dataChannel = dataChannel;

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignalingMessage({
          type: 'ice-candidate',
          sender: this.localPeerId,
          recipient: peerId,
          data: { candidate: event.candidate, peerId: this.localPeerId },
          timestamp: new Date().toISOString(),
        });
      }
    };

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        connection.status = 'connected';
        this.notifyStateHandlers(peerId, 'connected');
      } else if (state === 'disconnected' || state === 'closed') {
        connection.status = 'disconnected';
        this.notifyStateHandlers(peerId, 'disconnected');
      } else if (state === 'failed') {
        connection.status = 'failed';
        this.notifyStateHandlers(peerId, 'failed');
      }
    };

    // Handle incoming data channels
    pc.ondatachannel = (event) => {
      this.setupDataChannel(connection, event.channel);
    };

    this.connections.set(peerId, connection);
    return connection;
  }

  private setupDataChannel(connection: WebRTCConnection, channel: RTCDataChannel): void {
    channel.onopen = () => {
      console.log(`Data channel opened with ${connection.peerId}`);
      connection.status = 'connected';
      this.notifyStateHandlers(connection.peerId, 'connected');
    };

    channel.onmessage = (event) => {
      try {
        const message: Message = JSON.parse(event.data);
        this.notifyMessageHandlers(message);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };

    channel.onclose = () => {
      console.log(`Data channel closed with ${connection.peerId}`);
      connection.status = 'disconnected';
      this.notifyStateHandlers(connection.peerId, 'disconnected');
    };

    channel.onerror = (error) => {
      console.error(`Data channel error with ${connection.peerId}:`, error);
      connection.status = 'failed';
      this.notifyStateHandlers(connection.peerId, 'failed');
    };
  }

  /**
   * Initiate connection to a peer
   */
  async connectToPeer(peerId: string): Promise<void> {
    const connection = await this.createPeerConnection(peerId);
    
    const offer = await connection.connection.createOffer();
    await connection.connection.setLocalDescription(offer);
    
    this.sendSignalingMessage({
      type: 'offer',
      sender: this.localPeerId,
      recipient: peerId,
      data: { offer, peerId: this.localPeerId },
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Send a message to a peer
   */
  async sendMessage(peerId: string, message: Message): Promise<boolean> {
    const connection = this.connections.get(peerId);
    
    if (!connection || !connection.dataChannel || connection.dataChannel.readyState !== 'open') {
      console.error(`No open connection to peer ${peerId}`);
      return false;
    }

    try {
      connection.dataChannel.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  }

  /**
   * Disconnect from a peer
   */
  disconnectFromPeer(peerId: string): void {
    const connection = this.connections.get(peerId);
    if (connection) {
      connection.dataChannel?.close();
      connection.connection.close();
      this.connections.delete(peerId);
      this.notifyStateHandlers(peerId, 'disconnected');
    }
  }

  /**
   * Disconnect from all peers
   */
  disconnectAll(): void {
    this.connections.forEach((_, peerId) => {
      this.disconnectFromPeer(peerId);
    });
  }

  /**
   * Get connection status for a peer
   */
  getConnectionStatus(peerId: string): WebRTCConnection['status'] {
    return this.connections.get(peerId)?.status || 'disconnected';
  }

  /**
   * Check if connected to a peer
   */
  isConnected(peerId: string): boolean {
    return this.getConnectionStatus(peerId) === 'connected';
  }

  /**
   * Get all connected peers
   */
  getConnectedPeers(): string[] {
    return Array.from(this.connections.entries())
      .filter(([, conn]) => conn.status === 'connected')
      .map(([peerId]) => peerId);
  }

  /**
   * Close signaling server connection
   */
  closeSignaling(): void {
    this.signalingServer?.close();
    this.signalingServer = null;
  }
}

export const webrtcService = WebRTCService.getInstance();
