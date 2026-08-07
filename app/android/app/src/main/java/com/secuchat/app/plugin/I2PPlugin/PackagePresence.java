// app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin/PackagePresence.java
package com.secuchat.app.plugin.I2PPlugin;

import android.content.Context;
import android.content.pm.PackageManager;

public class PackagePresence {
    private static final String I2P_APP_PACKAGE = "net.i2p.android";
    private static final String PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=net.i2p.android";

    public static boolean isI2pAppInstalled(Context context) {
        try {
            context.getPackageManager().getPackageInfo(I2P_APP_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    public static String getPlayStoreUrl() {
        return PLAY_STORE_URL;
    }
}
