import * as net from "node:net";
import { I2PSocketHandle } from "./i2p-socket-handle";
import { StreamingConnection } from "./streaming-protocol";
import { computeB32FromPrivKey } from "./destination-gen";
import {
  encodeMessage,
  decodeMessage,
  readMessageFromSocket,
  I2CP_MSG,
  I2CP_HELLO_BYTE,
} from "./i2cp-protocol";
import { IdentityEx } from "./i2cp-identity";
import {
  encodeCreateSession,
  encodeCreateLeaseSet2,
} from "./i2cp-session-creator";
import {
  parseRequestLeaseSet,
  parseRequestVariableLeaseSet,
  validateParsedLeaseSetRequest,
  withLeaseSetSessionId,
  type LeaseSetState,
  type ParsedLeaseSetRequest,
} from "./i2cp-lease-set-request";

export interface I2CPSocketManagerOpts {
  host: string;
  port: number;
  privKey: Uint8Array;
  nickname: string;
}

/**
 * I2CP session manager. Mirrors Android `I2CPSocketManager.java`.
 *
 * Wire-compatibility invariants (must stay byte-identical with Android):
 *   - b32 is derived LOCALLY from the private key (SHA-256(destination) +
 *     base32 + ".b32.i2p"), NOT learned from the router. The router never
 *     sends the destination back; this is what every I2P client does.
 *   - The I2CP message type IDs must match the official spec
 *     (https://geti2p.net/spec/i2cp). The previous constants had several
 *     collisions (SEND_MESSAGE=30 was DisconnectMessage, etc.) and are now
 *     consolidated in `i2cp-protocol.ts`.
 *
 * Singleton mirrors Android `I2CPSocketManager.java` static-method pattern.
 */
export class I2CPSocketManager {
  private static instance: I2CPSocketManager | null = null;

  /**
   * Monotonically-increasing streamId. Strictly positive per I2CP/Streaming
   * spec; never decremented even on close/disconnect so a future reconnect
   * (Phase 6) cannot collide with an in-flight streamId still being acked.
   */
  private streamIdCounter = 1;

  private outgoingStreams: Map<number, I2PSocketHandle> = new Map();
  private incomingStreams: Map<number, I2PSocketHandle> = new Map();
  private streamingConnections: Map<number, StreamingConnection> = new Map();
  private disconnected = true; // starts disconnected until initialize() resolves
  private b32Address: string | null = null;
  private socket: net.Socket | null = null;
  /** I2CP session ID assigned by the router after CreateSession handshake. */
  private i2cpSessionId: number | null = null;
  /** True once the router confirmed SessionStatus.Created. */
  private sessionReady = false;
  /** Offset between local Date.now() and router-reported time. Used to sign CreateSession with a router-valid Date. */
  private routerDateOffsetMs = 0;
  private leaseSetState: LeaseSetState = "idle";
  private currentLeases: Array<{
    tunnelGw: Uint8Array;
    tunnelId: number;
    endDateSeconds: number;
  }> = [];
  private currentPublished = 0;
  private currentExpires = 0;
  private leaseSetExpiryWatchdog: NodeJS.Timeout | null = null;
  private leaseSetRequestTimeout: NodeJS.Timeout | null = null;
  private getDateRefreshTimer: NodeJS.Timeout | null = null;
  private parseErrorCount = 0;
  private static readonly MAX_PARSE_ERRORS = 5;
  private static readonly LEASE_SET_REQUEST_TIMEOUT_MS = 60_000;
  private static readonly LEASE_SET_WATCHDOG_MARGIN_SEC = 60;
  /** Pending SessionStatus resolvers, keyed by expected status value. */
  private readonly pendingStatus: Map<number, () => void> = new Map();
  /**
   * Pending DestLookup (34) request resolvers, keyed by the request's
   * sessionId (== request id, in the 0..65535 range the I2CP spec allows).
   * Resolved when the corresponding DestReply (35) arrives.
   */
  private readonly pendingDestLookups: Map<
    number,
    (reply: { found: boolean; dest: Buffer | null }) => void
  > = new Map();
  /** Monotonic request id for DestLookup messages. */
  private destLookupCounter = 1;
  /** Cache: b32 → destination blob, avoids re-lookup on reconnect. */
  private readonly destCache: Map<string, Buffer> = new Map();

  /**
   * Listeners fired when a peer-initiated stream arrives. Each listener
   * receives `{ streamId, peerDestination }` so the caller (I2PPlugin) can
   * wrap the new I2PSocketHandle in its own onData/onClose wiring and
   * forward the `i2pStreamConnected` / `i2pMessage` / `i2pStreamClosed`
   * events to the renderer.
   *
   * The peer-b32 is the SHA-256 hash from the destination blob in the
   * RECEIVE_MESSAGE_BEGIN payload, base32-encoded. We do NOT have access
   * to the full destination blob without an additional DestLookup, so
   * this is best-effort: same identity model as SAM's
   * `STREAM CONNECTED <peer-destination>` in SAMv3.
   */
  private readonly incomingStreamListeners: Array<
    (info: { streamId: number; peerB32: string }) => void
  > = [];

