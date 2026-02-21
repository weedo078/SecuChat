import { useState, useEffect } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useApp } from '@/contexts/AppContext';
import { Header } from '@/components/custom/Header';
import { Sidebar } from '@/components/custom/Sidebar';
import { ChatView } from '@/components/custom/ChatView';
import { ContactManager } from '@/components/custom/ContactManager';
import { QRCodeShare } from '@/components/custom/QRCodeShare';
import { Settings } from '@/components/custom/Settings';
import { Onboarding } from '@/components/custom/Onboarding';
import { Toaster } from '@/components/ui/sonner';

function App() {
  const { user, initialize, isLoading, isLocked, unlockApp } = useApp();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showContactManager, setShowContactManager] = useState(false);
  const [showQRCode, setShowQRCode] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlockDismissed, setUnlockDismissed] = useState(false);

  // Derive unlock dialog from isLocked state without useEffect
  const showUnlockDialog = isLocked && !unlockDismissed;

  useEffect(() => {
    initialize();
  }, [initialize]);

  const handleUnlock = async () => {
    const success = await unlockApp(passphrase);
    if (success) {
      setUnlockDismissed(true);
      setPassphrase('');
      setUnlockError('');
    } else {
      setUnlockError('Falsche Passphrase');
    }
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
    <div className="min-h-screen bg-background flex flex-col">
      <Header 
        onMenuClick={() => setSidebarOpen(true)} 
        onSettingsClick={() => setShowSettings(true)} 
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Desktop Sidebar */}
        <div className="hidden lg:block w-80 shrink-0">
          <Sidebar 
            onAddContact={() => setShowContactManager(true)}
            onShowQR={() => setShowQRCode(true)}
            onSettingsClick={() => setShowSettings(true)}
          />
        </div>

        {/* Mobile Sidebar */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="p-0 w-80">
            <Sidebar 
              onAddContact={() => {
                setSidebarOpen(false);
                setShowContactManager(true);
              }}
              onShowQR={() => {
                setSidebarOpen(false);
                setShowQRCode(true);
              }}
              onSettingsClick={() => {
                setSidebarOpen(false);
                setShowSettings(true);
              }}
            />
          </SheetContent>
        </Sheet>

        {/* Main Content */}
        <ChatView />
      </div>

      {/* Dialogs */}
      <ContactManager 
        isOpen={showContactManager} 
        onClose={() => setShowContactManager(false)} 
      />
      <QRCodeShare 
        isOpen={showQRCode} 
        onClose={() => setShowQRCode(false)} 
      />
      <Settings 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
      />

      {/* Unlock Dialog */}
      {showUnlockDialog && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-card border border-border rounded-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-semibold mb-2">App entsperren</h2>
            <p className="text-muted-foreground mb-4">
              Geben Sie Ihre Passphrase ein, um auf Ihre Nachrichten zuzugreifen.
            </p>
            <input
              type="password"
              className="w-full p-3 rounded-md border border-input bg-background mb-4"
              placeholder="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            />
            {unlockError && (
              <p className="text-sm text-destructive mb-4">{unlockError}</p>
            )}
            <Button onClick={handleUnlock} className="w-full">
              Entsperren
            </Button>
          </div>
        </div>
      )}

      <Toaster />
    </div>
  );
}

export default App;
