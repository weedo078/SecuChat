package com.secuchat.app;

import android.os.Build;
import android.os.Bundle;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.secuchat.app.plugin.SAMPlugin.SAMPlugin;
import com.secuchat.app.power.PowerManagementPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom plugins before super.onCreate
        registerPlugin(SAMPlugin.class);
        registerPlugin(PowerManagementPlugin.class);

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
        // Use WindowInsetsController for API 30+, deprecated setSystemUiVisibility for older versions
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_DEFAULT);
            }
        }
    }
}
