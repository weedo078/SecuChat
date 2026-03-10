package com.secuchat.app.plugin.SAMPlugin.events;

import com.getcapacitor.JSObject;
import com.secuchat.app.plugin.SAMPlugin.EventNotifier;

import android.os.Handler;
import android.os.Looper;

import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Event emitter for SAM (Simple Anonymous Messaging) plugin.
 * Bridges native SAM events to Capacitor JavaScript layer.
 * Thread-safe: events can be emitted from background threads.
 */
public class SAMEventEmitter {

    private final EventNotifier notifier;
    private final Handler mainHandler;
    private final CopyOnWriteArrayList<String> activeEventListeners;

    // Event names matching the TypeScript interface
    public static final String EVENT_MESSAGE = "message";
    public static final String EVENT_STREAM_CONNECTED = "streamConnected";
    public static final String EVENT_STREAM_CLOSED = "streamClosed";
    public static final String EVENT_ERROR = "error";

    public SAMEventEmitter(EventNotifier notifier) {
        this.notifier = notifier;
        this.mainHandler = new Handler(Looper.getMainLooper());
        this.activeEventListeners = new CopyOnWriteArrayList<>();
    }

    /**
     * Register an event listener type.
     * Called when JavaScript side adds a listener.
     */
    public void addEventListener(String eventName) {
        if (!activeEventListeners.contains(eventName)) {
            activeEventListeners.add(eventName);
        }
    }

    /**
     * Unregister an event listener type.
     * Called when JavaScript side removes a listener.
     */
    public void removeEventListener(String eventName) {
        activeEventListeners.remove(eventName);
    }

    /**
     * Check if there are active listeners for an event.
     */
    public boolean hasListeners(String eventName) {
        return activeEventListeners.contains(eventName);
    }

    /**
     * Emit a message event to JavaScript.
     * Thread-safe: can be called from background threads.
     */
    public void emitMessage(String from, String data, int streamId) {
        if (!hasListeners(EVENT_MESSAGE)) {
            return;
        }

        SAMMessageEvent event = new SAMMessageEvent(from, data, streamId);
        emitOnMainThread(EVENT_MESSAGE, event.toJSObject());
    }

    /**
     * Emit a stream connected event to JavaScript.
     * Thread-safe: can be called from background threads.
     */
    public void emitStreamConnected(String peerDestination, int streamId) {
        if (!hasListeners(EVENT_STREAM_CONNECTED)) {
            return;
        }

        SAMConnectionEvent event = SAMConnectionEvent.streamConnected(peerDestination, streamId);
        emitOnMainThread(EVENT_STREAM_CONNECTED, event.toJSObject());
    }

    /**
     * Emit a stream closed event to JavaScript.
     * Thread-safe: can be called from background threads.
     */
    public void emitStreamClosed(int streamId, String reason) {
        if (!hasListeners(EVENT_STREAM_CLOSED)) {
            return;
        }

        SAMConnectionEvent event = SAMConnectionEvent.streamClosed(streamId, reason);
        emitOnMainThread(EVENT_STREAM_CLOSED, event.toJSObject());
    }

    /**
     * Emit an error event to JavaScript.
     * Thread-safe: can be called from background threads.
     */
    public void emitError(String error, String code, int streamId) {
        if (!hasListeners(EVENT_ERROR)) {
            return;
        }

        SAMConnectionEvent event = SAMConnectionEvent.error(error, code, streamId);
        emitOnMainThread(EVENT_ERROR, event.toJSObject());
    }

    /**
     * Emit event on the main thread.
     * Capacitor's notifyListeners must be called on the main thread.
     */
    private void emitOnMainThread(String eventName, JSObject data) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            // Already on main thread
            notifier.notify(eventName, data);
        } else {
            // Post to main thread
            mainHandler.post(() -> notifier.notify(eventName, data));
        }
    }

    /**
     * Clear all event listeners.
     * Called when plugin is destroyed.
     */
    public void clearListeners() {
        activeEventListeners.clear();
    }
}
