package com.secuchat.app.plugin.I2PPlugin;

import net.i2p.client.streaming.I2PSocket;

import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

import android.util.Log;

public class I2PSocketHandle {
    private static final String TAG = "SecuChat:I2CP";

    private final int streamId;
    private final I2PSocket socket;
    private final String peerDestination;
    private final ExecutorService executor;
    private final AtomicBoolean closed = new AtomicBoolean(false);
    private final AtomicBoolean readSubmitted = new AtomicBoolean(false);
    // Volatile: setOnData/setOnClose may be invoked from another thread (e.g.
    // the accept-loop calling thread) while the read-loop (running on the
    // executor) is consuming them. Without volatile, the read-loop may never
    // observe the assignment and silently drop events.
    private volatile Consumer<DataEvent> onData;
    private volatile Consumer<CloseEvent> onClose;
    private volatile Future<?> readFuture;

    public I2PSocketHandle(int streamId, I2PSocket socket, String serverSocketTag, String peerDestination, ExecutorService executor) {
        this.streamId = streamId;
        this.socket = socket;
        this.peerDestination = peerDestination;
        this.executor = executor;
    }

    public int getStreamId() { return streamId; }
    public I2PSocket getSocket() { return socket; }
    public String getPeerDestination() { return peerDestination; }
    public boolean isClosed() { return closed.get(); }

    public void setOnData(Consumer<DataEvent> onData) { this.onData = onData; }
    public void setOnClose(Consumer<CloseEvent> onClose) { this.onClose = onClose; }

    public void startReadThread() {
        // Idempotent: only the first caller submits the read loop. Subsequent
        // calls are no-ops. Replaces the prior "new Thread(...)" path so the
        // executor actually owns the read task — that way disconnect()'s
        // executor.shutdownNow() interrupts the blocked read() instead of
        // leaving orphan daemon threads behind.
        if (!readSubmitted.compareAndSet(false, true)) return;
        readFuture = executor.submit(() -> {
            try {
                InputStream in = socket.getInputStream();
                byte[] buf = new byte[8192];
                int n;
                while (!closed.get() && (n = in.read(buf)) != -1) {
                    byte[] data = new byte[n];
                    System.arraycopy(buf, 0, data, 0, n);
                    Consumer<DataEvent> cb = onData;
                    if (cb != null) cb.accept(new DataEvent(streamId, data));
                }
            } catch (IOException e) {
                if (!closed.get()) Log.w(TAG, "read error on stream " + streamId + ": " + e.getMessage());
            } finally {
                String reason = closed.get() ? "closed" : "peer disconnected";
                Consumer<CloseEvent> cb = onClose;
                if (cb != null) cb.accept(new CloseEvent(streamId, reason));
            }
        });
    }

    public void close(String reason) {
        if (closed.compareAndSet(false, true)) {
            try { socket.close(); } catch (IOException ignored) {}
        }
    }

    public static class DataEvent {
        public final int streamId;
        public final byte[] data;
        public DataEvent(int streamId, byte[] data) { this.streamId = streamId; this.data = data; }
    }

    public static class CloseEvent {
        public final int streamId;
        public final String reason;
        public CloseEvent(int streamId, String reason) { this.streamId = streamId; this.reason = reason; }
    }
}
