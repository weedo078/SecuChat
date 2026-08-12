package com.secuchat.app.plugin.I2PPlugin;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import net.i2p.client.streaming.I2PSocket;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "I2P")
public class I2PPlugin extends Plugin {
    private static final String TAG = "SecuChat:I2CP";
    private I2CPSocketManager socketManager;
    private IdentityStore identityStore;
    // Capacitor 8 removed Bridge.getExecutor(); use a private cached pool instead.
    private final ExecutorService ioExecutor = Executors.newCachedThreadPool();

    // Bounded ring-buffer of i2pMessage / i2pStreamConnected / i2pStreamClosed
    // events that fired before the WebView registered its addListener().
    //
    // Why this exists: on first boot (or after force-stop), I2PPlugin.start()
    // is async and blocks 5–15s on session.connect() + LeaseSet publish. If
    // the peer messages us during that window, the read thread calls
    // notifyListeners() — but Capacitor has no listener attached, so the
    // event is silently dropped on the floor. The receiver never sees the
    // message.
    //
    // Bound at 64 entries to keep memory under control on a busy tunnel;
    // old entries are evicted FIFO. After the JS layer subscribes (via
    // addListener), we drain the buffer through notifyListeners() in order.
    private static final int BUFFER_CAPACITY = 64;
    private final Deque<BufferedEvent> eventBuffer = new ArrayDeque<>();

    private record BufferedEvent(String name, JSObject data) {}

    private void emitOrBuffer(String name, JSObject data) {
        // Capacitor's notifyListeners() is fire-and-forget when no JS
        // listener is attached — the event is silently dropped. To recover
        // from the bootstrap race (start() blocks 5–15s on session.connect,
        // but acceptIncoming can fire mid-boot), we buffer everything and
        // let the notifyListeners() override flush the buffer the first
        // time a listener actually exists.
        synchronized (eventBuffer) {
            if (eventBuffer.size() >= BUFFER_CAPACITY) {
                eventBuffer.pollFirst(); // drop oldest
            }
            eventBuffer.offerLast(new BufferedEvent(name, data));
        }
        super.notifyListeners(name, data);
    }

    private void drainBuffer() {
        synchronized (eventBuffer) {
            BufferedEvent ev;
            while ((ev = eventBuffer.pollFirst()) != null) {
                notifyListeners(ev.name, ev.data);
            }
        }
    }

    // Capacitor's notifyListeners() is fire-and-forget when no listener is
    // attached — the event is silently dropped. By the time a JS listener
    // appears, anything that fired during the bootstrap race is gone. We
    // override notifyListeners() to detect the first arrival of a real
    // listener and flush whatever we buffered. Check after the super-call
    // so the listener the JS just added is already in Capacitor's registry.
    @Override
    public void notifyListeners(String eventName, JSObject data) {
        super.notifyListeners(eventName, data);
        if (eventName != null
            && (eventName.equals("i2pMessage")
                || eventName.equals("i2pStreamConnected")
                || eventName.equals("i2pStreamClosed"))
            && hasListeners(eventName)) {
            drainBuffer();
        }
    }

    @Override
    public void load() {
        identityStore = new IdentityStore(getContext());
    }

