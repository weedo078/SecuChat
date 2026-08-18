package com.secuchat.app.power;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PowerManagement")
public class PowerManagementPlugin extends Plugin {

    private static final String EVENT_DOZE_MODE_CHANGE = "dozeModeChange";
    private static final String EVENT_POWER_SAVE_MODE_CHANGE = "powerSaveModeChange";

    private PowerManager powerManager;
    private android.os.PowerManager.WakeLock wakeLock;

    @Override
    public void load() {
        powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
    }

    /**
     * Check if the app is ignoring battery optimizations
     */
    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            // Before Android M, battery optimizations don't exist
            JSObject result = new JSObject();
            result.put("isIgnoring", true);
            call.resolve(result);
            return;
        }

        String packageName = getContext().getPackageName();
        boolean isIgnoring = powerManager.isIgnoringBatteryOptimizations(packageName);

        JSObject result = new JSObject();
        result.put("isIgnoring", isIgnoring);
        call.resolve(result);
    }

    /**
     * Request battery optimization exemption
     */
    @PluginMethod
    public void requestBatteryOptimizations(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
            return;
        }

        String packageName = getContext().getPackageName();
        if (powerManager.isIgnoringBatteryOptimizations(packageName)) {
            // Already ignoring
            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
            return;
        }

        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + packageName));
            getActivity().startActivity(intent);

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to request battery optimizations: " + e.getMessage());
        }
    }

    /**
     * Open battery optimization settings for this app
     */
    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to open settings: " + e.getMessage());
        }
    }

    /**
     * Acquire a partial wake lock
     */
    @PluginMethod
    public void acquireWakeLock(PluginCall call) {
        // Release existing wake lock if held
        releaseWakeLockInternal();

        int timeout = call.getInt("timeout", 10 * 60 * 1000); // Default 10 minutes

        try {
            // Use partial wake lock - keeps CPU running but allows screen to turn off
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "SecuChat::I2PConnectionWakeLock"
            );

            if (timeout > 0) {
                wakeLock.acquire(timeout);
            } else {
                wakeLock.acquire();
            }

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to acquire wake lock: " + e.getMessage());
        }
    }

    /**
     * Release the wake lock
     */
    @PluginMethod
    public void releaseWakeLock(PluginCall call) {
        releaseWakeLockInternal();
        call.resolve();
    }

    private void releaseWakeLockInternal() {
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception e) {
                // Ignore release errors
            }
            wakeLock = null;
        }
    }

    /**
     * Check if wake lock is held
     */
    @PluginMethod
    public void isWakeLockHeld(PluginCall call) {
        boolean held = wakeLock != null && wakeLock.isHeld();

        JSObject result = new JSObject();
        result.put("held", held);
        call.resolve(result);
    }

    /**
     * Check if device is in idle mode (Doze)
     */
    @PluginMethod
    public void isDeviceIdleMode(PluginCall call) {
        boolean isIdle = false;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            isIdle = powerManager.isDeviceIdleMode();
        }

        JSObject result = new JSObject();
        result.put("isIdle", isIdle);
        call.resolve(result);
    }

    /**
     * Check if device is in power save mode
     */
    @PluginMethod
    public void isPowerSaveMode(PluginCall call) {
        boolean isPowerSaveMode = powerManager.isPowerSaveMode();

        JSObject result = new JSObject();
        result.put("isPowerSaveMode", isPowerSaveMode);
        call.resolve(result);
    }

    @Override
    protected void handleOnDestroy() {
        // Release wake lock when plugin is destroyed
        releaseWakeLockInternal();
        super.handleOnDestroy();
    }

    @Override
    protected void handleOnPause() {
        // Keep wake lock during pause - this is important for I2P
        super.handleOnPause();
    }

    @Override
    protected void handleOnResume() {
        // Refresh wake lock on resume if needed
        super.handleOnResume();
    }
}
