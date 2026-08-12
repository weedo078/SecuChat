import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Trash2, Network } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { de, enUS } from 'date-fns/locale';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useApp } from '@/contexts/AppContext';
import { AnonymityBadge } from './AnonymityBadge';
import type { Contact } from '@/types';

interface ContactDetailModalProps {
  contact: Contact | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

const localeMap = {
  de,
  en: enUS,
} as const;

export function ContactDetailModal({
  contact,
  isOpen,
  onClose,
  onDeleted,
}: ContactDetailModalProps) {
  const { t, i18n } = useTranslation();
  const { removeContact, i2pStatus } = useApp();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!contact) return null;

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  const getAnonymityLevel = (): 'green' | 'yellow' | 'red' => {
    if (i2pStatus?.samConnected && contact.i2pAddress) return 'green';
    return 'red';
  };

  const handleCopy = async (value: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      // Clipboard unavailable — leave UI showing Copy icon
    }
  };

  const handleDelete = async () => {
    await removeContact(contact.id);
    setShowDeleteConfirm(false);
    onDeleted();
  };

  const dateLocale = localeMap[i18n.language as keyof typeof localeMap] ?? enUS;

  const formattedLastSeen = contact.lastSeen
    ? formatDistanceToNow(new Date(contact.lastSeen), {
        addSuffix: true,
        locale: dateLocale,
      })
    : t('contacts.detail.lastSeenUnknown');

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 flex-shrink-0">
                <AvatarFallback>{getInitials(contact.name)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg truncate">
                  {contact.name}
                </DialogTitle>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {contact.status === 'online' && (
                    <Badge variant="secondary" className="text-xs">
                      Online
                    </Badge>
                  )}
                  <AnonymityBadge level={getAnonymityLevel()} size="sm" />
                  {contact.i2pAddress && (
                    <Badge variant="outline" className="text-xs">
                      <Network className="h-3 w-3 mr-1" />
                      I2P
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <DialogDescription className="sr-only">
              {t('contacts.title')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 mt-4">
            <FieldRow
              label={t('contacts.detail.fingerprint')}
              value={contact.fingerprint}
              fieldId="fingerprint"
              copiedField={copiedField}
              onCopy={handleCopy}
            />

            {contact.i2pAddress && (
              <FieldRow
                label={t('contacts.detail.i2pAddress')}
                value={contact.i2pAddress}
                fieldId="i2pAddress"
                copiedField={copiedField}
                onCopy={handleCopy}
              />
            )}

            {contact.p2pIdentifier && (
              <FieldRow
                label={t('contacts.detail.p2pIdentifier')}
                value={contact.p2pIdentifier}
                fieldId="p2pIdentifier"
                copiedField={copiedField}
                onCopy={handleCopy}
              />
            )}

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                {t('contacts.detail.lastSeen')}
              </p>
              <p className="text-sm">{formattedLastSeen}</p>
            </div>
          </div>

          <div className="flex justify-end pt-4 border-t mt-4">
            <Button
              variant="destructive"
              onClick={() => setShowDeleteConfirm(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              {t('contacts.detail.deleteButton')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('contacts.deleteContact')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('contacts.deleteContactDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface FieldRowProps {
  label: string;
  value: string;
  fieldId: string;
  copiedField: string | null;
  onCopy: (value: string, fieldId: string) => void;
}

function FieldRow({
  label,
  value,
  fieldId,
  copiedField,
  onCopy,
}: FieldRowProps) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      <div className="flex items-start gap-2">
        <code className="flex-1 text-xs font-mono break-all bg-muted px-2 py-1.5 rounded">
          {value}
        </code>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onCopy(value, fieldId)}
          aria-label={label}
          className="flex-shrink-0"
        >
          {copiedField === fieldId ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}