    @PluginMethod
    public void start(PluginCall call) {
        String host = call.getString("host", "127.0.0.1");
        int port = call.getInt("port", 7654);
        String nickname = call.getString("nickname", "SecuChat");

        if (!PackagePresence.isI2pAppInstalled(getContext())) {
            call.reject("I2P-App nicht installiert. Bitte installiere: " + PackagePresence.getPlayStoreUrl());
            return;
        }

        ioExecutor.execute(() -> {
            try {
                byte[] privKey = identityStore.loadOrNull();
                if (privKey == null) {
                    // Generiere neue Destination via factory
                    net.i2p.client.I2PClient client = net.i2p.client.I2PClientFactory.createClient();
                    java.io.ByteArrayOutputStream keys = new java.io.ByteArrayOutputStream(1024);
                    client.createDestination(keys, net.i2p.crypto.SigType.EdDSA_SHA512_Ed25519);
                    privKey = keys.toByteArray();
                    identityStore.save(privKey);
                    // Validate the save: IdentityStore.save() swallows IOException, so a
                    // disk-full or permissions failure leaves an in-memory-only destination;
                    // on next start loadOrNull() returns null and a NEW b32 is generated,
                    // silently losing the previous address and breaking peer routing.
                    // The on-disk format is [16-byte salt][12-byte IV][privKey]; loadOrNull
                    // returns the bytes after the header, so a successful save round-trips
                    // to saved.length == privKey.length.
                    byte[] saved = identityStore.loadOrNull();
                    if (saved == null || saved.length != privKey.length) {
                        call.reject("Failed to persist I2P identity (disk full or permission denied)");
                        return;
                    }
                }
                socketManager = I2CPSocketManager.getOrCreate(host, port, privKey, nickname);
                startAcceptLoop();

                JSObject result = new JSObject();
                result.put("b32Address", socketManager.getB32Address());
                notifyListeners("i2pStatus", new JSObject().put("connected", true).put("b32Address", socketManager.getB32Address()));
                call.resolve(result);
            } catch (IOException | net.i2p.I2PException e) {
                call.reject("I2CP start failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void connectTo(PluginCall call) {
        String destination = call.getString("destination");
        if (destination == null) { call.reject("destination required"); return; }
        if (socketManager == null) { call.reject("not started"); return; }

        ioExecutor.execute(() -> {
            try {
                int streamId = socketManager.connectTo(destination);
                I2PSocketHandle handle = socketManager.getStream(streamId);
                if (handle == null) { call.reject("handle null"); return; }
                handle.setOnData(ev -> {
                    JSObject data = new JSObject();
                    data.put("streamId", ev.streamId);
                    data.put("data", new String(ev.data));
                    emitOrBuffer("i2pMessage", data);
                });
                handle.setOnClose(ev -> {
                    JSObject close = new JSObject();
                    close.put("streamId", ev.streamId);
                    close.put("reason", ev.reason);
                    emitOrBuffer("i2pStreamClosed", close);
                });
                handle.startReadThread();

                JSObject result = new JSObject();
                result.put("streamId", streamId);
                emitOrBuffer("i2pStreamConnected",
                    new JSObject().put("streamId", streamId).put("peerDestination", destination));
                call.resolve(result);
            } catch (IOException e) {
                call.reject("connectTo failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void acceptIncoming(PluginCall call) {
        // Sync: blockt nicht, wir haben den Loop in start() gestartet
        call.resolve();
    }

    @PluginMethod
    public void send(PluginCall call) {
        int streamId = call.getInt("streamId");
        String data = call.getString("data");
        if (socketManager == null) { call.reject("not started"); return; }

        ioExecutor.execute(() -> {
            try {
                socketManager.send(streamId, (data + "\n").getBytes("UTF-8"));
                com.getcapacitor.JSObject ret = new com.getcapacitor.JSObject();
                ret.put("success", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("send failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        int streamId = call.getInt("streamId");
        String reason = call.getString("reason", "user closed");
        if (socketManager == null) { call.reject("not started"); return; }

        ioExecutor.execute(() -> {
            try {
                socketManager.close(streamId, reason);
                call.resolve();
            } catch (IOException e) {
                call.reject("close failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        // I2CPSocketManager.disconnect() is synchronized; connectTo() holds that lock
        // during session.lookupDest(..., 15_000), so a synchronous disconnect could
        // block the calling (plugin/UI) thread for up to ~15s. Dispatch the body to
        // ioExecutor and resolve after completion.
        ioExecutor.execute(() -> {
            if (socketManager != null) {
                socketManager.disconnect();
                socketManager = null;
            }
            notifyListeners("i2pStatus", new JSObject().put("connected", false));
            call.resolve();
        });
    }

    /**
     * Reports whether the I2P router app (net.i2p.android) is installed, so the
     * web layer can block onboarding with an install prompt instead of failing
     * later in start().
     */
    @PluginMethod
    public void isI2pAppInstalled(PluginCall call) {
        JSObject result = new JSObject();
        result.put("installed", PackagePresence.isI2pAppInstalled(getContext()));
        call.resolve(result);
    }

    /**
     * Returns the live b32 address of the active SAM session. The bridge uses
     * this as the single source of truth for the user's own b32 — without it,
     * the JS layer would read a stale b32 from the User object in storage
     * that doesn't match what i2pd actually publishes, and every STREAM
     * CONNECT to a peer would fail with "LeaseSet not found".
     */
    @PluginMethod
    public void getB32Address(PluginCall call) {
        if (socketManager == null) {
            call.reject("not started");
            return;
        }
        JSObject result = new JSObject();
        result.put("b32Address", socketManager.getB32Address());
        call.resolve(result);
    }

    private void startAcceptLoop() {
        if (socketManager == null) return;
        ExecutorService ex = socketManager.getExecutor();
        ex.execute(() -> {
            while (socketManager != null && socketManager.isConnected()) {
                try {
                    int streamId = socketManager.acceptIncoming();
                    I2PSocketHandle handle = socketManager.getStream(streamId);
                    if (handle != null) {
                        handle.setOnData(ev -> {
                            JSObject data = new JSObject();
                            data.put("streamId", ev.streamId);
                            data.put("type", "incoming");
                            data.put("peerDestination", handle.getPeerDestination());
                            data.put("data", new String(ev.data));
                            emitOrBuffer("i2pMessage", data);
                        });
                        handle.setOnClose(ev -> {
                            JSObject close = new JSObject();
                            close.put("streamId", ev.streamId);
                            close.put("reason", ev.reason);
                            emitOrBuffer("i2pStreamClosed", close);
                        });
                        handle.startReadThread();
                        emitOrBuffer("i2pStreamConnected",
                            new JSObject().put("streamId", streamId)
                                .put("peerDestination", handle.getPeerDestination())
                                .put("type", "incoming"));
                    }
                } catch (IOException e) {
                    if (socketManager != null && socketManager.isConnected()) {
                        try { Thread.sleep(3000); } catch (InterruptedException ignored) {}
                    }
                }
            }
        });
    }
}