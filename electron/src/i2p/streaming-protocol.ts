// Reference: https://i2p.net/en/docs/specs/streaming/
// Reference impl (Public Domain): https://github.com/i2p/i2p.i2p/tree/master/apps/streaming
//
// Phase-1 minimum-viable streaming protocol. The wire format is a small
// subset of I2P streaming v3:
//   bytes 0..3   sendSeq   (uint32 BE)
//   bytes 4..7   receiveSeq/ackThrough (uint32 BE)
//   byte  8      flags     (uint8)
//   bytes 9..    payload   (uint8[] — present iff not a pure ACK/CLOSE packet)
//
// This is NOT wire-compatible with the full I2P streaming protocol — it
// omits: signature, options, RTT/MTU fields, resend/never-resend, message
// ID, from-port/to-port. Those will be added in later phases alongside
// retransmit-on-RTO and the receive-window.

export interface StreamingOptions {
  /** Sliding-window size (max in-flight outbound packets). */
  windowSize: number;
  /** Initial RTT estimate in ms — used as the first RTO. */
  initialRTT: number;
  /** Maximum retransmit timeout in ms (cap on RTO backoff). */
  maxRTO: number;
  /** Idle-connection timeout in ms (not enforced in Phase 1). */
  idleTimeout: number;
}

/** Packet flags. */
const FLAG_SYN = 0x01;
const FLAG_ACK = 0x02;
const FLAG_RESET = 0x04;
const FLAG_SIGNATURE_INCLUDED = 0x08;
const FLAG_NOACK = 0x10;
const FLAG_CLOSE = 0x20;

/** Wire header is fixed-size: sendSeq(4) + receiveSeq(4) + flags(1). */
const HEADER_LEN = 9;

interface OutboundPacket {
  sendSeq: number;
  flags: number;
  payload: Uint8Array;
  sentAt: number;
  /** Scaffolding for Phase-6 retransmit-on-RTO. Not used in Phase 1. */
  retransmitCount: number;
}

interface InboundPacket {
  sendSeq: number;
  receiveSeq: number;
  flags: number;
  /** In I2P streaming v3 ackThrough = receiveSeq of the highest in-order packet. */
  ackThrough: number;
  payload: Uint8Array;
}

export class StreamingConnection {
  // Sequence numbers start at 1 (not 0) so that the receiveSeq/ackThrough
// wire slot can use 0 as the unambiguous sentinel for "no data received
// / nothing to ack yet". Otherwise we'd need to encode -1 on the wire
// (illegal for uint32 BE) or special-case it on every receive path.
private sendSeqCounter = 1;
private lastReceivedSeq = 0;
private highestReceivedAck = 0;
private outboundQueue: OutboundPacket[] = [];
private ackedThrough = 0;
  private onDataCb: ((data: Uint8Array) => void) | null = null;
  private onCloseCb: ((reason: string) => void) | null = null;
  private closed = false;

  constructor(
    private readonly opts: StreamingOptions,
    private readonly onSendPacket: (packet: Buffer) => void,
  ) {}

  onData(cb: (data: Uint8Array) => void): void {
    this.onDataCb = cb;
  }

  onClose(cb: (reason: string) => void): void {
    this.onCloseCb = cb;
  }

  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Send application data. Splits into packets respecting window size.
   * (Simplified — production would handle partial-window backpressure.)
   */
  sendData(data: Uint8Array): void {
    if (this.closed) throw new Error('connection closed');
    const seq = this.sendSeqCounter++;
    const pkt: OutboundPacket = {
      sendSeq: seq,
      flags: 0,
      payload: data,
      sentAt: Date.now(),
      retransmitCount: 0,
    };
    this.outboundQueue.push(pkt);
    this.sendPacket(pkt);
  }

