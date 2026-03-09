import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Settings, Plus, Search, Share2, UserPlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useApp } from '@/contexts/AppContext';
import type { Chat, Contact } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { toast } from 'sonner';

interface SidebarProps {
  onAddContact: () => void;
  onShareContact: () => void;
  onSettingsClick: () => void;
}

export function Sidebar({ onAddContact, onShareContact, onSettingsClick }: SidebarProps) {
  const { t } = useTranslation();
  const { chats, activeChat, setActiveChat, contacts, createChat, user, deleteChat } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChatDialog, setShowNewChatDialog] = useState(false);
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);

  const filteredChats = chats.filter(chat =>
    chat.contact?.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleChatClick = (chat: Chat) => {
    setActiveChat(chat);
  };

  const handleNewChat = async (contact: Contact) => {
    const chat = await createChat(contact);
    setActiveChat(chat);
    setShowNewChatDialog(false);
  };

  const formatTime = (timestamp?: string) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return t('sidebar.yesterday');
    }

    return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <div className="w-full h-full flex flex-col bg-card border-r border-border overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">{t('sidebar.chats')}</h2>
          <div className="flex gap-1">
            <Dialog open={showNewChatDialog} onOpenChange={setShowNewChatDialog}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('sidebar.createNewChat')}
                >
                  <Plus className="h-5 w-5" aria-hidden="true" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t('sidebar.newChat')}</DialogTitle>
                  <DialogDescription>
                    {t('sidebar.newChatDescription')}
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[300px] mt-4">
                  <div className="space-y-2">
                    {contacts.filter(c => !chats.find(ch => ch.contactId === c.id)).map(contact => (
                      <button
                        key={contact.id}
                        onClick={() => handleNewChat(contact)}
                        className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors text-left"
                        aria-label={t('sidebar.startChatWith', { name: contact.name })}
                      >
                        <Avatar className="h-10 w-10">
                          <AvatarFallback>{getInitials(contact.name)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{contact.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {contact.fingerprint.slice(0, 16)}...
                          </p>
                        </div>
                      </button>
                    ))}
                    {contacts.filter(c => !chats.find(ch => ch.contactId === c.id)).length === 0 && (
                      <p className="text-center text-muted-foreground py-4">
                        {t('sidebar.noMoreContacts')}
                      </p>
                    )}
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>
            <Button
              variant="ghost"
              size="icon"
              onClick={onAddContact}
              aria-label={t('sidebar.addContact')}
            >
              <UserPlus className="h-5 w-5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onShareContact}
              aria-label={t('sidebar.shareContact')}
            >
              <Share2 className="h-5 w-5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder={t('sidebar.searchChats')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            aria-label={t('sidebar.searchChats')}
          />
        </div>
      </div>

      {/* Chat List */}
      <ScrollArea className="flex-1 overflow-y-auto" role="navigation" aria-label={t('chat.chatList')}>
        <div className="p-2">
          {filteredChats.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" aria-hidden="true" />
              <p>{t('sidebar.noChats')}</p>
              <p className="text-sm">{t('sidebar.addContactsToStart')}</p>
            </div>
          ) : (
            filteredChats.map(chat => (
              <div
                key={chat.id}
                className={`group w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
                  activeChat?.id === chat.id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent'
                }`}
              >
                <button
                  onClick={() => handleChatClick(chat)}
                  className="flex-1 flex items-center gap-3 text-left"
                  aria-label={`${chat.contact?.name}, ${chat.contact?.status === 'online' ? t('common.online') : t('common.offline')}${chat.unreadCount > 0 ? `, ${t('sidebar.unreadMessages', { count: chat.unreadCount })}` : ''}`}
                  aria-current={activeChat?.id === chat.id ? 'page' : undefined}
                >
                <div className="relative">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback>{getInitials(chat.contact?.name || '??')}</AvatarFallback>
                  </Avatar>
                  {chat.contact?.status === 'online' && (
                    <span
                      className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-card"
                      aria-label={t('common.online')}
                      role="status"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-medium truncate">{chat.contact?.name}</p>
                    {chat.lastMessageTimestamp && (
                      <span className={`text-xs ${activeChat?.id === chat.id ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {formatTime(chat.lastMessageTimestamp)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className={`text-sm truncate ${activeChat?.id === chat.id ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                      {chat.contact?.status === 'online' ? t('common.online') : t('common.offline')}
                    </p>
                    {chat.unreadCount > 0 && (
                      <Badge
                        variant={activeChat?.id === chat.id ? 'secondary' : 'default'}
                        className="text-xs"
                        aria-label={t('sidebar.unreadMessages', { count: chat.unreadCount })}
                      >
                        {chat.unreadCount}
                      </Badge>
                    )}
                  </div>
                </div>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ${
                    activeChat?.id === chat.id ? 'text-primary-foreground hover:text-primary-foreground' : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setChatToDelete(chat.id);
                  }}
                  aria-label={t('sidebar.deleteChat', { name: chat.contact?.name })}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Delete Chat Confirmation */}
      <AlertDialog open={!!chatToDelete} onOpenChange={() => setChatToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('chat.deleteChatConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('chat.deleteChatDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (chatToDelete) {
                  await deleteChat(chatToDelete);
                  setChatToDelete(null);
                  toast.success(t('chat.chatDeleted'));
                }
              }}
              className="bg-destructive"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Footer */}
      <div className="p-4 border-t border-border shrink-0">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={onSettingsClick}
          >
            <Settings className="h-4 w-4 mr-2" aria-hidden="true" />
            {t('common.settings')}
          </Button>
        </div>
        {user && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8" aria-label={t('sidebar.myAvatar', { name: user.username })}>
                <AvatarFallback>{getInitials(user.username)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{user.username}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {user.fingerprint.slice(0, 20)}...
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
