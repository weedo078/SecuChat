import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { send } from '@lo-fi/qr-data-sync';
import { Button } from '@/components/ui/button';
import { StopCircle } from 'lucide-react';

interface AnimatedContactQRProps {
  contactData: {
    v: '2';
    t: 'sc';
    n: string;
    i: string;
    f: string;
    k?: string;
    ts?: number;
  };
}

export function AnimatedContactQR({ contactData }: AnimatedContactQRProps) {
  const { t } = useTranslation();
  const qrRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [frameInfo, setFrameInfo] = useState<{ index: number; total: number }>({ index: 0, total: 0 });

  useEffect(() => {
    if (!qrRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;

    send(contactData, qrRef.current, {
      maxFramesPerSecond: 4,
      frameTextChunkSize: 120,
      signal: controller.signal,
      onFrameRendered: (info) => {
        setFrameInfo({ index: info.frameIndex + 1, total: info.frameCount });
      },
    }).catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('[AnimatedContactQR] Error:', err);
    });

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [contactData]);

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
      <div className="flex justify-center">
        <div className="p-4 bg-white rounded-lg" ref={qrRef} />
      </div>
      <div className="text-center text-sm text-muted-foreground">
        {frameInfo.total > 0 && (
          <p>{t('qr.frameProgress', { current: frameInfo.index, total: frameInfo.total })}</p>
        )}
        <p className="text-xs mt-1">{t('qr.scanInstructions')}</p>
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
