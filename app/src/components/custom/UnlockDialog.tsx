import { useState } from 'react';
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
  const [passphrase, setPassphrase] = useState('');
  const [localError, setLocalError] = useState('');

  const handleUnlock = async () => {
    const success = await onUnlock(passphrase);
    if (success) {
      setPassphrase('');
      setLocalError('');
      onClose();
    } else {
      setLocalError('Falsche Passphrase');
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
          <DialogTitle>App entsperren</DialogTitle>
          <DialogDescription>
            Geben Sie Ihre Passphrase ein, um auf Ihre Nachrichten zuzugreifen.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <Input
            type="password"
            placeholder="Passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            aria-label="Passphrase eingeben"
          />
          {displayError && (
            <p className="text-sm text-destructive" role="alert">{displayError}</p>
          )}
          <Button onClick={handleUnlock} className="w-full">
            Entsperren
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