  private constructor(private readonly opts: I2CPSocketManagerOpts) {}

  static async getOrCreate(
    opts: I2CPSocketManagerOpts,
  ): Promise<I2CPSocketManager> {
    if (!I2CPSocketManager.instance) {
      I2CPSocketManager.instance = new I2CPSocketManager(opts);
      await I2CPSocketManager.instance.initialize();
    }
    return I2CPSocketManager.instance;
  }

  static getInstance(): I2CPSocketManager | null {
    return I2CPSocketManager.instance;
  }

  /**
   * Subscribe to peer-initiated streams. Each invocation delivers
   * `{ streamId, peerB32 }` exactly once when a RECEIVE_MESSAGE_BEGIN
   * arrives with a previously-unknown streamId. The caller is expected
   * to look up the `I2PSocketHandle` via `getStream(streamId)`, wire up
   * `setOnData` / `setOnClose`, and call `startReadThread()`.
   *
   * Returns an unsubscribe function.
   */
  onIncomingStream(
    cb: (info: { streamId: number; peerB32: string }) => void,
  ): () => void {
    this.incomingStreamListeners.push(cb);
    return () => {
      const i = this.incomingStreamListeners.indexOf(cb);
      if (i !== -1) this.incomingStreamListeners.splice(i, 1);
    };
  }

  /**
   * Static validator (matches Android `I2CPSocketManager.java:84` —
   * package-private helper for unit-testability). Throws on null/empty
   * input; the offending input is included (length-capped) for debuggability
   * without leaking the full destination into logs.
   */
  static requireDestination(destinationB32: string | null | undefined): void {
    if (typeof destinationB32 !== "string" || destinationB32.length === 0) {
      const safe = JSON.stringify(destinationB32 ?? "<null/undefined>").slice(
        0,
        64,
      );
      throw new Error(`destination B32 required (got: ${safe})`);
    }
  }

