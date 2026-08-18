// app/android/app/src/test/java/com/secuchat/app/plugin/I2PPlugin/PackagePresenceTest.java
package com.secuchat.app.plugin.I2PPlugin;

import org.junit.Test;
import static org.junit.Assert.*;

public class PackagePresenceTest {
    @Test
    public void getPlayStoreUrl_returnsCorrectUrl() {
        assertEquals(
            "https://play.google.com/store/apps/details?id=net.i2p.android",
            PackagePresence.getPlayStoreUrl()
        );
    }
}
