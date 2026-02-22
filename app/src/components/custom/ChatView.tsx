import { useState, useRef, useEffect } from 'react';
import { Send, Image as ImageIcon, MoreVertical, Phone, Video, Shield, Check, CheckCheck, Clock, X, Download, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useApp } from '@/contexts/AppContext';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
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

export function ChatView() {
  const { activeChat, messages, sendMessage, sendFile, user, encryptionState, i2pStatus, deleteChat } = useApp();
  const [messageText, setMessageText] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    if (!messageText.trim()) return;
    
    await sendMessage(messageText.trim());
    setMessageText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Preview image
    const reader = new FileReader();
    reader.onload = (event) => {
      setPreviewImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSendImage = async () => {
    if (!previewImage || !activeChat) return;

    setIsUploading(true);
    try {
      // Convert data URL to File
      const response = await fetch(previewImage);
      const blob = await response.blob();
      const file = new File([blob], 'image.png', { type: 'image/png' });

      await sendFile(activeChat.contact.i2pAddress, file);
      setPreviewImage(null);
      toast.success('Bild erfolgreich gesendet');
    } catch (err) {
      console.error('Error sending image:', err);
      toast.error('Fehler beim Senden des Bildes', {
        description: err instanceof Error ? err.message : 'Unbekannter Fehler',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const formatMessageTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'sending':
        return <Clock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />;
      case 'sent':
        return <Check className="h-3 w-3 text-muted-foreground" aria-hidden="true" />;
      case 'delivered':
        return <CheckCheck className="h-3 w-3 text-muted-foreground" aria-hidden="true" />;
      case 'read':
        return <CheckCheck className="h-3 w-3 text-blue-500" aria-hidden="true" />;
      case 'failed':
        return <Clock className="h-3 w-3 text-destructive" aria-hidden="true" />;
      default:
        return null;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'sending':
        return 'Wird gesendet';
      case 'sent':
        return 'Gesendet';
      case 'delivered':
        return 'Zugestellt';
      case 'read':
        return 'Gelesen';
      case 'failed':
        return 'Fehlgeschlagen';
      default:
        return '';
    }
  };

  if (!activeChat) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background p-8">
        <Shield className="h-24 w-24 text-primary/20 mb-6" aria-hidden="true" />
        <h2 className="text-2xl font-semibold mb-2">Willkommen bei SecureChat</h2>
        <p className="text-muted-foreground text-center max-w-md mb-6">
          Wählen Sie einen Chat aus der Liste oder fügen Sie neue Kontakte hinzu,
          um mit Ende-zu-Ende-verschlüsselter Kommunikation zu beginnen.
        </p>
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-green-500" aria-hidden="true" />
            <span>PGP-Verschlüsselung aktiv</span>
          </div>
          <div className="flex items-center gap-2">
            <span 
              className={`h-2 w-2 rounded-full ${i2pStatus?.samConnected ? 'bg-green-500' : 'bg-red-500'}`}
              aria-label={i2pStatus?.samConnected ? 'I2P verbunden' : 'I2P nicht verbunden'}
              role="status"
            />
            <span>{i2pStatus?.samConnected ? 'I2P verbunden' : 'I2P nicht verbunden'}</span>
          </div>
          {i2pStatus?.error && (
            <p className="text-xs text-yellow-500 text-center max-w-sm">
              {i2pStatus.error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Chat Header */}
      <div className="h-16 border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10" aria-label={`Avatar von ${activeChat.contact?.name}`}>
              <AvatarFallback>{getInitials(activeChat.contact?.name || '??')}</AvatarFallback>
            </Avatar>
            {activeChat.contact?.status === 'online' && (
              <span 
                className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-green-500 border-2 border-background"
                aria-label="Online"
                role="status"
              />
            )}
          </div>
          <div>
            <h3 className="font-semibold">{activeChat.contact?.name}</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{activeChat.contact?.status === 'online' ? 'Online' : 'Offline'}</span>
              {encryptionState === 'encrypted' && (
                <>
                  <span aria-hidden="true">•</span>
                  <span className="text-green-500 flex items-center gap-1">
                    <Shield className="h-3 w-3" aria-hidden="true" />
                    Verschlüsselt
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  disabled
                  aria-label="Anruf (demnächst verfügbar)"
                >
                  <Phone className="h-5 w-5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Anrufe demnächst verfügbar</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  disabled
                  aria-label="Videoanruf (demnächst verfügbar)"
                >
                  <Video className="h-5 w-5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Videoanrufe demnächst verfügbar</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon"
                aria-label="Chat-Menü"
              >
                <MoreVertical className="h-5 w-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Kontaktinfo</DropdownMenuItem>
              <DropdownMenuItem>Nachrichten suchen</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-destructive focus:text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Chat löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea ref={scrollRef} className="flex-1 p-4" role="log" aria-label="Nachrichtenverlauf">
        <div className="space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>Keine Nachrichten vorhanden</p>
              <p className="text-sm">Schreiben Sie die erste Nachricht!</p>
            </div>
          ) : (
            messages.map((message, index) => {
              const isOwn = message.senderId === user?.id;
              const showDate = index === 0 || 
                new Date(message.timestamp).toDateString() !== 
                new Date(messages[index - 1].timestamp).toDateString();

              return (
                <div key={message.id}>
                  {showDate && (
                    <div className="flex justify-center my-4">
                      <span className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
                        {new Date(message.timestamp).toLocaleDateString('de-DE', {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                        })}
                      </span>
                    </div>
                  )}
                  <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`px-4 py-2 rounded-2xl ${
                          isOwn
                            ? 'bg-primary text-primary-foreground rounded-br-sm'
                            : 'bg-muted rounded-bl-sm'
                        }`}
                      >
                        {/* Image message */}
                        {message.type === 'image' && message.fileInfo && (
                          <div className="mb-2">
                            <img 
                              src={message.fileInfo.url || message.decryptedContent} 
                              alt={message.fileInfo.filename}
                              className="max-w-full rounded-lg cursor-pointer"
                              onClick={() => setSelectedImage((message.fileInfo?.url || message.decryptedContent) ?? null)}
                            />
                          </div>
                        )}
                        
                        {/* Text message */}
                        {message.type !== 'image' && (
                          <p className="text-sm whitespace-pre-wrap break-words">
                            {message.decryptedContent || '[Verschlüsselt]'}
                          </p>
                        )}
                      </div>
                      <div 
                        className={`flex items-center gap-1 mt-1 ${isOwn ? 'justify-end' : 'justify-start'}`}
                        aria-label={isOwn ? `Status: ${getStatusLabel(message.status)}` : undefined}
                      >
                        <span className="text-xs text-muted-foreground">
                          {formatMessageTime(message.timestamp)}
                        </span>
                        {isOwn && (
                          <span aria-label={getStatusLabel(message.status)}>
                            {getStatusIcon(message.status)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Image Preview */}
      {previewImage && (
        <div className="p-4 border-t border-border bg-muted/50">
          <div className="flex items-center gap-4">
            <img 
              src={previewImage} 
              alt="Vorschau" 
              className="h-20 w-20 object-cover rounded-lg"
            />
            <div className="flex-1">
              <p className="text-sm font-medium">Bild senden?</p>
              <p className="text-xs text-muted-foreground">Klicken Sie auf Senden</p>
            </div>
            <div className="flex gap-2">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setPreviewImage(null)}
                aria-label="Bildvorschau schließen"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
              <Button 
                onClick={handleSendImage} 
                disabled={isUploading}
                aria-label={isUploading ? 'Wird gesendet...' : 'Bild senden'}
              >
                {isUploading ? (
                  <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send className="h-5 w-5" aria-hidden="true" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
            aria-label="Bild auswählen"
          />
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => fileInputRef.current?.click()}
            disabled={encryptionState !== 'encrypted'}
            aria-label="Bild anhängen"
          >
            <ImageIcon className="h-5 w-5" aria-hidden="true" />
          </Button>
          <Input
            placeholder="Nachricht schreiben..."
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1"
            disabled={encryptionState !== 'encrypted'}
            aria-label="Nachricht eingeben"
          />
          <Button 
            onClick={handleSend} 
            disabled={!messageText.trim() || encryptionState !== 'encrypted'}
            size="icon"
            aria-label="Nachricht senden"
          >
            <Send className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
        {encryptionState !== 'encrypted' && (
          <p className="text-xs text-muted-foreground mt-2 text-center">
            Entsperren Sie die App, um Nachrichten zu senden
          </p>
        )}
        {encryptionState === 'encrypted' && !i2pStatus?.samConnected && (
          <p className="text-xs text-yellow-500 mt-2 text-center">
            I2P nicht verbunden — Nachrichten werden lokal gespeichert
          </p>
        )}
      </div>

      {/* Image Viewer Dialog */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-4xl p-0">
          <DialogTitle className="sr-only">Image viewer</DialogTitle>
          {selectedImage && (
            <div className="relative">
              <img 
                src={selectedImage} 
                alt="Vollbildansicht" 
                className="w-full h-auto"
              />
              <Button
                variant="secondary"
                size="icon"
                className="absolute top-4 right-4"
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = selectedImage;
                  link.download = 'image.png';
                  link.click();
                }}
                aria-label="Bild herunterladen"
              >
                <Download className="h-5 w-5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Chat Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Chat löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Möchtest du diesen Chat wirklich löschen? Alle Nachrichten werden unwiderruflich gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction 
              onClick={async () => {
                if (activeChat) {
                  await deleteChat(activeChat.id);
                  setShowDeleteDialog(false);
                  toast.success('Chat gelöscht');
                }
              }}
              className="bg-destructive"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
