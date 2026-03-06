/**
 * Group Chat UI Components
 *
 * Group creation dialog, member list, group chat view.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, Crown, LogOut, UserMinus, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { groupChatManager, type Group, type GroupMember } from '@/services/groupChat';
import type { Contact } from '@/types';

/**
 * Create Group Dialog
 */
export function CreateGroupDialog({
  open,
  onOpenChange,
  contacts,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: Contact[];
  onCreated: (group: Group) => void;
}) {
  const { t } = useTranslation();
  const [groupName, setGroupName] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);

  const toggleContact = (id: string) => {
    const next = new Set(selectedContacts);
    if (next.has(id)) next.delete(id);
    else if (next.size < 9) next.add(id); // Max 9 + self = 10
    else toast.error(t('group.maxMembers'));
    setSelectedContacts(next);
  };

  const handleCreate = async () => {
    if (!groupName.trim()) {
      toast.error(t('group.enterGroupName'));
      return;
    }
    if (selectedContacts.size === 0) {
      toast.error(t('group.selectAtLeastOne'));
      return;
    }

    setIsCreating(true);
    try {
      const members: GroupMember[] = contacts
        .filter(c => selectedContacts.has(c.id))
        .map(c => ({
          contactId: c.id,
          name: c.name,
          i2pAddress: c.i2pAddress,
          publicKey: c.pgpPublicKey,
          role: 'member' as const,
          joinedAt: new Date().toISOString(),
        }));

      const group = await groupChatManager.createGroup(groupName.trim(), members);
      onCreated(group);
      onOpenChange(false);
      setGroupName('');
      setSelectedContacts(new Set());
      toast.success(t('group.groupCreated', { name: group.name }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('group.createError'));
    } finally {
      setIsCreating(false);
    }
  };

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t('group.createGroup')}
          </DialogTitle>
          <DialogDescription>
            {t('group.selectNameAndMembers')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Input
            placeholder={t('group.groupName')}
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
          />

          <div>
            <p className="text-sm text-muted-foreground mb-2">
              {t('group.selectContacts', { count: selectedContacts.size })}
            </p>
            <ScrollArea className="h-48">
              <div className="space-y-2">
                {contacts.map(contact => (
                  <div
                    key={contact.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer"
                    onClick={() => toggleContact(contact.id)}
                  >
                    <Checkbox checked={selectedContacts.has(contact.id)} />
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="text-xs">
                        {getInitials(contact.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm">{contact.name}</span>
                  </div>
                ))}
                {contacts.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {t('group.noContacts')}
                  </p>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || !groupName.trim() || selectedContacts.size === 0}>
            {isCreating ? t('group.creating') : t('group.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Group member list component
 */
export function GroupMemberList({
  group,
  selfId,
  onAddMember,
  onRemoveMember,
  onLeave,
}: {
  group: Group;
  selfId: string;
  onAddMember?: () => void;
  onRemoveMember?: (contactId: string) => void;
  onLeave?: () => void;
}) {
  const { t } = useTranslation();
  const isAdmin = group.members.find(m => m.contactId === selfId)?.role === 'admin';

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t('group.members', { count: group.members.length })}</p>
        {isAdmin && onAddMember && (
          <Button variant="ghost" size="sm" onClick={onAddMember}>
            <UserPlus className="h-4 w-4 mr-1" />
            {t('common.add')}
          </Button>
        )}
      </div>

      <ScrollArea className="max-h-48">
        <div className="space-y-1">
          {group.members.map(member => (
            <div key={member.contactId} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted">
              <div className="flex items-center gap-2">
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="text-xs">{getInitials(member.name)}</AvatarFallback>
                </Avatar>
                <span className="text-sm">{member.name}</span>
                {member.role === 'admin' && (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <Crown className="h-3 w-3" />
                    Admin
                  </Badge>
                )}
                {member.contactId === selfId && (
                  <span className="text-xs text-muted-foreground">{t('group.you')}</span>
                )}
              </div>
              {isAdmin && member.contactId !== selfId && onRemoveMember && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onRemoveMember(member.contactId)}
                >
                  <UserMinus className="h-3 w-3 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {onLeave && (
        <Button variant="outline" size="sm" className="w-full text-destructive" onClick={onLeave}>
          <LogOut className="h-4 w-4 mr-2" />
          {t('group.leaveGroup')}
        </Button>
      )}
    </div>
  );
}
