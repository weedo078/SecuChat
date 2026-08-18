import { useTranslation } from 'react-i18next';
import { ExternalLink, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=net.i2p.android';

interface I2PAppInstallModalProps {
  onRetry: () => void;
}

/**
 * Blocking modal shown on Android when the I2P router app (net.i2p.android)
 * is not installed. There is deliberately no skip button: without the router
 * app the I2CP client cannot reach a router, so onboarding cannot continue.
 */
export function I2PAppInstallModal({ onRetry }: I2PAppInstallModalProps) {
  const { t } = useTranslation();

  const handleInstall = () => {
    window.open(PLAY_STORE_URL, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-md rounded-lg bg-background p-6 border border-border">
        <h2 className="font-semibold text-lg flex items-center gap-2 mb-3">
          <AlertCircle className="h-5 w-5 text-yellow-500" />
          {t('i2pAppInstall.title')}
        </h2>

        <p className="text-sm text-muted-foreground mb-4">
          {t('i2pAppInstall.description')}
        </p>

        <div className="flex flex-col gap-2">
          <Button className="w-full" onClick={handleInstall}>
            <ExternalLink className="h-4 w-4 mr-2" />
            {t('i2pAppInstall.installButton')}
          </Button>

          <Button variant="outline" className="w-full" onClick={onRetry}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('i2pAppInstall.retryButton')}
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground whitespace-pre-line">
          {t('i2pAppInstall.steps')}
        </p>
      </div>
    </div>
  );
}
