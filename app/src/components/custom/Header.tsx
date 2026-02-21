import { useState } from 'react';
import { Shield, Lock, Unlock, Menu, Settings, User as UserIcon, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/contexts/AppContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface HeaderProps {
  onMenuClick: () => void;
  onSettingsClick: () => void;
}

export function Header({ onMenuClick, onSettingsClick }: HeaderProps) {
  const { user, encryptionState, isLocked, lockApp, unlockApp, i2pStatus } = useApp();
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [unlockError, setUnlockError] = useState('');

  const handleUnlock = async () => {
    const success = await unlockApp(passphrase);
    if (success) {
      setShowUnlockDialog(false);
      setPassphrase('');
      setUnlockError('');
    } else {
      setUnlockError('Falsche Passphrase');
    }
  };

  const getEncryptionIcon = () => {
    if (encryptionState === 'encrypted') {
      return <Lock className="h-4 w-4 text-green-500" />;
    }
    return <Unlock className="h-4 w-4 text-yellow-500" />;
  };

  const getConnectionStatus = () => {
    if (i2pStatus?.samConnected) {
      return <span className="h-2 w-2 rounded-full bg-green-500" />;
    }
    if (i2pStatus?.samAvailable) {
      return <span className="h-2 w-2 rounded-full bg-yellow-500" />;
    }
    return <span className="h-2 w-2 rounded-full bg-red-500" />;
  };

  const getConnectionLabel = () => {
    if (i2pStatus?.samConnected) return 'I2P Verbunden';
    if (i2pStatus?.samAvailable) return 'Verbinde...';
    return 'Getrennt';
  };

  return (
    <>
      <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onMenuClick} className="lg:hidden">
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <span className="font-semibold text-lg">SecureChat</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Connection Status */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {getConnectionStatus()}
            <span className="hidden sm:inline">
              {getConnectionLabel()}
            </span>
          </div>

          {/* Encryption Status */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {getEncryptionIcon()}
            <span className="hidden sm:inline">
              {encryptionState === 'encrypted' ? 'Verschlüsselt' : 'Nicht verschlüsselt'}
            </span>
          </div>

          {/* User Menu */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <UserIcon className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="font-medium">
                  {user.username}
                </DropdownMenuItem>
                <DropdownMenuItem className="text-xs text-muted-foreground">
                  ID: {user.fingerprint.slice(0, 16)}...
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onSettingsClick}>
                  <Settings className="h-4 w-4 mr-2" />
                  Einstellungen
                </DropdownMenuItem>
                <DropdownMenuItem onClick={isLocked ? () => setShowUnlockDialog(true) : lockApp}>
                  {isLocked ? (
                    <>
                      <Unlock className="h-4 w-4 mr-2" />
                      Entsperren
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4 mr-2" />
                      Sperren
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive">
                  <LogOut className="h-4 w-4 mr-2" />
                  Abmelden
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {/* Unlock Dialog */}
      <Dialog open={showUnlockDialog} onOpenChange={setShowUnlockDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>App entsperren</DialogTitle>
            <DialogDescription>
              Geben Sie Ihre Passphrase ein, um die App zu entsperren.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <Input
              type="password"
              placeholder="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            />
            {unlockError && (
              <p className="text-sm text-destructive">{unlockError}</p>
            )}
            <Button onClick={handleUnlock} className="w-full">
              Entsperren
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