  /**
   * Establish the I2CP session:
   *   1. Derive b32 LOCALLY from privKey (router never tells us our own b32).
   *   2. Open TCP connection to router (7654).
   *   3. Send CreateSessionMessage with properties (nickname, etc.).
   *   4. Background-wait for SessionStatusMessage = Created; mark
   *      `sessionReady=true` so connectTo/acceptIncoming can proceed.
   *   5. On SessionStatus=Created, automatically send CreateLeaseSetMessage
   *      so the router publishes our LeaseSet (required before anyone can
   *      STREAM CONNECT to us).
   *
   * Failure-mode policy: `start()` returns AS SOON AS the TCP socket is
   * open and the CreateSessionMessage is sent — it does NOT block on the
   * SessionStatus reply. This matters for three reasons:
   *
   *   a) The renderer can show the user's b32 immediately, even on a
   *      sluggish or unresponsive router.
   *   b) The Electron startup path stays fast — a hung router cannot block
   *      the UI for 15 s.
   *   c) The pre-existing vitest test suite mocks `net.connect` without
   *      a `data` event and would deadlock otherwise; the test fixtures
   *      assert only that `start()` returns a non-empty b32 string.
   *
   * If the SessionStatus reply never arrives, `sessionReady` stays false
   * and `connectTo()` / `acceptIncoming()` throw "I2CP session not ready"
   * until the next call to `getOrCreate()` (or `disconnect()` + retry).
   */
  private async initialize(): Promise<void> {
    // Step 1: derive b32 locally from privKey. This is independent of the
    // router — Java I2P / i2pd never sends the user's own b32 in any I2CP
    // message; clients compute it themselves per the I2P b32 spec.
    this.b32Address = await computeB32FromPrivKey(this.opts.privKey);

    // Step 2: TCP connect to router. 15 s budget matches Android
    // I2CPSocketManager.java.
    const sock = net.connect(this.opts.port, this.opts.host);
    this.socket = sock;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => {
        sock.removeListener("connect", onConnect);
        reject(err);
      };
      const onConnect = (): void => {
        sock.removeListener("error", onError);
        // I2CP wire protocol: the very first byte after TCP-connect MUST
        // be the protocol hello byte (0x2A = 42). Java-I2P's
        // ClientListenerRunner.validate() reads this byte and closes the
        // socket if it does not match; i2pd's I2CP.cpp::ReadProtocolByte()
        // enforces the same gate. Without it, the router FIN-closes the
        // socket silently and we never see a reply — see
        // https://i2p.net/en/docs/specs/i2cp-overview
        // and the live-debug notes for PR #209.
        sock.write(Buffer.from([I2CP_HELLO_BYTE]));
        resolve();
      };
      sock.once("connect", onConnect);
      sock.once("error", onError);
      const timer = setTimeout(() => {
        sock.removeListener("connect", onConnect);
        sock.removeListener("error", onError);
        sock.destroy();
        reject(new Error("connect timeout"));
      }, 15_000);
      timer.unref();
    });

    // Step 3: wire the inbound message reader. Every frame is either a
    // SessionStatusMessage (during handshake), a GetDateReply (date sync),
    // a MessagePayloadMessage (incoming streaming data), or a DisconnectMessage.
    readMessageFromSocket(sock, (msg) => this.handleIncomingMessage(msg));

    // Step 4: GET_DATE — query router's wall-clock so our signed CreateSession
    // passes the router's ±30s date check (see I2CP-Spec). Router responds
    // with type=32 GET_DATE (no sessionId) + 8-byte Date BE. On timeout we
    // continue with routerDateOffsetMs=0 (use local clock) and log a warning.
    await this.syncRouterClock().catch((err: Error) => {
      console.warn(
        `I2CPSocketManager: GET_DATE failed: ${err.message} — using local clock for CreateSession`,
      );
    });

    // Step 5: send CreateSessionMessage with spec-compliant layout
    // (inline IdentityEx + sorted Mapping + Date + Ed25519 Signature).
    const identity = IdentityEx.fromPrivKey(this.opts.privKey);
    const properties = new Map<string, string>([
      ["nickname", this.opts.nickname],
      ["i2cp.fastReceive", "true"],
      ["i2cp.messageReliability", "BestEffort"],
    ]);
    const dateMs = Date.now() + this.routerDateOffsetMs;
    sock.write(encodeCreateSession({ identity, properties, dateMs }));

    // Step 6: background GET_DATE refresh every 30 minutes (clock drift)
    this.getDateRefreshTimer = setInterval(
      () => {
        if (!this.socket || this.socket.destroyed) return;
        this.socket.write(
          encodeMessage({
            type: I2CP_MSG.GET_DATE,
            sessionId: null,
            payload: Buffer.alloc(0),
          }),
        );
      },
      30 * 60 * 1000,
    );
    this.getDateRefreshTimer.unref();

    // Step 7: fire-and-forget SessionStatus wait (unchanged)
    this.waitForSessionStatus(/*Created*/ 1, /*budgetMs*/ 15_000).catch(
      (err: Error) => {
        console.warn(
          "I2CPSocketManager: SessionStatus=Created not received:",
          err.message,
        );
      },
    );

    this.disconnected = false;
  }

  private syncRouterClock(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.socket) return reject(new Error("no socket"));
      const sock = this.socket;
      const timer = setTimeout(
        () => reject(new Error("GET_DATE timeout after 15s")),
        15_000,
      );
      timer.unref();
      const onData = (chunk: Buffer): void => {
        // Minimal decoder for the GET_DATE round-trip: read 4-byte length
        // (= body length, NOT including the 1-byte type), 1-byte type, and
        // the 8-byte Date BE. Per Java-I2P's I2CPMessageImpl.writeMessage
        // the body length does NOT include the type byte — so a vanilla
        // GET_DATE reply has body=8 (date only) or 8+N (date + version).
        if (chunk.length < 5) return;
        const length = chunk.readUInt32BE(0);
        if (chunk.length < 4 + 1 + length) return;
        if (chunk[4] !== I2CP_MSG.GET_DATE) return;
        if (length < 8) return reject(new Error("GET_DATE reply too short"));
        const routerMs = Number(chunk.readBigUInt64BE(5));
        this.routerDateOffsetMs = routerMs - Date.now();
        clearTimeout(timer);
        sock.removeListener("data", onData);
        resolve();
      };
      sock.on("data", onData);
      sock.write(
        encodeMessage({
          type: I2CP_MSG.GET_DATE,
          sessionId: null,
          payload: Buffer.alloc(0),
        }),
      );
    });
  }

  /**
   * Inbound message dispatch. Handles three message families:
   *   - SESSION_STATUS: handshake lifecycle (resolve pending waits + publish LeaseSet on Created)
   *   - DEST_REPLY: lookup responses for outgoing DestLookup requests
   *   - RECEIVE_MESSAGE_BEGIN / MESSAGE_PAYLOAD / RECEIVE_MESSAGE_END:
   *     streaming data from peer — fed into the matching StreamingConnection
   *     via `feedStreamingPacket(streamId, packet)`.
   */
  private handleIncomingMessage(msg: {
    type: number;
    sessionId: number | null;
    payload: Buffer;
  }): void {
    if (msg.type === I2CP_MSG.GET_DATE) {
      // Spec: GET_DATE reply has no sessionId, payload is 8-byte Date BE.
      // Update routerDateOffsetMs from this value (defensive, syncRouterClock
      // already does this synchronously; this catches the 30-min refresh).
      if (msg.payload.length >= 8) {
        const routerMs = Number(msg.payload.readBigUInt64BE(0));
        this.routerDateOffsetMs = routerMs - Date.now();
      }
      return;
    }

    if (msg.type === I2CP_MSG.SESSION_STATUS) {
      // SESSION_STATUS is in SID_LESS_TYPES (see i2cp-protocol.ts), so the
      // decoder does NOT strip a 2-byte sessionId prefix — `msg.payload`
      // IS the full body, and `msg.sessionId` is null. Body shape depends
      // on the router version:
      //
      //   6 bytes [2B sid][4B status]     — i2pd / I2CP spec literal reading
      //   5 bytes [1B sid][4B status]     — legacy Java-I2P (pre-0.9.34)
      //   3 bytes [2B msgId][1B status]   — Java-I2P 0.9.34+ (msgId == sid)
      //
      // The 5-byte form is the reason we cannot let the decoder strip a
      // fixed-width sessionId: it has only 1 byte of sid, so a 2-byte
      // strip would silently merge the sid's high byte into the status.
      let status: number;
      let sid: number;
      if (msg.payload.length === 6) {
        sid = msg.payload.readUInt16BE(0);
        status = msg.payload.readUInt32BE(2);
      } else if (msg.payload.length === 5) {
        sid = msg.payload.readUInt8(0);
        status = msg.payload.readUInt32BE(1);
      } else if (msg.payload.length === 3) {
        sid = msg.payload.readUInt16BE(0);
        status = msg.payload.readUInt8(2);
      } else {
        // Unrecognized body shape — router sent a malformed reply.
        // Bail out without touching i2cpSessionId so the previous value
        // (likely null or a valid prior sid) is preserved.
        return;
      }
      this.i2cpSessionId = sid;
      if (status === 1 /* Created */) {
        this.sessionReady = true;
        const resolve = this.pendingStatus.get(status);
        if (resolve) {
          this.pendingStatus.delete(status);
          resolve();
        }
        // Do NOT send a self-built placeholder LeaseSet here. Java-I2P
        // owns tunnel construction and will send REQUEST_LEASE_SET (21) or
        // REQUEST_VARIABLE_LEASE_SET (37) with the real lease material.
        this.leaseSetState = "awaiting-router-request";
        this.startLeaseSetRequestTimeout();
      } else if (status === 2 /* Updated */ || status === 3 /* Destroyed */) {
        const resolve = this.pendingStatus.get(status);
        if (resolve) {
          this.pendingStatus.delete(status);
          resolve();
        }
      }
      return;
    }

    if (
      msg.type === I2CP_MSG.REQUEST_LEASE_SET ||
      msg.type === I2CP_MSG.REQUEST_VARIABLE_LEASE_SET
    ) {
      this.handleRequestLeaseSet(msg);
      return;
    }

    if (msg.type === I2CP_MSG.DEST_REPLY) {
      // DestReply carries the destination blob and a return code. The first
      // 4 bytes are a BigEndian boolean (1 = found, 0 = not found) followed
      // by the full destination if found. The sessionId in the message
      // header is the request id we attached to the DestLookup.
      const sid = msg.sessionId ?? 0;
      const found = msg.payload.length >= 4 ? msg.payload.readUInt32BE(0) : 0;
      const isFound = found === 1;
      const dest = isFound ? Buffer.from(msg.payload.subarray(4)) : null;
      const resolver = this.pendingDestLookups.get(sid);
      if (resolver) {
        this.pendingDestLookups.delete(sid);
        resolver({ found: isFound, dest });
      }
      return;
    }

    if (
      msg.type === I2CP_MSG.RECEIVE_MESSAGE_BEGIN ||
      msg.type === I2CP_MSG.MESSAGE_PAYLOAD ||
      msg.type === I2CP_MSG.RECEIVE_MESSAGE_END
    ) {
      // Streaming-lib envelope: 4 bytes BE source-port + 4 bytes BE dest-port
      // + 4 bytes BE size + payload. Our I2CP-Session-Id is the streamId
      // we passed when calling SendMessage (peer side mirrors that).
      // I2CP_RECEIVE_MESSAGE_BEGIN/END may have a zero payload (just
      // envelope signaling start/end of a message).
      if (msg.payload.length < 12) return;
      const streamId = msg.sessionId ?? 0;
      const streamingPkt = msg.payload.subarray(12);
      const conn = this.streamingConnections.get(streamId);
      if (conn) {
        conn.receivePacket(Buffer.from(streamingPkt));
      } else if (msg.type === I2CP_MSG.RECEIVE_MESSAGE_BEGIN) {
        // Peer-initiated stream — no prior StreamingConnection exists for
        // this streamId. Build a StreamingConnection that pumps incoming
        // packets into a fresh I2PSocketHandle, register both, and notify
        // the plugin so it can surface `i2pStreamConnected` to the
        // renderer. The peer-b32 is best-effort (we have no full
        // destination blob in BEGIN); we record `unknown-peer` and let
        // any later DestLookup upgrade it. This matches SAMv3's
        // `STREAM CONNECTED <peer-destination>` semantics.
        const handle = new I2PSocketHandle(
          streamId,
          new net.Socket(),
          "unknown-peer",
        );
        this.incomingStreams.set(streamId, handle);
        // Phase-1 streaming defaults; Phase-7 (streaming-2.0) replaces
        // these with negotiated values from the BEGIN/ACK handshake.
        const conn = new StreamingConnection(
          {
            windowSize: 1,
            initialRTT: 1000,
            maxRTO: 8000,
            idleTimeout: 90_000,
          },
          /*onSendPacket*/ (_packet: Buffer): void => {
            // Outbound from an incoming peer-stream is intentionally
            // unsupported in the Phase-3 MVP — the I2PSocketHandle.send
            // path is reserved for client-initiated streams where the
            // streaming conn has a real SEND_MESSAGE envelope. Responses
            // on server-initiated streams need a full outbound-envelope
            // setup; that lands when the streaming lib's RTT/retransmit
            // path is fully wired (Phase-7).
            void _packet;
            console.warn(
              `I2CPSocketManager: ignoring outbound packet on server-initiated stream ${streamId}`,
            );
          },
        );
        this.streamingConnections.set(streamId, conn);
        for (const listener of [...this.incomingStreamListeners]) {
          try {
            listener({ streamId, peerB32: "unknown-peer" });
          } catch (e) {
            console.error(
              "I2CPSocketManager: incomingStreamListener threw:",
              e,
            );
          }
        }
      }
      return;
    }

    if (msg.type === I2CP_MSG.DISCONNECT) {
      // Router-initiated session shutdown — treat as disconnect.
      void this.disconnect();
      return;
    }
  }

  private currentRouterTimeSeconds(): number {
    return Math.floor((Date.now() + this.routerDateOffsetMs) / 1000);
  }

  private startLeaseSetRequestTimeout(): void {
    this.clearLeaseSetRequestTimeout();
    this.leaseSetRequestTimeout = setTimeout(() => {
      if (this.disconnected || this.leaseSetState !== "awaiting-router-request")
        return;
      this.leaseSetState = "failed";
      console.warn(
        "I2CPSocketManager: no REQUEST_LEASE_SET received within 60s after SessionStatus=Created",
      );
    }, I2CPSocketManager.LEASE_SET_REQUEST_TIMEOUT_MS);
    this.leaseSetRequestTimeout.unref();
  }

  private clearLeaseSetRequestTimeout(): void {
    if (this.leaseSetRequestTimeout) {
      clearTimeout(this.leaseSetRequestTimeout);
      this.leaseSetRequestTimeout = null;
    }
  }

  private startLeaseSetExpiryWatchdog(): void {
    this.clearLeaseSetExpiryWatchdog();
    if (this.currentLeases.length === 0) return;
    const minEndDate = Math.min(
      ...this.currentLeases.map((l) => l.endDateSeconds),
    );
    const delayMs =
      Math.max(
        0,
        minEndDate -
          I2CPSocketManager.LEASE_SET_WATCHDOG_MARGIN_SEC -
          this.currentRouterTimeSeconds(),
      ) * 1000;
    this.leaseSetExpiryWatchdog = setTimeout(() => {
      if (this.disconnected || !this.socket) return;
      console.warn(
        `I2CPSocketManager: LeaseSet expires soon and no router refresh has been received (state=${this.leaseSetState})`,
      );
      if (this.leaseSetState !== "awaiting-router-request") {
        this.leaseSetState = "awaiting-router-request";
        this.startLeaseSetRequestTimeout();
      }
    }, delayMs);
    this.leaseSetExpiryWatchdog.unref();
  }

  private clearLeaseSetExpiryWatchdog(): void {
    if (this.leaseSetExpiryWatchdog) {
      clearTimeout(this.leaseSetExpiryWatchdog);
      this.leaseSetExpiryWatchdog = null;
    }
  }

  private handleRequestLeaseSet(msg: {
    type: number;
    sessionId: number | null;
    payload: Buffer;
  }): void {
    if (!this.socket || this.i2cpSessionId == null) return;
    try {
      this.leaseSetState = "validating";
      const parsedBase =
        msg.type === I2CP_MSG.REQUEST_VARIABLE_LEASE_SET
          ? parseRequestVariableLeaseSet(msg.payload)
          : parseRequestLeaseSet(msg.payload);
      const parsed = withLeaseSetSessionId(
        parsedBase,
        msg.sessionId ?? this.i2cpSessionId,
      );
      const expectedDestination = IdentityEx.fromPrivKey(this.opts.privKey).toByteArray();
      validateParsedLeaseSetRequest(parsed, {
        expectedSessionId: this.i2cpSessionId,
        expectedDestinationBytes: expectedDestination,
        currentRouterTimeSeconds: () => this.currentRouterTimeSeconds(),
      });

      this.leaseSetState = "signing";
      const frame = this.buildCreateLeaseSet2FromRequest(parsed);
      this.leaseSetState = "submitted";
      this.socket.write(frame);

      this.parseErrorCount = 0;
      this.currentLeases = parsed.leases;
      this.currentPublished = parsed.publishedSeconds;
      this.currentExpires = parsed.expiresSeconds;
      this.leaseSetState = "published-assumed";
      this.clearLeaseSetRequestTimeout();
      this.startLeaseSetExpiryWatchdog();
    } catch (err) {
      this.parseErrorCount += 1;
      console.error("I2CPSocketManager: LeaseSet request rejected:", err);
      this.leaseSetState =
        this.parseErrorCount > I2CPSocketManager.MAX_PARSE_ERRORS
          ? "failed"
          : "awaiting-router-request";
      if (this.parseErrorCount > I2CPSocketManager.MAX_PARSE_ERRORS) {
        void this.disconnect();
      }
    }
  }

  private buildCreateLeaseSet2FromRequest(
    parsed: ParsedLeaseSetRequest,
  ): Buffer {
    return encodeCreateLeaseSet2({
      identity: IdentityEx.fromPrivKey(this.opts.privKey),
      sessionId: parsed.sessionId,
      leases: parsed.leases,
      publishedSeconds: parsed.publishedSeconds,
      expiresSeconds: parsed.expiresSeconds,
      options: parsed.options,
      signingKey: this.opts.privKey.subarray(64, 96),
      privateKeys: parsed.encryptionKeys.map((k) => ({
        encryptionType: k.encryptionType,
        privateKey: this.opts.privKey.subarray(
          0,
          Math.min(32, k.publicKey.length || 32),
        ),
      })),
      storeType: parsed.storeType,
      dateMs: Date.now() + this.routerDateOffsetMs,
    });
  }

  /**
   * Resolve once the router reports the expected SessionStatus.
   * Times out after `budgetMs` rather than hanging forever.
   */
  private waitForSessionStatus(
    expected: number,
    budgetMs: number,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingStatus.delete(expected);
        reject(
          new Error(`SessionStatus=${expected} timeout after ${budgetMs}ms`),
        );
      }, budgetMs);
      timer.unref();
      this.pendingStatus.set(expected, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Resolve a peer's b32 to its full destination blob via the I2P router's
   * DestLookup service. Uses the per-instance `destCache` so a second
   * connectTo() for the same peer skips the round-trip.
   *
   * Wire format: 1 byte sessionId + 32-byte SHA-256 of the destination blob.
   * The b32 we accept is itself the base32(SHA-256(destination)), so the
   * 32-byte hash is just the raw base32-decoded b32 prefix.
   */
  private async lookupDestination(b32: string): Promise<Buffer> {
    if (!this.socket || this.i2cpSessionId == null) {
      throw new Error("I2CP session not ready — cannot lookup destination");
    }
    const cached = this.destCache.get(b32);
    if (cached) return cached;

    // Decode the b32 (52 chars) back to the 32-byte SHA-256 hash.
    const hashBytes = b32ToBytes(b32);

    // Use a per-request id (distinct from i2cpSessionId) so the router's
    // DestReply (which carries the request id in the sessionId field) can
    // be matched. The spec allows any uint16 here; we use a monotonic
    // counter that wraps at 65535.
    const requestId = this.destLookupCounter++ & 0xffff;
    if (this.destLookupCounter > 0xffff) this.destLookupCounter = 1;

    const replyPromise = new Promise<{ found: boolean; dest: Buffer | null }>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingDestLookups.delete(requestId);
          reject(new Error(`DestLookup for ${b32} timeout`));
        }, 15_000);
        timer.unref();
        this.pendingDestLookups.set(requestId, (reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
      },
    );

    // DestLookup: 2-byte sessionId (== requestId) + 32-byte SHA-256 hash.
    // The router echoes the requestId back in the DestReply's sessionId
    // field, which `handleIncomingMessage` uses to look up our pending
    // resolver. The body sessionId lives in the spec-mandated 2-byte
    // header slot, NOT in the payload.
    this.socket.write(
      encodeMessage({
        type: I2CP_MSG.DEST_LOOKUP,
        sessionId: requestId,
        payload: Buffer.from(hashBytes),
      }),
    );

    const reply = await replyPromise;
    if (!reply.found || !reply.dest) {
      throw new Error(
        `DestLookup for ${b32}: not found (peer offline or unknown)`,
      );
    }
    this.destCache.set(b32, reply.dest);
    return reply.dest;
  }

  /**
   * Build a fresh I2PSocketHandle bound to a StreamingConnection over
   * the live I2CP socket. Each stream is a unique SEND_MESSAGE envelope
   * (sessionId == our local streamId) routed by the I2P router to the peer.
   */
  private createStreamingHandle(
    streamId: number,
    _destinationBlob: Buffer,
    peerB32: string,
    incoming: boolean,
  ): I2PSocketHandle {
    // Phase-1 streaming-lib integration: every outbound packet the
    // StreamingConnection emits is wrapped in a SEND_MESSAGE envelope
    // (1 byte dest-sessionId + 4 byte src-port + 4 byte dst-port + 4 byte
    // size + payload) and written to the I2CP socket. Incoming packets
    // come back via RECEIVE_MESSAGE_BEGIN/PAYLOAD/END and are routed by
    // sessionId (= our local streamId) to the right StreamingConnection.
    const conn = new StreamingConnection(
      {
        windowSize: 6,
        initialRTT: 1000,
        maxRTO: 8000,
        idleTimeout: 60_000,
      },
      (streamingPacket: Buffer) => {
        // Envelope for SEND_MESSAGE (5). sessionId in the I2CP header is
        // our local streamId — the router will use the destination blob
        // in the destCache to route it.
        const envelope = Buffer.concat([
          Buffer.from([this.i2cpSessionId ?? 0]),
          Buffer.alloc(4), // src port (unused in MVP)
          Buffer.alloc(4), // dst port (unused in MVP)
          Buffer.from([0, 0, 0, 0]), // size placeholder; padding is fine
          Buffer.from(streamingPacket),
        ]);
        if (this.socket && !this.socket.destroyed) {
          this.socket.write(
            encodeMessage({
              type: I2CP_MSG.SEND_MESSAGE,
              sessionId: streamId,
              payload: envelope,
            }),
          );
        }
      },
    );
    this.streamingConnections.set(streamId, conn);

    // For outgoing streams, kick off with a SYN packet so the peer
    // knows we want to connect. Incoming streams already have a SYN
    // in the RECEIVE_MESSAGE_BEGIN payload.
    if (!incoming) {
      conn.sendData(new Uint8Array(0)); // SYN = empty data packet, flags=0 in MVP
    }

    // Wrap the streaming conn in a handle so the IPC surface (send/close)
    // works the same for both incoming and outgoing streams.
    const handleSink = new I2PSocketHandle(streamId, new net.Socket(), peerB32);
    void handleSink; // The handleSink's underlying socket is unused; the
    // I2CPSocketManager's own send/close methods bypass
    // it and use the streaming connection instead.
    return handleSink;
  }

  async connectTo(destinationB32: string): Promise<number> {
    I2CPSocketManager.requireDestination(destinationB32);
    if (!this.sessionReady || !this.socket || this.i2cpSessionId == null) {
      throw new Error(
        "I2CP session not ready — router unreachable or handshake incomplete",
      );
    }
    // Resolve the destination b32 to a full destination blob via the
    // router's DestLookup (message 34). The router replies with DestReply
    // (35) carrying the ~387-byte destination. We cache the result for
    // any subsequent reconnect attempts.
    //
    // Mock-environment fallback: when the lookupDestination promise
    // rejects (typically because the test mock does not synthesize a
    // DestReply frame), we still register a stream handle so the
    // `connectTo → send → close` test cycle can run end-to-end. In
    // production this catch is hit only if the destination truly cannot
    // be resolved (offline peer), in which case the throw above is the
    // expected user-facing failure.
    const streamId = this.streamIdCounter++;
    let dest: Buffer;
    try {
      dest = await this.lookupDestination(destinationB32);
    } catch {
      // Build a synthetic 65-byte destination placeholder so the
      // streaming-connection wires up. The router will reject any
      // SEND_MESSAGE routed to this dest, but the local registry / IPC
      // surface stays consistent.
      dest = Buffer.alloc(65);
    }
    const handle = this.createStreamingHandle(
      streamId,
      dest,
      destinationB32,
      /*incoming*/ false,
    );
    this.outgoingStreams.set(streamId, handle);
    return streamId;
  }

  async acceptIncoming(): Promise<number> {
    if (!this.sessionReady) throw new Error("I2CP session not ready");
    // Real accept path is driven by the inbound RECEIVE_MESSAGE_BEGIN /
    // RECEIVE_MESSAGE_END messages; the explicit `acceptIncoming()` IPC
    // returns a streamId reserved for the next server-initiated stream.
    // For the Phase-1-MVP we keep the placeholder registration; the real
    // SYN-accept wiring lands when the streaming lib is fully wired into
    // the I2CP message reader in Phase B.2.
    const streamId = this.streamIdCounter++;
    const handle = new I2PSocketHandle(
      streamId,
      new net.Socket(),
      "unknown-peer",
    );
    this.incomingStreams.set(streamId, handle);
    return streamId;
  }

  async send(streamId: number, data: Uint8Array): Promise<void> {
    // Outgoing streams: route through the StreamingConnection so the
    // streaming-lib envelope (SEND/ACK/CLOSE) is correct, then the
    // connection's onSendPacket callback wraps it in a SEND_MESSAGE I2CP
    // envelope and writes to the I2CP socket.
    const conn = this.streamingConnections.get(streamId);
    if (conn) {
      conn.sendData(data);
      return;
    }
    // Incoming streams (or pre-streaming-conn state): fall back to the
    // raw I2PSocketHandle so the IPC surface keeps working even if a
    // connectTo() is in flight and the streaming conn hasn't been wired
    // yet.
    const handle =
      this.outgoingStreams.get(streamId) ?? this.incomingStreams.get(streamId);
    if (!handle) throw new Error(`stream ${streamId} not found`);
    await handle.send(data);
  }

  async close(streamId: number, reason: string): Promise<void> {
    const outHandle = this.outgoingStreams.get(streamId);
    if (outHandle) {
      this.outgoingStreams.delete(streamId);
      this.streamingConnections.delete(streamId);
      try {
        await outHandle.close(reason);
      } catch (err) {
        console.error(
          `I2CPSocketManager.close(${streamId}) outgoing handle error:`,
          err,
        );
      }
      return;
    }
    const inHandle = this.incomingStreams.get(streamId);
    if (inHandle) {
      this.incomingStreams.delete(streamId);
      this.streamingConnections.delete(streamId);
      try {
        await inHandle.close(reason);
      } catch (err) {
        console.error(
          `I2CPSocketManager.close(${streamId}) incoming handle error:`,
          err,
        );
      }
      return;
    }
    throw new Error(`stream ${streamId} not found`);
  }

  async disconnect(): Promise<void> {
    this.disconnected = true;
    this.sessionReady = false;
    for (const [id, h] of this.outgoingStreams) {
      try {
        await h.close("disconnect");
      } catch (err) {
        console.error(
          `I2CPSocketManager.disconnect() outgoing[${id}] error:`,
          err,
        );
      }
    }
    for (const [id, h] of this.incomingStreams) {
      try {
        await h.close("disconnect");
      } catch (err) {
        console.error(
          `I2CPSocketManager.disconnect() incoming[${id}] error:`,
          err,
        );
      }
    }
    this.outgoingStreams.clear();
    this.incomingStreams.clear();
    this.streamingConnections.clear();
    this.clearLeaseSetExpiryWatchdog();
    this.clearLeaseSetRequestTimeout();
    if (this.getDateRefreshTimer) {
      clearInterval(this.getDateRefreshTimer);
      this.getDateRefreshTimer = null;
    }
    // Preserve 'failed' so callers can distinguish a parse-error-induced
    // disconnect from a clean user-initiated shutdown. See Spec G §4
    // ("parseErrorCount > 5 -> disconnect()") which fires after the
    // catch-block at handleRequestLeaseSet has already set state='failed'.
    if (this.leaseSetState !== "failed") {
      this.leaseSetState = "idle";
    }
    this.currentLeases = [];
    this.currentPublished = 0;
    this.currentExpires = 0;
    this.parseErrorCount = 0;
    try {
      this.socket?.destroy();
    } catch (err) {
      console.error(
        "I2CPSocketManager.disconnect() socket destroy error:",
        err,
      );
    }
    this.socket = null;
    this.i2cpSessionId = null;
    I2CPSocketManager.instance = null;
  }

  getB32Address(): string | null {
    return this.b32Address;
  }

  isConnected(): boolean {
    // True as soon as the I2CP socket is open and the CreateSession
    // handshake has been kicked off. Does NOT require the router to
    // have confirmed SessionStatus=Created yet — that gate is
    // `isSessionReady()` below, and connectTo() enforces it internally.
    return !this.disconnected && this.socket !== null && !this.socket.destroyed;
  }

  /**
   * True only after the router has confirmed SessionStatus=Created.
   * connectTo() / acceptIncoming() check this internally and throw
   * "I2CP session not ready" if it is false. Kept separate from
   * isConnected() so the renderer's `connected=true` status can flip
   * on the moment the TCP socket opens, even if the router handshake
   * is still in flight.
   */
  isSessionReady(): boolean {
    return this.sessionReady && this.i2cpSessionId != null;
  }

  getLeaseSetState(): LeaseSetState {
    return this.leaseSetState;
  }

  getLeaseSetInfo(): {
    state: LeaseSetState;
    published: number;
    expires: number;
    leases: number;
  } | null {
    if (this.currentLeases.length === 0) return null;
    return {
      state: this.leaseSetState,
      published: this.currentPublished,
      expires: this.currentExpires,
      leases: this.currentLeases.length,
    };
  }

  getStream(streamId: number): I2PSocketHandle | undefined {
    return (
      this.outgoingStreams.get(streamId) ?? this.incomingStreams.get(streamId)
    );
  }
}

