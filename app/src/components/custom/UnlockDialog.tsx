import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface UnlockDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onUnlock: (passphrase: string) => Promise<boolean>;
  error?: string;
}

export function UnlockDialog({ isOpen, onClose, onUnlock, error }: UnlockDialogProps) {
  const { t } = useTranslation();
  const [passphrase, setPassphrase] = useState('');
  const [localError, setLocalError] = useState('');

  const handleUnlock = async () => {
    const success = await onUnlock(passphrase);
    if (success) {
      setPassphrase('');
      setLocalError('');
      onClose();
    } else {
      setLocalError(t('unlock.wrongPassphrase'));
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      onClose();
    }
  };

  const displayError = error || localError;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('unlock.title')}</DialogTitle>
          <DialogDescription>
            {t('unlock.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <Input
            type="password"
            placeholder={t('unlock.passphrasePlaceholder')}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            aria-label={t('unlock.enterPassphrase')}
          />
          {displayError && (
            <p className="text-sm text-destructive" role="alert">{displayError}</p>
          )}
          <Button onClick={handleUnlock} className="w-full">
            {t('unlock.unlock')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
