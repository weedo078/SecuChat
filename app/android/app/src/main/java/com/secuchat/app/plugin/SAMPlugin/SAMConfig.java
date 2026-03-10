package com.secuchat.app.plugin.SAMPlugin;

import android.util.Log;

/**
 * Configuration POJO for SAM (Simple Anonymous Messaging) connection.
 * Stores connection parameters for the I2P SAM bridge.
 */
public class SAMConfig {

    private static final String TAG = "SecuChat:SAM";
    private String host;
    private int port;
    private boolean enabled;

    public SAMConfig() {
        this.host = "127.0.0.1";
        this.port = 7656;
        this.enabled = false;
    }

    public SAMConfig(String host, int port, boolean enabled) {
        this.host = host;
        this.port = port;
        this.enabled = enabled;
        Log.d(TAG, "SAMConfig created: host=" + host + ", port=" + port + ", enabled=" + enabled);
    }

    public String getHost() {
        return host;
    }

    public void setHost(String host) {
        this.host = host;
    }

    public int getPort() {
        return port;
    }

    public void setPort(int port) {
        this.port = port;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    @Override
    public String toString() {
        return "SAMConfig{host='" + host + "', port=" + port + ", enabled=" + enabled + "}";
    }
}
