/**
 * Contact Verification Dialog — Safety Numbers UI
 *
 * Shows QR code, 6-word phrase, and fingerprint for out-of-band verification.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Shield, ShieldCheck, ShieldAlert, QrCode, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  generateSafetyNumber,
  fingerprintToWords,
  formatFingerprint,
  generateQRCode,
  VerificationStore,
  type ContactVerification,
  type TrustLevel,
} from '@/services/contactVerification';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactName: string;
  contactFingerprint: string;
  myFingerprint: string;
}

export function ContactVerificationDialog({
  open,
  onOpenChange,
  contactId,
  contactName,
  contactFingerprint,
  myFingerprint,
}: Props) {
  const { t } = useTranslation();
  const [qrCodeUrl, setQrCodeUrl] = useState<string>('');
  const [verification, setVerification] = useState<ContactVerification | null>(null);
  const [copied, setCopied] = useState(false);

  const safetyNumber = generateSafetyNumber(myFingerprint, contactFingerprint);
  const wordPhrase = fingerprintToWords(safetyNumber);
  const formattedFingerprint = formatFingerprint(contactFingerprint);

  useEffect(() => {
    if (open) {
      generateQRCode(safetyNumber).then(setQrCodeUrl).catch(console.error);
      VerificationStore.get(contactId).then(setVerification);
    }
  }, [open, safetyNumber, contactId]);

  const handleVerify = async () => {
    const v: ContactVerification = {
      contactId,
      publicKeyFingerprint: contactFingerprint,
      trustLevel: 'verified',
      verifiedAt: new Date().toISOString(),
      verificationMethod: 'manual',
    };
    await VerificationStore.save(v);
    setVerification(v);
    toast.success(t('verification.contactVerified', { name: contactName }));
  };

  const handleUnverify = async () => {
    const v: ContactVerification = {
      contactId,
      publicKeyFingerprint: contactFingerprint,
      trustLevel: 'unverified',
      verificationMethod: 'none',
    };
    await VerificationStore.save(v);
    setVerification(v);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(wordPhrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success(t('verification.safetyPhraseCopied'));
  };

  const trustLevel: TrustLevel = verification?.trustLevel || 'unverified';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {trustLevel === 'verified' ? (
              <ShieldCheck className="h-5 w-5 text-teal-400" />
            ) : (
              <ShieldAlert className="h-5 w-5 text-yellow-500" />
            )}
            {t('verification.title')}
          </DialogTitle>
          <DialogDescription>
            {t('verification.description', { name: contactName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Status Badge */}
          <div className="flex justify-center">
            <Badge variant={trustLevel === 'verified' ? 'default' : 'secondary'}>
              {trustLevel === 'verified' ? '✓ ' + t('verification.verified') : t('verification.notVerified')}
              {verification?.verifiedAt && (
                <span className="ml-1 text-xs opacity-70">
                  {t('verification.verifiedSince', { date: new Date(verification.verifiedAt).toLocaleDateString() })}
                </span>
              )}
            </Badge>
          </div>

          {/* QR Code */}
          <div className="flex justify-center">
            {qrCodeUrl ? (
              <div className="bg-white p-3 rounded-lg">
                <img src={qrCodeUrl} alt={t('verification.securityQrCode')} className="w-48 h-48" />
              </div>
            ) : (
              <div className="w-48 h-48 bg-muted rounded-lg flex items-center justify-center">
                <QrCode className="h-12 w-12 text-muted-foreground" />
              </div>
            )}
          </div>

          {/* 6-Word Phrase */}
          <div className="bg-muted p-4 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">{t('verification.safetyPhrase')}</span>
              <Button variant="ghost" size="sm" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-lg font-mono text-center tracking-wide">{wordPhrase}</p>
          </div>

          {/* Fingerprint */}
          <div className="bg-muted/50 p-3 rounded-lg">
            <span className="text-xs text-muted-foreground block mb-1">{t('verification.fingerprintOf', { name: contactName })}</span>
            <p className="text-xs font-mono break-all">{formattedFingerprint}</p>
          </div>

          {/* Instructions */}
          <p className="text-xs text-muted-foreground text-center">
            {t('verification.instructions')}
          </p>

          {/* Actions */}
          <div className="flex gap-2 justify-center">
            {trustLevel !== 'verified' ? (
              <Button onClick={handleVerify} className="gap-2">
                <Shield className="h-4 w-4" />
                {t('verification.markVerified')}
              </Button>
            ) : (
              <Button variant="outline" onClick={handleUnverify} className="gap-2">
                <ShieldAlert className="h-4 w-4" />
                {t('verification.removeVerification')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline verification badge for chat header
 */
export function VerificationBadge({ contactId }: { contactId: string }) {
  const { t } = useTranslation();
  const [trustLevel, setTrustLevel] = useState<TrustLevel>('unverified');

  useEffect(() => {
    VerificationStore.get(contactId).then(v => {
      setTrustLevel(v?.trustLevel || 'unverified');
    });
  }, [contactId]);

  if (trustLevel === 'verified') {
    return (
      <span className="text-teal-400 flex items-center gap-1 text-xs">
        <ShieldCheck className="h-3 w-3" />
        {t('verification.verified')}
      </span>
    );
  }

  return (
    <span className="text-yellow-500 flex items-center gap-1 text-xs">
      <ShieldAlert className="h-3 w-3" />
      {t('verification.notVerified')}
    </span>
  );
}
