import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProvider } from '@/contexts/AppContext'
import { platformService } from '@/services/platform'
import App from './App'
import './index.css'
import './i18n'
import { StatusBar, Style } from '@capacitor/status-bar'

// Detect Capacitor native platform early
void platformService.detectCapacitor()

// Initialize StatusBar for Android/iOS
StatusBar.setStyle({ style: Style.Dark }).catch(() => {
  // Ignore errors on web platform (Capacitor plugins not available)
})

// Ensure status bar is visible and doesn't overlap content
StatusBar.show().catch(() => {
  // Ignore errors on web platform
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)
