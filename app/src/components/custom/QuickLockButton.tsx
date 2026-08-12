import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface QuickLockButtonProps {
  onLock: () => void;
  variant: 'fab' | 'icon';
}

/**
 * Adaptive Quick-Lock-Button.
 *
 * - variant='fab': Mobile FAB, fixed bottom-right, 56x56px, 16px Inset
 * - variant='icon': Desktop Header-Icon-Button
 *
 * Visuell identische Lock-Icon, ruft onLock-Callback auf.
 * Sichtbarkeit (nur wenn !isLocked) wird vom Parent gesteuert.
 */
export function QuickLockButton({ onLock, variant }: QuickLockButtonProps) {
  if (variant === 'fab') {
    return (
      <Button
        onClick={onLock}
        size="icon"
        className="fixed bottom-4 right-4 z-40 h-14 w-14 rounded-full shadow-lg"
        aria-label="App sperren"
      >
        <Lock className="h-6 w-6" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <Button
      onClick={onLock}
      variant="ghost"
      size="icon"
      aria-label="App sperren"
    >
      <Lock className="h-5 w-5" aria-hidden="true" />
    </Button>
  );
}