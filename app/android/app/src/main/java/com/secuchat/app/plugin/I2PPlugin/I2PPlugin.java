package com.secuchat.app.plugin.I2PPlugin;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import net.i2p.client.streaming.I2PSocket;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "I2P")
public class I2PPlugin extends Plugin {
    private static final String TAG = "SecuChat:I2CP";
    private I2CPSocketManager socketManager;
    private IdentityStore identityStore;
    // Capacitor 8 removed Bridge.getExecutor(); use a private cached pool instead.
    private final ExecutorService ioExecutor = Executors.newCachedThreadPool();

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
                    notifyListeners("i2pMessage", data);
                });
                handle.setOnClose(ev -> {
                    JSObject close = new JSObject();
                    close.put("streamId", ev.streamId);
                    close.put("reason", ev.reason);
                    notifyListeners("i2pStreamClosed", close);
                });
                handle.startReadThread();

                JSObject result = new JSObject();
                result.put("streamId", streamId);
                notifyListeners("i2pStreamConnected", new JSObject().put("streamId", streamId).put("peerDestination", destination));
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
                call.resolve();
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
        if (socketManager != null) {
            socketManager.disconnect();
            socketManager = null;
        }
        notifyListeners("i2pStatus", new JSObject().put("connected", false));
        call.resolve();
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
                            notifyListeners("i2pMessage", data);
                        });
                        handle.setOnClose(ev -> {
                            JSObject close = new JSObject();
                            close.put("streamId", ev.streamId);
                            close.put("reason", ev.reason);
                            notifyListeners("i2pStreamClosed", close);
                        });
                        handle.startReadThread();
                        notifyListeners("i2pStreamConnected", new JSObject().put("streamId", streamId).put("peerDestination", handle.getPeerDestination()).put("type", "incoming"));
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