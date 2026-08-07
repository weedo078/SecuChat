package com.secuchat.app.plugin.I2PPlugin;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;

import java.io.IOException;

import static org.junit.Assert.*;

public class I2CPSocketManagerTest {
    private I2CPSocketManager mgr;

    @Before
    public void setUp() throws Exception {
        // In a real test, we'd use a local I2P routerContext (RouterContext.internalClientManager()).
        // For this placeholder, we skip construction and only test the no-router state.
        mgr = null;
    }

    @After
    public void tearDown() {
        if (mgr != null) mgr.disconnect();
    }

    @Test
    public void getInstance_returnsNullBeforeCreate() {
        assertNull(I2CPSocketManager.getInstance());
    }

    /**
     * Exercises the destination-input validation contract of connectTo() without
     * needing a live I2P router. The validation logic was extracted into a
     * package-private static helper (requireDestination) for exactly this
     * reason: the original brief's test was a no-op because connectTo() can
     * only be reached on a constructed manager, which requires a router.
     */
    @Test
    public void requireDestination_rejectsNullAndEmpty() {
        try {
            I2CPSocketManager.requireDestination(null);
            fail("expected IOException for null destination");
        } catch (IOException expected) {
            assertEquals("destination B32 required", expected.getMessage());
        }
        try {
            I2CPSocketManager.requireDestination("");
            fail("expected IOException for empty destination");
        } catch (IOException expected) {
            assertEquals("destination B32 required", expected.getMessage());
        }
    }
}