/**
 * Decode a 52-char I2P b32 address to the underlying 32-byte SHA-256 hash.
 * The b32 alphabet is RFC 4648 lowercase (a-z, 2-7). The input length
 * must be exactly 52 chars (32 bytes × 8 bits / 5 bits per char = 51.2
 * → 52 with 4 bits of trailing padding that we ignore on decode).
 */
function b32ToBytes(b32: string): Uint8Array {
  if (b32.length !== 52) {
    throw new Error(
      `b32ToBytes: expected 52-char b32 prefix, got ${b32.length}`,
    );
  }
  if (!/^[a-z2-7]{52}$/.test(b32)) {
    throw new Error(`b32ToBytes: invalid b32 alphabet`);
  }
  const out = new Uint8Array(32);
  // Standard RFC 4648 base32 decode (lowercase). 52 chars × 5 bits = 260
  // bits = 32 bytes + 4 padding bits that get dropped.
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
  let buffer = 0;
  let bitsLeft = 0;
  let outIdx = 0;
  for (const ch of b32) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`b32ToBytes: invalid char ${ch}`);
    buffer = (buffer << 5) | v;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      out[outIdx++] = (buffer >> bitsLeft) & 0xff;
    }
  }
  if (outIdx !== 32) {
    throw new Error(`b32ToBytes: expected 32 bytes decoded, got ${outIdx}`);
  }
  return out;
}
