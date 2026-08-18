import { describe, it, expect } from 'vitest';
import { StreamingConnection } from './streaming-protocol';

describe('StreamingConnection', () => {
  it('round-trips data through packet send/receive with ACK', async () => {
    // conn1's send-callback captures what conn1 emits. We then feed those
    // packets to conn2. conn2's send-callback captures conn2's ACKs and we
    // feed them back to conn1 to exercise the ack plumbing path.
    const conn1SentPackets: Buffer[] = [];
    const conn1 = new StreamingConnection(
      { windowSize: 6, initialRTT: 100, maxRTO: 1000, idleTimeout: 5000 },
      (pkt) => conn1SentPackets.push(pkt),
    );

    const conn2SentPackets: Buffer[] = [];
    const conn2 = new StreamingConnection(
      { windowSize: 6, initialRTT: 100, maxRTO: 1000, idleTimeout: 5000 },
      (pkt) => conn2SentPackets.push(pkt),
    );

    let conn2Data: Uint8Array | null = null;
    conn2.onData((data) => {
      conn2Data = data;
    });

    conn1.sendData(Buffer.from('hello world'));

    // Snapshot conn1's data packets and drain the buffer before feeding to
    // conn2 — otherwise ACKs that conn2 emits get mixed into the same list.
    const conn1DataPackets = [...conn1SentPackets];
    conn1SentPackets.length = 0;

    conn1DataPackets.forEach((pkt) => conn2.receivePacket(pkt));

    // conn2 emitted ACKs in response; feed them back to conn1.
    const conn2AckPackets = [...conn2SentPackets];
    conn2SentPackets.length = 0;
    conn2AckPackets.forEach((pkt) => conn1.receivePacket(pkt));

    await new Promise((r) => setTimeout(r, 50));
    expect(conn2Data).not.toBeNull();
    expect(new TextDecoder().decode(conn2Data as unknown as Uint8Array)).toBe('hello world');
  });

  it('emits close event on graceful close', () => {
    const conn = new StreamingConnection(
      { windowSize: 6, initialRTT: 100, maxRTO: 1000, idleTimeout: 5000 },
      () => {},
    );
    let closeReason = '';
    conn.onClose((reason) => {
      closeReason = reason;
    });
    conn.close('user closed');
    expect(closeReason).toBe('user closed');
  });

  it('close() is idempotent and does not double-fire onClose', () => {
    let closeCount = 0;
    const conn = new StreamingConnection(
      { windowSize: 6, initialRTT: 100, maxRTO: 1000, idleTimeout: 5000 },
      () => {},
    );
    conn.onClose(() => {
      closeCount++;
    });
    conn.close('first');
    conn.close('second');
    expect(closeCount).toBe(1);
    expect(conn.isClosed()).toBe(true);
  });

  it('receivePacket is a no-op once closed', () => {
    let onDataCalls = 0;
    const conn = new StreamingConnection(
      { windowSize: 6, initialRTT: 100, maxRTO: 1000, idleTimeout: 5000 },
      () => {},
    );
    conn.onData(() => {
      onDataCalls++;
    });
    conn.close('bye');
    // Synthetic data packet — must be ignored after close.
    // Header: sendSeq=99, receiveSeq=99 (would be in-order if not closed),
    // flags=0, payload="X".
    const synthetic = Buffer.alloc(10);
    synthetic.writeUInt32BE(99, 0);
    synthetic.writeUInt32BE(99, 4);
    synthetic.writeUInt8(0, 8);
    synthetic.write('X', 9);
    conn.receivePacket(synthetic);
    expect(onDataCalls).toBe(0);
  });
});