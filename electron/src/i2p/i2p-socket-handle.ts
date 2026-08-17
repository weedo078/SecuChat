import { Duplex } from 'node:stream';

export interface DataEvent {
  streamId: number;
  data: Uint8Array;
}

export interface CloseEvent {
  streamId: number;
  reason: string;
}

export class I2PSocketHandle {
  private closed = false;
  private readStarted = false;
  private onDataCb: ((ev: DataEvent) => void) | null = null;
  private onCloseCb: ((ev: CloseEvent) => void) | null = null;
  private newlineBuffer: Buffer = Buffer.alloc(0);

  constructor(
    public readonly streamId: number,
    private readonly socket: Duplex,
    public readonly peerDestination: string,
  ) {}

  setOnData(cb: (ev: DataEvent) => void): void {
    this.onDataCb = cb;
  }

  setOnClose(cb: (ev: CloseEvent) => void): void {
    this.onCloseCb = cb;
  }

  /**
   * Starts the read-loop. Idempotent (matches Android I2PSocketHandle.java:52).
   * Splits incoming data on '\n' and emits each line as separate DataEvent
   * (improvement over Android I2PSocketHandle.java:55-63 which does NOT split).
   */
  startReadThread(): void {
    if (this.readStarted) return;
    this.readStarted = true;

    this.socket.on('data', (chunk: Buffer) => {
      if (this.closed) return;
      this.newlineBuffer = Buffer.concat([this.newlineBuffer, chunk]);
      let nlIdx;
      while ((nlIdx = this.newlineBuffer.indexOf(0x0A)) !== -1) {
        const line = this.newlineBuffer.subarray(0, nlIdx);
        this.newlineBuffer = this.newlineBuffer.subarray(nlIdx + 1);
        if (line.length === 0) continue;
        this.onDataCb?.({ streamId: this.streamId, data: new Uint8Array(line) });
      }
    });

    this.socket.on('error', () => {
      if (this.closed) return;
      this.fireClose('error');
    });

    this.socket.on('close', () => {
      if (this.closed) return;
      this.fireClose('peer disconnected');
    });
  }

  async send(data: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('socket closed');
    return new Promise((resolve, reject) => {
      this.socket.write(data, (err) => err ? reject(err) : resolve());
    });
  }

  async close(reason: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.onCloseCb?.({ streamId: this.streamId, reason: 'closed' });
  }

  isClosed(): boolean {
    return this.closed;
  }

  private fireClose(reason: string): void {
    this.closed = true;
    this.onCloseCb?.({ streamId: this.streamId, reason });
  }
}