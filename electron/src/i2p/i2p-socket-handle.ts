import { Duplex } from 'node:stream';

export interface DataEvent {
  streamId: number;
  data: Uint8Array;
  /**
   * Peer that produced this data — wired through to the IPC layer so the
   * renderer can attribute incoming messages without joining the stream
   * registry on the main side. For client-initiated streams this is the
   * b32 we connected to; for server-initiated streams it is the b32 the
   * peer claims to be (best-effort — see I2PPlugin.acceptIncoming TODO).
   */
  peerDestination: string;
}

export interface CloseEvent {
  streamId: number;
  reason: string;
  peerDestination: string;
}

export class I2PSocketHandle {
  private closed = false;
  private readStarted = false;
  private onDataCb: ((ev: DataEvent) => void) | null = null;
  private onCloseCb: ((ev: CloseEvent) => void) | null = null;
  private newlineBuffer: Buffer = Buffer.alloc(0);

  /**
   * Maximum bytes to buffer in `newlineBuffer` between newlines.
   * Prevents OOM via a malicious/buggy peer that never sends `\n`.
   */
  public static readonly MAX_BUFFER_BYTES = 1 << 20; // 1 MiB

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
      if (this.newlineBuffer.length > I2PSocketHandle.MAX_BUFFER_BYTES) {
        this.fireClose('error');
        // Stop the socket from delivering further data and tear it down so the
        // peer cannot keep writing. Use 'error' so the listener gets a clear
        // signal that this is not a normal close.
        this.socket.destroy(new Error('newline buffer overflow'));
        return;
      }
      let nlIdx;
      while ((nlIdx = this.newlineBuffer.indexOf(0x0A)) !== -1) {
        const line = this.newlineBuffer.subarray(0, nlIdx);
        this.newlineBuffer = this.newlineBuffer.subarray(nlIdx + 1);
        if (line.length === 0) continue;
        this.onDataCb?.({
          streamId: this.streamId,
          data: new Uint8Array(line),
          peerDestination: this.peerDestination,
        });
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
    // Append `\n` so the receiver's newline-splitting reader-loop sees a
    // complete framed message. Matches the protocol contract: sender appends
    // `\n`, receiver splits on `\n` and emits each line as a DataEvent.
    const framed = Buffer.concat([Buffer.from(data), Buffer.from([0x0A])]);
    return new Promise((resolve, reject) => {
      this.socket.write(framed, (err) => err ? reject(err) : resolve());
    });
  }

  async close(reason: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.socket.destroy();
    this.onCloseCb?.({ streamId: this.streamId, reason: 'closed', peerDestination: this.peerDestination });
  }

  isClosed(): boolean {
    return this.closed;
  }

  private fireClose(reason: string): void {
    this.closed = true;
    this.onCloseCb?.({ streamId: this.streamId, reason, peerDestination: this.peerDestination });
  }
}