import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';

interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  progress?: number;
  error?: string;
}

export function UpdateNotification() {
  const { t } = useTranslation();
  const [updateState, setUpdateState] = useState<UpdateState>({ status: 'idle' });
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if we're in Electron
    const electronAPI = (window as unknown as { electronAPI?: Window['electronAPI'] }).electronAPI;
    if (!electronAPI?.checkForUpdates) return;

    // Set up event listeners
    const unsubChecking = electronAPI.onUpdateChecking?.(() => {
      setUpdateState({ status: 'checking' });
      setIsVisible(true);
    });

    const unsubAvailable = electronAPI.onUpdateAvailable?.((_event, data) => {
      setUpdateState({ status: 'available', version: data.version });
      setIsVisible(true);
    });

    const unsubNotAvailable = electronAPI.onUpdateNotAvailable?.(() => {
      setUpdateState({ status: 'idle' });
      setTimeout(() => setIsVisible(false), 3000);
    });

    const unsubProgress = electronAPI.onUpdateProgress?.((_event, data) => {
      setUpdateState(prev => ({ ...prev, status: 'downloading', progress: data.percent }));
    });

    const unsubDownloaded = electronAPI.onUpdateDownloaded?.((_event, data) => {
      setUpdateState({ status: 'downloaded', version: data.version });
    });

    const unsubError = electronAPI.onUpdateError?.((_event, error) => {
      setUpdateState({ status: 'error', error });
      setTimeout(() => setIsVisible(false), 5000);
    });

    // Note: Update check is triggered by main process (electron/src/main.ts)
    // after 10s delay. Frontend just listens for the results.

    return () => {
      unsubChecking?.();
      unsubAvailable?.();
      unsubNotAvailable?.();
      unsubProgress?.();
      unsubDownloaded?.();
      unsubError?.();
    };
  }, []);

  const handleDownload = async () => {
    const electronAPI = (window as unknown as { electronAPI?: Window['electronAPI'] }).electronAPI;
    if (electronAPI?.downloadUpdate) {
      await electronAPI.downloadUpdate();
    }
  };

  const handleInstall = () => {
    const electronAPI = (window as unknown as { electronAPI?: Window['electronAPI'] }).electronAPI;
    if (electronAPI?.installUpdate) {
      electronAPI.installUpdate();
    }
  };

  const handleDismiss = () => {
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="bg-card border rounded-lg shadow-lg p-4">
        {updateState.status === 'checking' && (
          <div className="flex items-center gap-3 text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span className="text-sm">{t('update.checking')}</span>
          </div>
        )}

        {updateState.status === 'available' && (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <Download className="h-5 w-5 text-primary mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm">{t('update.available')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('update.availableDesc', { version: updateState.version })}
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={handleDismiss}>
                {t('common.later')}
              </Button>
              <Button size="sm" onClick={handleDownload}>
                {t('common.download')}
              </Button>
            </div>
          </div>
        )}

        {updateState.status === 'downloading' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>{t('update.downloading')}</span>
              <span className="text-muted-foreground">{updateState.progress?.toFixed(0)}%</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${updateState.progress || 0}%` }}
              />
            </div>
          </div>
        )}

        {updateState.status === 'downloaded' && (
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-teal-400 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-sm">{t('update.ready')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('update.readyDesc', { version: updateState.version })}
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={handleDismiss}>
                {t('common.later')}
              </Button>
              <Button size="sm" onClick={handleInstall}>
                {t('update.restartNow')}
              </Button>
            </div>
          </div>
        )}

        {updateState.status === 'error' && (
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5" />
            <div>
              <p className="font-medium text-sm">{t('update.error')}</p>
              <p className="text-xs text-muted-foreground">{updateState.error}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
