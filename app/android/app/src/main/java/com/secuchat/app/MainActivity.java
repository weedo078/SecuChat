package com.secuchat.app;

import android.os.Bundle;
import android.view.View;
import android.view.Window;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.secuchat.app.plugin.SAMPlugin.SAMPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom plugins before super.onCreate
        registerPlugin(SAMPlugin.class);

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
        window.getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        );
    }
}
