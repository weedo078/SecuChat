import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider } from '@/contexts/AppContext'
import { platformService } from '@/services/platform'
import { installDevBridge } from '@/services/devBridge'
import App from './App'
import './index.css'
import './i18n'
import { StatusBar, Style } from '@capacitor/status-bar'

async function initApp() {
  // Detect Capacitor native platform early - MUST wait for detection
  // before rendering so isAndroidNative() works correctly
  await platformService.detectCapacitor()

  // Initialize StatusBar for Android/iOS
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {
    // Ignore errors on web platform (Capacitor plugins not available)
  })

  // Ensure status bar is visible and doesn't overlap content
  StatusBar.show().catch(() => {
    // Ignore errors on web platform
  })

  // Render the WebView BELOW the system status bar instead of edge-to-edge.
  // Robust Android fix: Layout beginnt unterhalb der System-Statusbar, deshalb
  // entfallen die fragilen per-Element paddingTop-Workarounds (hardcoded 28px /
  // isAndroid()-Checks) in App.tsx. No-op auf Web/Electron (Capacitor plugin wird
  // rejected → .catch).
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {
    // Ignoriere auf Plattformen ohne native StatusBar
  })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProvider>
        <App />
      </AppProvider>
    </StrictMode>,
  )

  // Register Service Worker for PWA (only http/https, not file:// or native)
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !platformService.isNative()) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => console.log('[PWA] Service Worker registered:', reg.scope))
        .catch((err) => console.log('[PWA] Service Worker registration failed:', err));
    });
  }

  // Dev-Bridge für automatisierte Tests (nur aktiv, wenn localStorage
  // 'secuchat_test_mode' === '1'). CDP-Zugriff via window.__secuchatDevBridge.*
  // sowie optional TCP auf 127.0.0.1:8787 via DevBridgePlugin.
  installDevBridge().catch((e) =>
    console.warn('[DevBridge] install failed:', e),
  );
}

void initApp()
