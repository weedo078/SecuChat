// app/android/app/src/main/java/com/secuchat/app/plugin/I2PPlugin/PackagePresence.java
package com.secuchat.app.plugin.I2PPlugin;

import android.content.Context;
import android.content.pm.PackageManager;

public class PackagePresence {
    // net.i2p.android = Play-Store-App, net.i2p.android.router = F-Droid/Build-Variante,
    // org.purplei2p.i2pd = Purple I2P (i2pd-Android). Alle drei stellen einen lokalen
    // I2P-Router bereit, der I2CP (7654) und/oder SAM (7656) exposen kann.
    private static final String[] I2P_APP_PACKAGES = {
        "net.i2p.android",
        "net.i2p.android.router",
        "org.purplei2p.i2pd",
    };
    private static final String PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=net.i2p.android";

    public static boolean isI2pAppInstalled(Context context) {
        PackageManager pm = context.getPackageManager();
        for (String pkg : I2P_APP_PACKAGES) {
            try {
                pm.getPackageInfo(pkg, 0);
                return true;
            } catch (PackageManager.NameNotFoundException e) {
                // try next candidate
            }
        }
        return false;
    }

    public static String getPlayStoreUrl() {
        return PLAY_STORE_URL;
    }
}
