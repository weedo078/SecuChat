package com.secuchat.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.secuchat.app.plugin.I2PPlugin.I2PPlugin;
import com.secuchat.app.power.PowerManagementPlugin;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "SecuChat:MainActivity";
    private String pendingContactData = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom plugins before super.onCreate
        registerPlugin(PowerManagementPlugin.class);
        registerPlugin(I2PPlugin.class);

        super.onCreate(savedInstanceState);

        // Configure window to handle edge-to-edge display properly
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);

        // Set status bar to dark icons (light background) or light icons (dark background)
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(false); // false = light icons (for dark background)
        }

        // Ensure content doesn't go behind status bar
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_DEFAULT);
            }
        }

        // Handle intent that launched the app (file open from file manager)
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) return;

        Uri data = intent.getData();
        if (data == null) return;

        try {
            // Handle secuchat:// deep links
            if ("secuchat".equals(data.getScheme())) {
                Log.d(TAG, "Deep link: " + data);
                // Let Capacitor handle deep links via appUrlOpen event
                return;
            }

            // Handle file:// or content:// URIs (.secuchat files from file manager)
            String scheme = data.getScheme();
            if ("file".equals(scheme) || "content".equals(scheme)) {
                Log.d(TAG, "File open intent: " + data);
                String content = readFileFromUri(data);
                if (content != null) {
                    pendingContactData = content;
                    notifyContactImport(content);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error handling intent: " + e.getMessage(), e);
        }
    }

    private String readFileFromUri(Uri uri) {
        try {
            InputStream is = getContentResolver().openInputStream(uri);
            if (is == null) return null;
            BufferedReader reader = new BufferedReader(new InputStreamReader(is));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            reader.close();
            return sb.toString();
        } catch (Exception e) {
            Log.e(TAG, "Error reading file: " + e.getMessage(), e);
            return null;
        }
    }

    private void notifyContactImport(String contactData) {
        String escaped = escapeJsonString(contactData);
        String js = "window.dispatchEvent(new CustomEvent('secuchat-contact-import', { detail: " + escaped + " }))";
        getBridge().eval(js, null);
    }

    private String escapeJsonString(String s) {
        return "\"" + s
                .replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t")
                + "\"";
    }
}
