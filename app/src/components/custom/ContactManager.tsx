import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus, Trash2, Search, User, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useApp } from '@/contexts/AppContext';
import { AddContactDialog } from './AddContactDialog';
import { AnonymityBadge } from './AnonymityBadge';
import type { Contact } from '@/types';
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

interface ContactManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ContactManager({ isOpen, onClose }: ContactManagerProps) {
  const { t } = useTranslation();
  const { contacts, addContact, removeContact, i2pStatus } = useApp();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredContacts = contacts.filter(contact =>
    contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.fingerprint.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const handleDelete = async () => {
    if (showDeleteDialog) {
      await removeContact(showDeleteDialog);
      setShowDeleteDialog(null);
    }
  };

  const handleContactAdded = async (contact: Contact) => {
    await addContact(contact);
  };

  // Determine anonymity level for a contact
  const getContactAnonymityLevel = (contact: Contact): 'green' | 'yellow' | 'red' => {
    if (i2pStatus?.samConnected && contact.i2pAddress) {
      return 'green';
    }
    // For now, assume red if we don't have I2P connection
    // In future, we could track if contact is on same LAN
    return 'red';
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('contacts.title')}</DialogTitle>
            <DialogDescription>
              {t('contacts.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 mt-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('contacts.searchContacts')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button onClick={() => setShowAddDialog(true)}>
              <UserPlus className="h-4 w-4 mr-2" />
              {t('common.add')}
            </Button>
          </div>

          <ScrollArea className="flex-1 mt-4 -mx-6 px-6">
            <div className="space-y-2">
              {filteredContacts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <User className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>{t('contacts.noContacts')}</p>
                </div>
              ) : (
                filteredContacts.map(contact => (
                  <div
                    key={contact.id}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-accent transition-colors"
                  >
                    <Avatar className="h-10 w-10">
                      <AvatarFallback>{getInitials(contact.name)}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{contact.name}</p>
                        {contact.status === 'online' && (
                          <Badge variant="secondary" className="text-xs">Online</Badge>
                        )}
                        <AnonymityBadge
                          level={getContactAnonymityLevel(contact)}
                          size="sm"
                        />
                        {contact.i2pAddress && (
                          <Badge variant="outline" className="text-xs">
                            <Network className="h-3 w-3 mr-1" />
                            I2P
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground font-mono truncate">
                        {contact.fingerprint}
                      </p>
                      {contact.i2pAddress && (
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {contact.i2pAddress}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setShowDeleteDialog(contact.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <AddContactDialog
        isOpen={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onContactAdded={handleContactAdded}
      />

      <AlertDialog open={!!showDeleteDialog} onOpenChange={() => setShowDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('contacts.deleteContact')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('contacts.deleteContactDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive">
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
