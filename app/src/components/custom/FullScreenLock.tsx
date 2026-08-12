import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import appIcon from '/icon-192x192.png';

interface FullScreenLockProps {
  onUnlock: (passphrase: string) => Promise<boolean>;
  error?: string;
}

/**
 * Vollbild-Ersatz für den UnlockDialog.
 *
 * Layout: zentriert, Logo oben, Lock-Icon groß, Passphrase-Input, Unlock-Button.
 * Kein App-Untergrund sichtbar (Privacy-First). Ersetzt das Modal-Pattern aus
 * UnlockDialog, das den App-State durchscheinen ließ.
 */
export function FullScreenLock({ onUnlock, error }: FullScreenLockProps) {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [localError, setLocalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleUnlock = async () => {
    if (!passphrase || isSubmitting) return;
    setIsSubmitting(true);
    setLocalError('');
    try {
      const success = await onUnlock(passphrase);
      if (!success) {
        setLocalError(t('unlock.wrongPassphrase'));
      } else {
        setPassphrase('');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const displayError = error || localError;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lock-title"
      className="fixed inset-0 z-[100] bg-background flex flex-col items-center justify-center px-6"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <img src={appIcon} alt={t('lock.fullscreen.appName')} className="h-16 w-16 mb-6" />
      <h1 id="lock-title" className="text-2xl font-semibold mb-2">
        {t('lock.fullscreen.title')}
      </h1>
      <p className="text-sm text-muted-foreground mb-8 text-center max-w-sm">
        {t('lock.fullscreen.description')}
      </p>
      <Lock className="h-12 w-12 text-primary mb-6" aria-hidden="true" />
      <div className="w-full max-w-sm space-y-4">
        <Input
          type="password"
          placeholder={t('unlock.passphrasePlaceholder')}
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
          aria-label={t('unlock.enterPassphrase')}
          autoFocus
          disabled={isSubmitting}
        />
        {displayError && (
          <p className="text-sm text-destructive" role="alert">{displayError}</p>
        )}
        <Button
          onClick={handleUnlock}
          className="w-full"
          disabled={isSubmitting || !passphrase}
        >
          {t('unlock.unlock')}
        </Button>
      </div>
    </div>
  );
}
