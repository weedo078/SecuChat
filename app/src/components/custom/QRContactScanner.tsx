import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { receive } from '@lo-fi/qr-data-sync';
import { Button } from '@/components/ui/button';
import { StopCircle } from 'lucide-react';

interface QRContactScannerProps {
  onContactScanned: (raw: string) => void;
  onError: (error: string) => void;
}

export function QRContactScanner({ onContactScanned, onError }: QRContactScannerProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [progress, setProgress] = useState<{ scanned: number; total: number }>({ scanned: 0, total: 0 });

  useEffect(() => {
    if (!videoRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;

    receive(videoRef.current, {
      signal: controller.signal,
      onFrameScanned: (info) => {
        setProgress({ scanned: info.framesScanned, total: info.frameCount });
      },
    })
      .then((result) => {
        const raw = JSON.stringify(result.data);
        onContactScanned(raw);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[QRContactScanner] Error:', err);
        onError(err instanceof Error ? err.message : 'Scan failed');
      });

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [onContactScanned, onError]);

  const stop = () => {
    abortRef.current?.abort();
    setIsRunning(false);
  };

  if (!isRunning) {
    return (
      <div className="text-center py-4 text-muted-foreground">
        <p>{t('qr.stopped')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          className="w-full aspect-square object-cover"
          playsInline
          muted
        />
        {/* Scan overlay */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-8 border-2 border-white/50 rounded-lg" />
        </div>
      </div>
      <div className="text-center text-sm text-muted-foreground">
        {progress.total > 0 ? (
          <p>{t('qr.scanProgress', { current: progress.scanned, total: progress.total })}</p>
        ) : (
          <p>{t('qr.pointAtQR')}</p>
        )}
      </div>
      <div className="flex justify-center">
        <Button variant="outline" size="sm" onClick={stop}>
          <StopCircle className="h-4 w-4 mr-2" />
          {t('common.stop')}
        </Button>
      </div>
    </div>
  );
}
