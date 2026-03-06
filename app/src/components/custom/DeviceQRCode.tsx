import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Share2, Check, Copy, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import QRCode from 'qrcode';

interface DeviceQRCodeProps {
  userData: {
    username: string;
    deviceName: string;
    fingerprint: string;
    i2pAddress: string;
    pgpPublicKey: string;
    i2pPublicKey: string;
    pgpPrivateKey?: string;
    i2pPrivateKey?: string;
  };
}

export function DeviceQRCode({ userData }: DeviceQRCodeProps) {
  const { t } = useTranslation();
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const generateQRCode = async () => {
      try {
        // Device pairing QR — compact, contains only identifiers.
        // Private keys are too large for QR. The actual key exchange
        // happens via the downloaded backup file.
        const pairingData = {
          v: '2',
          t: 'dp',  // device-pairing
          u: userData.username,
          d: userData.deviceName,
          f: userData.fingerprint,
          i: userData.i2pAddress,
          tk: crypto.randomUUID().slice(0, 8),  // short one-time token
          ex: Date.now() + 5 * 60 * 1000,
        };

        const dataUrl = await QRCode.toDataURL(JSON.stringify(pairingData), {
          width: 400,
          margin: 2,
          color: { dark: '#000000', light: '#ffffff' },
          errorCorrectionLevel: 'M',
        });

        setQrDataUrl(dataUrl);
      } catch (err) {
        console.error('Error generating QR code:', err);
      }
    };

    generateQRCode();
  }, [userData]);

  const downloadAsPNG = () => {
    if (!qrDataUrl) return;

    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `securechat-device-${userData.username}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadAsSVG = async () => {
    try {
      const pairingData = {
        v: '2',
        t: 'dp',
        u: userData.username,
        d: userData.deviceName,
        f: userData.fingerprint,
        i: userData.i2pAddress,
      };

      const svgString = await QRCode.toString(JSON.stringify(pairingData), {
        type: 'svg',
        width: 400,
        margin: 2,
      });

      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `securechat-device-${userData.username}.svg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error generating SVG:', err);
    }
  };

  const copyToClipboard = async () => {
    if (!qrDataUrl) return;

    try {
      const response = await fetch(qrDataUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Error copying to clipboard:', err);
    }
  };

  const shareImage = async () => {
    if (!qrDataUrl) return;

    try {
      const response = await fetch(qrDataUrl);
      const blob = await response.blob();
      const file = new File([blob], `securechat-device-${userData.username}.png`, { type: 'image/png' });

      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: t('deviceQr.connectDevice'),
          text: t('deviceQr.scanToAdd', { name: userData.username }),
          files: [file],
        });
      } else {
        downloadAsPNG();
      }
    } catch (err) {
      console.error('Error sharing:', err);
      downloadAsPNG();
    }
  };

  return (
    <div className="space-y-4">
      {/* QR Code Display */}
      <div className="flex justify-center">
        <div className="p-4 bg-white rounded-lg shadow-lg">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="Device QR Code"
              className="w-64 h-64"
            />
          ) : (
            <div className="w-64 h-64 flex items-center justify-center bg-muted">
              <span className="text-muted-foreground">{t('common.generating')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Device Info */}
      <div className="p-3 bg-muted rounded-lg text-center">
        <p className="font-medium">{userData.username}</p>
        <p className="text-xs text-muted-foreground">{userData.deviceName}</p>
        <p className="text-xs text-muted-foreground font-mono mt-1">
          {userData.i2pAddress}
        </p>
      </div>

      {/* Expiry Warning */}
      <p className="text-xs text-center text-yellow-500">
        {t('deviceQr.qrValidFor')}
      </p>

      {/* Action Buttons */}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={downloadAsPNG}>
          <Download className="h-4 w-4 mr-2" />
          PNG
        </Button>
        <Button variant="outline" size="sm" onClick={downloadAsSVG}>
          <ImageIcon className="h-4 w-4 mr-2" />
          SVG
        </Button>
        <Button variant="outline" size="sm" onClick={copyToClipboard}>
          {copied ? (
            <><Check className="h-4 w-4 mr-2" /> {t('common.copied')}</>
          ) : (
            <><Copy className="h-4 w-4 mr-2" /> {t('common.copy')}</>
          )}
        </Button>
        <Button variant="outline" size="sm" onClick={shareImage}>
          <Share2 className="h-4 w-4 mr-2" />
          {t('common.share')}
        </Button>
      </div>

      {/* Hidden canvas for image generation */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
