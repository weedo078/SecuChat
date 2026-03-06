import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { UnlockDialog } from '@/components/custom/UnlockDialog';

interface HeaderProps {
  onMenuClick: () => void;
  onSettingsClick: () => void;
}

export function Header({ onMenuClick, onSettingsClick }: HeaderProps) {
  const { t } = useTranslation();
  const { user, encryptionState, isLocked, lockApp, unlockApp, i2pStatus } = useApp();
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);

  const handleUnlock = async (passphrase: string): Promise<boolean> => {
    const success = await unlockApp(passphrase);
    if (success) {
      setShowUnlockDialog(false);
    }
    return success;
  };

  const getEncryptionIcon = () => {
    if (encryptionState === 'encrypted') {
      return <Lock className="h-4 w-4 text-green-500" aria-hidden="true" />;
    }
    return <Unlock className="h-4 w-4 text-yellow-500" aria-hidden="true" />;
  };

  const getEncryptionLabel = () => {
    return encryptionState === 'encrypted' ? t('header.encrypted') : t('header.notEncrypted');
  };

  const getConnectionStatus = () => {
    if (i2pStatus?.samConnected) {
      return (
        <span
          className="h-2 w-2 rounded-full bg-green-500"
          aria-label={t('header.i2pConnected')}
          role="status"
        />
      );
    }
    if (i2pStatus?.samAvailable) {
      return (
        <span
          className="h-2 w-2 rounded-full bg-yellow-500"
          aria-label={t('header.i2pConnecting')}
          role="status"
        />
      );
    }
    return (
      <span
        className="h-2 w-2 rounded-full bg-red-500"
        aria-label={t('header.i2pDisconnected')}
        role="status"
      />
    );
  };

  const getConnectionLabel = () => {
    if (i2pStatus?.samConnected) return t('header.i2pConnected');
    if (i2pStatus?.samAvailable) return t('header.i2pConnecting');
    return t('header.i2pDisconnected');
  };

  return (
    <>
      <header className="h-16 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="lg:hidden"
            aria-label={t('header.openMenu')}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" aria-hidden="true" />
            <span className="font-semibold text-lg">SecureChat</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Connection Status */}
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            aria-label={t('header.connectionStatus', { status: getConnectionLabel() })}
          >
            {getConnectionStatus()}
            <span className="hidden sm:inline">
              {getConnectionLabel()}
            </span>
          </div>

          {/* Encryption Status */}
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            aria-label={t('header.encryptionStatus', { status: getEncryptionLabel() })}
          >
            {getEncryptionIcon()}
            <span className="hidden sm:inline">
              {getEncryptionLabel()}
            </span>
          </div>

          {/* User Menu */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  aria-label={t('header.openUserMenu')}
                >
                  <UserIcon className="h-5 w-5" aria-hidden="true" />
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
                  <Settings className="h-4 w-4 mr-2" aria-hidden="true" />
                  {t('common.settings')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={isLocked ? () => setShowUnlockDialog(true) : lockApp}>
                  {isLocked ? (
                    <>
                      <Unlock className="h-4 w-4 mr-2" aria-hidden="true" />
                      {t('header.unlock')}
                    </>
                  ) : (
                    <>
                      <Lock className="h-4 w-4 mr-2" aria-hidden="true" />
                      {t('header.lock')}
                    </>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive">
                  <LogOut className="h-4 w-4 mr-2" aria-hidden="true" />
                  {t('header.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      <UnlockDialog
        isOpen={showUnlockDialog}
        onClose={() => setShowUnlockDialog(false)}
        onUnlock={handleUnlock}
      />
    </>
  );
}
