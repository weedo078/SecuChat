import { useState, useEffect } from 'react';
import { isAndroid } from '@/services/platform';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useApp } from '@/contexts/AppContext';
import { Header } from '@/components/custom/Header';
import { Sidebar } from '@/components/custom/Sidebar';
import { ChatView } from '@/components/custom/ChatView';
import { ContactManager } from '@/components/custom/ContactManager';
import { AddContactDialog } from '@/components/custom/AddContactDialog';
import { Settings } from '@/components/custom/Settings';
import { Onboarding } from '@/components/custom/Onboarding';
import { UnlockDialog } from '@/components/custom/UnlockDialog';
import { UpdateNotification } from '@/components/custom/UpdateNotification';
import { Toaster } from '@/components/ui/sonner';

function App() {
  const { user, initialize, isLoading, isLocked, unlockApp } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showContactManager, setShowContactManager] = useState(false);
  const [showShareContact, setShowShareContact] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [unlockDismissed, setUnlockDismissed] = useState(false);

  // Derive unlock dialog from isLocked state without useEffect
  const showUnlockDialog = isLocked && !unlockDismissed;

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Basic environment integrity check
  useEffect(() => {
    // Verify we're running in a secure context
    if (!window.isSecureContext && window.location.protocol !== 'file:') {
      console.warn('[App] Not running in secure context — some features may be limited');
    }

    // Verify Capacitor plugins are intact (if native platform)
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cap = (window as any).Capacitor;
      if (cap?.isNativePlatform?.() && !cap.Plugins) {
        console.error('[App] Capacitor plugins not loaded — possible integrity issue');
      }
    }
  }, []);

  const handleUnlock = async (passphrase: string): Promise<boolean> => {
    const success = await unlockApp(passphrase);
    if (success) {
      setUnlockDismissed(true);
    }
    return success;
  };

  const handleCloseUnlockDialog = () => {
    // Dialog kann nicht geschlossen werden ohne Entsperrung
    // (optional: könnte auch setUnlockDismissed(false) bleiben)
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Wird geladen...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Onboarding onComplete={() => window.location.reload()} />
        <Toaster />
      </>
    );
  }

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      {/* Fixed Header - stays below notification bar on Android */}
      <div className="fixed top-0 left-0 right-0 z-50" style={{ paddingTop: isAndroid() ? '28px' : undefined }} >
        <Header
          onMenuClick={() => setSidebarOpen(true)}
          onSettingsClick={() => setShowSettings(true)}
        />
      </div>

      {/* Main content with padding for fixed header */}
      <div className="flex-1 flex overflow-hidden" style={{ paddingTop: isAndroid() ? 'calc(4rem + 28px)' : '4rem' }} >
        {/* Desktop Sidebar */}
        <div className="hidden lg:flex w-80 shrink-0 flex-col h-full overflow-hidden">
          <Sidebar
            onAddContact={() => setShowContactManager(true)}
            onShareContact={() => setShowShareContact(true)}
            onSettingsClick={() => setShowSettings(true)}
          />
        </div>

        {/* Mobile Sidebar */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className={`p-0 w-80 ${isAndroid() ? '[&>button]:hidden' : ''}`} style={{ paddingTop: isAndroid() ? '28px' : 'env(safe-area-inset-top, 0px)' }}>
            <Sidebar
              onAddContact={() => {
                setSidebarOpen(false);
                setShowContactManager(true);
              }}
              onShareContact={() => {
                setSidebarOpen(false);
                setShowShareContact(true);
              }}
              onSettingsClick={() => {
                setSidebarOpen(false);
                setShowSettings(true);
              }}
            />
          </SheetContent>
        </Sheet>

        {/* Main Content */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <ChatView />
        </div>
      </div>

      {/* Dialogs */}
      <ContactManager 
        isOpen={showContactManager} 
        onClose={() => setShowContactManager(false)} 
      />
      <AddContactDialog
        isOpen={showShareContact}
        onClose={() => setShowShareContact(false)}
        initialTab="share"
      />
      <Settings 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
      />

      <UnlockDialog
        isOpen={showUnlockDialog}
        onClose={handleCloseUnlockDialog}
        onUnlock={handleUnlock}
      />

      <Toaster />
      
      {/* Auto-update notifications */}
      <UpdateNotification />
    </div>
  );
}

export default App;
