import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Image as ImageIcon, MoreVertical, Phone, Video, Shield, Check, CheckCheck, Clock, X, Download, Trash2, ShieldCheck, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import appIcon from '/icon-192x192.png';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useApp } from '@/contexts/AppContext';
import { toast } from 'sonner';
import { statusMessenger } from '@/services/statusMessages';
import { ContactVerificationDialog, VerificationBadge } from './ContactVerificationDialog';
import { VoiceRecordButton } from './VoiceMessageUI';
import { FileTransferDialog } from './FileTransferUI';
import { fileTransferManager, type FileTransferProgress } from '@/services/fileTransfer';
import type { VoiceMessage } from '@/services/voiceMessages';
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
  const { t } = useTranslation();
  const { activeChat, messages, sendMessage, sendFile, user, encryptionState, i2pStatus, deleteChat } = useApp();
  const [messageText, setMessageText] = useState('');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const [isContactTyping, setIsContactTyping] = useState(false);
  const [fileTransferProgress, setFileTransferProgress] = useState<FileTransferProgress | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileTransferInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Initialize status messenger
  useEffect(() => {
    if (user?.id) {
      statusMessenger.initialize(user.id);
    }
  }, [user?.id]);

  // Listen for typing indicators from active chat contact
  useEffect(() => {
    if (!activeChat?.contact?.i2pAddress) return;
    const contactAddr = activeChat.contact.i2pAddress;
    const handler = (from: string, isTyping: boolean) => {
      if (from === contactAddr || from.includes(contactAddr.split('.')[0])) {
        setIsContactTyping(isTyping);
      }
    };
    statusMessenger.onTyping(handler);
    return () => {
      statusMessenger.offTyping(handler);
      setIsContactTyping(false);
    };
  }, [activeChat?.contact?.i2pAddress]);

  // Send read receipts when messages appear
  useEffect(() => {
    if (!activeChat?.contact?.i2pAddress || !messages.length) return;
    const unread = messages.filter(m => m.senderId !== user?.id && m.status !== 'read');
    for (const msg of unread) {
      statusMessenger.sendReadReceipt(activeChat.contact.i2pAddress, msg.id);
    }
  }, [messages, activeChat?.contact?.i2pAddress, user?.id]);

  // File transfer progress
  useEffect(() => {
    const handler = (progress: FileTransferProgress) => {
      setFileTransferProgress(progress);
      if (progress.status === 'completed') {
        setTimeout(() => setFileTransferProgress(null), 3000);
      }
    };
    fileTransferManager.onProgress(handler);
    return () => fileTransferManager.offProgress(handler);
  }, []);

  // Handle typing indicator on input
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageText(e.target.value);
    if (activeChat?.contact?.i2pAddress) {
      statusMessenger.sendTyping(activeChat.contact.i2pAddress);
    }
  }, [activeChat?.contact?.i2pAddress]);

  // Handle voice message recorded
  const handleVoiceRecorded = useCallback(async (voiceMsg: VoiceMessage) => {
    if (!activeChat?.contact?.i2pAddress) return;
    try {
      const file = new File([voiceMsg.blob], `voice-${voiceMsg.id}.webm`, { type: voiceMsg.mimeType });
      await sendFile(activeChat.contact.i2pAddress, file);
      toast.success(t('chat.voiceSent'));
    } catch {
      toast.error(t('chat.voiceError'));
    }
  }, [activeChat?.contact?.i2pAddress, sendFile, t]);

  // Handle file transfer send
  const handleFileTransfer = useCallback(async (file: File) => {
    if (!activeChat?.contact?.i2pAddress) return;
    try {
      await fileTransferManager.sendFile(activeChat.contact.i2pAddress, file);
      toast.success(t('chat.fileSent'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('chat.fileSendError'));
    }
  }, [activeChat?.contact?.i2pAddress, t]);

  const handleSend = async () => {
    if (!messageText.trim()) return;

    // Stop typing indicator
    if (activeChat?.contact?.i2pAddress) {
      statusMessenger.stopTyping(activeChat.contact.i2pAddress);
    }

    try {
      await sendMessage(messageText.trim());
      setMessageText('');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : t('chat.unknownError');
      toast.error(t('chat.sendError'), {
        description: errorMsg,
      });
      // Keep message text so user can retry without retyping
    }
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
      toast.success(t('chat.imageSent'));
    } catch (err) {
      console.error('Error sending image:', err);
      toast.error(t('chat.imageSendError'), {
        description: err instanceof Error ? err.message : t('chat.unknownError'),
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
    return new Date(timestamp).toLocaleTimeString(undefined, {
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
        return t('status.sending');
      case 'sent':
        return t('status.sent');
      case 'delivered':
        return t('status.delivered');
      case 'read':
        return t('status.read');
      case 'failed':
        return t('status.failed');
      default:
        return '';
    }
  };

  if (!activeChat) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-background p-8">
        <img src={appIcon} alt="SecuChat" className="h-24 w-24 mb-6 opacity-80" />
        <h2 className="text-2xl font-semibold mb-2">{t('chat.welcome')}</h2>
        <p className="text-muted-foreground text-center max-w-md mb-6">
          {t('chat.welcomeDescription')}
        </p>
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-teal-400" aria-hidden="true" />
            <span>{t('chat.pgpActive')}</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${i2pStatus?.samConnected ? 'bg-teal-400' : 'bg-red-500'}`}
              aria-label={i2pStatus?.samConnected ? t('chat.i2pConnected') : t('chat.i2pNotConnected')}
              role="status"
            />
            <span>{i2pStatus?.samConnected ? t('chat.i2pConnected') : t('chat.i2pNotConnected')}</span>
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
    <div className="flex-1 flex flex-col bg-background h-full overflow-hidden">
      {/* Chat Header */}
      <div className="h-16 border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar className="h-10 w-10" aria-label={t('chat.avatarOf', { name: activeChat.contact?.name })}>
              <AvatarFallback>{getInitials(activeChat.contact?.name || '??')}</AvatarFallback>
            </Avatar>
            {activeChat.contact?.status === 'online' && (
              <span
                className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-teal-400 border-2 border-background"
                aria-label={t('common.online')}
                role="status"
              />
            )}
          </div>
          <div>
            <h3 className="font-semibold">{activeChat.contact?.name}</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{activeChat.contact?.status === 'online' ? t('common.online') : t('common.offline')}</span>
              {encryptionState === 'encrypted' && (
                <>
                  <span aria-hidden="true">•</span>
                  <span className="text-teal-400 flex items-center gap-1">
                    <Shield className="h-3 w-3" aria-hidden="true" />
                    {t('chat.encrypted')}
                  </span>
                  <span aria-hidden="true">•</span>
                  <VerificationBadge contactId={activeChat.contact?.id || ''} />
                </>
              )}
              {isContactTyping && (
                <span className="text-primary animate-pulse">{t('chat.typing')}</span>
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
                  aria-label={t('chat.callSoon')}
                >
                  <Phone className="h-5 w-5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('chat.callsSoon')}</p>
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
                  aria-label={t('chat.videoCallSoon')}
                >
                  <Video className="h-5 w-5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('chat.videoCallsSoon')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('chat.chatMenu')}
              >
                <MoreVertical className="h-5 w-5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>{t('chat.contactInfo')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowVerification(true)}>
                <ShieldCheck className="h-4 w-4 mr-2" />
                {t('chat.verifyContact')}
              </DropdownMenuItem>
              <DropdownMenuItem>{t('chat.searchMessages')}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('chat.deleteChat')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea ref={scrollRef} className="h-full overflow-y-auto p-4" role="log" aria-label={t('chat.messageHistory')}>
        <div className="space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>{t('chat.noMessages')}</p>
              <p className="text-sm">{t('chat.writeFirstMessage')}</p>
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
                        {new Date(message.timestamp).toLocaleDateString(undefined, {
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
                            {message.decryptedContent || t('chat.encryptedPlaceholder')}
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
      </div>

      {/* Typing Indicator */}
      {isContactTyping && (
        <div className="px-4 py-1">
          <span className="text-xs text-muted-foreground animate-pulse">
            {t('chat.contactTyping', { name: activeChat.contact?.name })}
          </span>
        </div>
      )}

      {/* Image Preview */}
      {previewImage && (
        <div className="p-4 border-t border-border bg-muted/50">
          <div className="flex items-center gap-4">
            <img
              src={previewImage}
              alt={t('chat.preview')}
              className="h-20 w-20 object-cover rounded-lg"
            />
            <div className="flex-1">
              <p className="text-sm font-medium">{t('chat.sendImage')}</p>
              <p className="text-xs text-muted-foreground">{t('chat.clickToSend')}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setPreviewImage(null)}
                aria-label={t('chat.closePreview')}
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </Button>
              <Button
                onClick={handleSendImage}
                disabled={isUploading}
                aria-label={isUploading ? t('chat.sendingImage') : t('chat.sendImage')}
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
      <div className="p-4 border-t border-border shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
            aria-label={t('chat.selectImage')}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={encryptionState !== 'encrypted'}
            aria-label={t('chat.attachImage')}
          >
            <ImageIcon className="h-5 w-5" aria-hidden="true" />
          </Button>
          <input
            type="file"
            ref={fileTransferInputRef}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileTransfer(f);
              e.target.value = '';
            }}
            aria-label={t('chat.selectFile')}
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => fileTransferInputRef.current?.click()}
            disabled={encryptionState !== 'encrypted'}
            aria-label={t('chat.sendFile')}
          >
            <Paperclip className="h-5 w-5" aria-hidden="true" />
          </Button>
          <Input
            placeholder={t('chat.messagePlaceholder')}
            value={messageText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="flex-1"
            disabled={encryptionState !== 'encrypted'}
            aria-label={t('chat.enterMessage')}
          />
          {messageText.trim() ? (
            <Button
              onClick={handleSend}
              disabled={encryptionState !== 'encrypted'}
              size="icon"
              aria-label={t('chat.sendMessage')}
            >
              <Send className="h-5 w-5" aria-hidden="true" />
            </Button>
          ) : (
            <VoiceRecordButton
              onRecorded={handleVoiceRecorded}
              disabled={encryptionState !== 'encrypted'}
            />
          )}
        </div>
        {encryptionState !== 'encrypted' && (
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {t('chat.unlockToSend')}
          </p>
        )}
        {encryptionState === 'encrypted' && !i2pStatus?.samConnected && (
          <p className="text-xs text-yellow-500 mt-2 text-center">
            {t('chat.i2pNotConnectedLocal')}
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
                alt={t('chat.fullView')}
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
                aria-label={t('chat.downloadImage')}
              >
                <Download className="h-5 w-5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* File Transfer Dialog (accept/reject incoming) */}
      <FileTransferDialog />

      {/* File Transfer Progress */}
      {fileTransferProgress && fileTransferProgress.status !== 'completed' && (
        <div className="px-4 py-2 border-t border-border bg-muted/50">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>{fileTransferProgress.direction === 'send' ? t('chat.sendingFile') : t('chat.receivingFile')}</span>
            <span>{fileTransferProgress.percent}%</span>
          </div>
          <div className="h-1 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${fileTransferProgress.percent}%` }} />
          </div>
        </div>
      )}

      {/* Contact Verification Dialog */}
      {activeChat?.contact && user && (
        <ContactVerificationDialog
          open={showVerification}
          onOpenChange={setShowVerification}
          contactId={activeChat.contact.id}
          contactName={activeChat.contact.name}
          contactFingerprint={activeChat.contact.fingerprint}
          myFingerprint={user.fingerprint}
        />
      )}

      {/* Delete Chat Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
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
                if (activeChat) {
                  await deleteChat(activeChat.id);
                  setShowDeleteDialog(false);
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
    </div>
  );
}
