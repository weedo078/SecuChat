package com.secuchat.app.plugin.SAMPlugin;

import com.getcapacitor.JSObject;

/**
 * Interface for notifying JavaScript listeners from native code.
 * Decouples event emitters from the Capacitor Plugin class.
 */
public interface EventNotifier {
    /**
     * Notify JavaScript listeners of an event.
     *
     * @param eventName The event name
     * @param data The event data
     */
    void notify(String eventName, JSObject data);
}