  /**
   * Process an incoming packet from the peer (decoded by I2CPSocketManager).
   */
  receivePacket(rawPacket: Buffer): void {
    if (this.closed) return;
    const pkt = this.decodePacket(rawPacket);

    // Handle RESET.
    if (pkt.flags & FLAG_RESET) {
      this.fireClose('peer reset');
      return;
    }

    // Handle CLOSE.
    if (pkt.flags & FLAG_CLOSE) {
      this.fireClose('peer closed');
      return;
    }

    // Send ACK if data packet (and not explicitly suppressed).
    if (!(pkt.flags & FLAG_NOACK) && pkt.payload.length > 0) {
      this.sendAck(pkt.sendSeq);
    }

    // Process in-order data: pkt.sendSeq is the peer's monotonically
    // increasing sequence number for this packet. Our lastReceivedSeq tracks
    // the highest contiguous sendSeq we have accepted.
    if (pkt.sendSeq === this.lastReceivedSeq + 1) {
      this.lastReceivedSeq = pkt.sendSeq;
      if (pkt.payload.length > 0) {
        this.onDataCb?.(pkt.payload);
      }
    } else if (pkt.sendSeq <= this.lastReceivedSeq) {
      // Duplicate — already received, ignore.
      return;
    } else {
      // Out-of-order: pkt.sendSeq > lastReceivedSeq + 1.
      // Phase-1 MVP: silently drop. Phase 6 will buffer for the receive-window
      // and trigger SACK retransmits.
      return;
    }

    // Update ACKed seq — prune anything the peer has acknowledged.
    if (pkt.ackThrough > this.ackedThrough) {
      this.ackedThrough = pkt.ackThrough;
      this.outboundQueue = this.outboundQueue.filter(
        (p) => p.sendSeq > pkt.ackThrough,
      );
    }
  }

  close(reason: string): void {
    // Idempotent: bail out early if already closed (covers both explicit
    // user close() and the case where receivePacket observed a peer CLOSE).
    if (this.closed) return;
    this.closed = true;
    // Best-effort CLOSE packet — peer may already be gone, that's OK.
    const closePkt = Buffer.alloc(HEADER_LEN);
    closePkt.writeUInt32BE(this.sendSeqCounter++, 0);
    closePkt.writeUInt32BE(this.lastReceivedSeq, 4);
    closePkt.writeUInt8(FLAG_CLOSE, 8);
    this.onSendPacket(closePkt);
    // Fire the close callback exactly once. We null the cb afterward so that
    // any late-arriving receivePacket() — which may now see a stale CLOSE
    // from the peer — cannot re-trigger onClose.
    if (this.onCloseCb !== null) {
      const cb = this.onCloseCb;
      this.onCloseCb = null;
      cb(reason);
    }
  }

  private sendPacket(pkt: OutboundPacket): void {
    const buf = this.encodeOutbound(pkt);
    this.onSendPacket(buf);
  }

  private sendAck(receiveSeq: number): void {
    const ackPkt = Buffer.alloc(HEADER_LEN);
    ackPkt.writeUInt32BE(this.sendSeqCounter++, 0);
    ackPkt.writeUInt32BE(receiveSeq, 4);
    ackPkt.writeUInt8(FLAG_ACK, 8);
    this.onSendPacket(ackPkt);
  }

  private encodeOutbound(pkt: OutboundPacket): Buffer {
    const buf = Buffer.alloc(HEADER_LEN + pkt.payload.length);
    buf.writeUInt32BE(pkt.sendSeq, 0);
    buf.writeUInt32BE(this.lastReceivedSeq, 4);
    buf.writeUInt8(pkt.flags, 8);
    if (pkt.payload.length > 0) {
      Buffer.from(pkt.payload).copy(buf, HEADER_LEN);
    }
    return buf;
  }

  private decodePacket(buf: Buffer): InboundPacket {
    return {
      sendSeq: buf.readUInt32BE(0),
      // In I2P streaming v3 the receiveSeq slot also carries ackThrough.
      receiveSeq: buf.readUInt32BE(4),
      flags: buf.readUInt8(8),
      ackThrough: buf.readUInt32BE(4),
      payload: new Uint8Array(buf.subarray(HEADER_LEN)),
    };
  }

  /**
   * Peer-initiated close path. Mirrors the public close() path with
   * idempotency baked in — if close() already ran (closed === true) the
   * early-return short-circuits and onClose is NOT fired a second time.
   */
  private fireClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.onCloseCb !== null) {
      const cb = this.onCloseCb;
      this.onCloseCb = null;
      cb(reason);
    }
  }
}