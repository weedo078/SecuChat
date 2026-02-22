import { useState } from 'react';
import { MessageSquare, Settings, Plus, Search, Share2, UserPlus } from 'lucide-react';
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

interface SidebarProps {
  onAddContact: () => void;
  onShowQR: () => void;
  onSettingsClick: () => void;
}

export function Sidebar({ onAddContact, onShowQR, onSettingsClick }: SidebarProps) {
  const { chats, activeChat, setActiveChat, contacts, createChat, user } = useApp();
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewChatDialog, setShowNewChatDialog] = useState(false);

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
      return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    }
    
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Gestern';
    }
    
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
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
    <div className="w-full h-full flex flex-col bg-card border-r border-border">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">Chats</h2>
          <div className="flex gap-1">
            <Dialog open={showNewChatDialog} onOpenChange={setShowNewChatDialog}>
              <DialogTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon"
                  aria-label="Neuen Chat erstellen"
                >
                  <Plus className="h-5 w-5" aria-hidden="true" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Neuer Chat</DialogTitle>
                  <DialogDescription>
                    Wählen Sie einen Kontakt aus, um einen neuen Chat zu starten.
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[300px] mt-4">
                  <div className="space-y-2">
                    {contacts.filter(c => !chats.find(ch => ch.contactId === c.id)).map(contact => (
                      <button
                        key={contact.id}
                        onClick={() => handleNewChat(contact)}
                        className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors text-left"
                        aria-label={`Chat mit ${contact.name} starten`}
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
                        Keine weiteren Kontakte verfügbar
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
              aria-label="Kontakt hinzufügen"
            >
              <UserPlus className="h-5 w-5" aria-hidden="true" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={onShowQR}
              aria-label="Kontakt teilen"
            >
              <Share2 className="h-5 w-5" aria-hidden="true" />
            </Button>
          </div>
        </div>
        
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <Input
            placeholder="Chats durchsuchen..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            aria-label="Chats durchsuchen"
          />
        </div>
      </div>

      {/* Chat List */}
      <ScrollArea className="flex-1" role="navigation" aria-label="Chat-Liste">
        <div className="p-2">
          {filteredChats.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-50" aria-hidden="true" />
              <p>Keine Chats vorhanden</p>
              <p className="text-sm">Fügen Sie Kontakte hinzu, um zu starten</p>
            </div>
          ) : (
            filteredChats.map(chat => (
              <button
                key={chat.id}
                onClick={() => handleChatClick(chat)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left ${
                  activeChat?.id === chat.id 
                    ? 'bg-primary text-primary-foreground' 
                    : 'hover:bg-accent'
                }`}
                aria-label={`Chat mit ${chat.contact?.name}, Status: ${chat.contact?.status === 'online' ? 'Online' : 'Offline'}${chat.unreadCount > 0 ? `, ${chat.unreadCount} ungelesene Nachrichten` : ''}`}
                aria-current={activeChat?.id === chat.id ? 'page' : undefined}
              >
                <div className="relative">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback>{getInitials(chat.contact?.name || '??')}</AvatarFallback>
                  </Avatar>
                  {chat.contact?.status === 'online' && (
                    <span 
                      className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-card"
                      aria-label="Online"
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
                      {chat.contact?.status === 'online' ? 'Online' : 'Offline'}
                    </p>
                    {chat.unreadCount > 0 && (
                      <Badge 
                        variant={activeChat?.id === chat.id ? 'secondary' : 'default'} 
                        className="text-xs"
                        aria-label={`${chat.unreadCount} ungelesene Nachrichten`}
                      >
                        {chat.unreadCount}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center justify-between">
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex-1" 
            onClick={onSettingsClick}
          >
            <Settings className="h-4 w-4 mr-2" aria-hidden="true" />
            Einstellungen
          </Button>
        </div>
        {user && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8" aria-label={`Mein Avatar: ${user.username}`}>
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
