/**
 * Mobile Chat List Component
 *
 * Optimized chat list for mobile devices with:
 * - Pull-to-refresh support
 * - Swipe actions for archive/delete
 * - Touch-optimized list items
 * - Mobile-optimized avatars and text sizing
 */

import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Trash2, Archive, ChevronRight, Mail, MailOpen } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useApp } from '@/contexts/AppContext';
import { cn } from '@/lib/utils';
import type { Chat } from '@/types';

interface MobileChatListProps {
  onChatSelect: (chat: Chat) => void;
  onDeleteChat?: (chatId: string) => void;
  onArchiveChat?: (chatId: string) => void;
  onMarkAsRead?: (chatId: string) => void;
}

interface SwipeState {
  chatId: string | null;
  translateX: number;
  isSwiping: boolean;
}

export function MobileChatList({
  onChatSelect,
  onDeleteChat,
  onArchiveChat,
  onMarkAsRead,
}: MobileChatListProps) {
  const { t } = useTranslation();
  const { chats, activeChat, loadMessages } = useApp();
  const [swipeState, setSwipeState] = useState<SwipeState>({
    chatId: null,
    translateX: 0,
    isSwiping: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const pullStartY = useRef(0);
  const isPulling = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
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

  // Get unread status for a chat
  const getUnreadCount = useCallback((chat: Chat) => {
    return chat.unreadCount || 0;
  }, []);

  // Pull-to-refresh handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;

    // Check if at top of scroll for pull-to-refresh
    const scrollTop = scrollRef.current?.scrollTop ?? 0;
    if (scrollTop <= 0) {
      pullStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  }, []);

  const handlePullMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current || refreshing) return;

    const touchY = e.touches[0].clientY;
    const deltaY = touchY - pullStartY.current;

    // Only trigger pull-to-refresh when pulling down
    if (deltaY > 0 && deltaY < 150) {
      setPullDistance(deltaY);
      e.preventDefault();
    }
  }, [refreshing]);

  const handlePullEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;

    if (pullDistance > 80) {
      // Trigger refresh
      setRefreshing(true);
      setPullDistance(0);

      // Reload all chat messages from storage
      try {
        await Promise.all(
          chats.map(chat => loadMessages(chat.id))
        );
      } catch (error) {
        console.error('[PullRefresh] Error reloading chats:', error);
      } finally {
        setRefreshing(false);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, chats, loadMessages]);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent, chatId: string) => {
      // Handle pull-to-refresh first
      if (isPulling.current) {
        handlePullMove(e);
        return;
      }

      if (swipeState.isSwiping) return;

      const touchX = e.touches[0].clientX;
      const touchY = e.touches[0].clientY;
      const deltaX = touchX - touchStartX.current;
      const deltaY = touchY - touchStartY.current;

      // Determine if horizontal swipe (for swipe actions)
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        e.preventDefault();
        // Swipe left: archive/delete (negative deltaX)
        // Swipe right: mark as read (positive deltaX)
        if (deltaX < 0) {
          // Left swipe - archive/delete actions
          const clampedDelta = Math.max(-120, Math.min(0, deltaX));
          setSwipeState({
            chatId,
            translateX: clampedDelta,
            isSwiping: true,
          });
        } else {
          // Right swipe - mark as read
          const clampedDelta = Math.min(120, Math.max(0, deltaX));
          setSwipeState({
            chatId,
            translateX: clampedDelta,
            isSwiping: true,
          });
        }
      }
    },
    [swipeState.isSwiping, handlePullMove]
  );

  const handleTouchEnd = useCallback((chat: Chat) => {
    // Handle pull-to-refresh end
    if (isPulling.current) {
      handlePullEnd();
      return;
    }

    if (!swipeState.isSwiping) return;

    // If swiped left far enough, keep open for archive/delete
    if (swipeState.translateX < -60) {
      setSwipeState((prev) => ({
        ...prev,
        translateX: -80,
        isSwiping: false,
      }));
    } else if (swipeState.translateX > 60) {
      // If swiped right far enough, trigger mark as read
      if (getUnreadCount(chat) > 0) {
        onMarkAsRead?.(chat.id);
      }
      setSwipeState({
        chatId: null,
        translateX: 0,
        isSwiping: false,
      });
    } else {
      setSwipeState({
        chatId: null,
        translateX: 0,
        isSwiping: false,
      });
    }
  }, [swipeState.isSwiping, swipeState.translateX, handlePullEnd, getUnreadCount, onMarkAsRead]);


  const handleDelete = (chatId: string) => {
    onDeleteChat?.(chatId);
    setSwipeState({ chatId: null, translateX: 0, isSwiping: false });
  };

  const handleArchive = (chatId: string) => {
    onArchiveChat?.(chatId);
    setSwipeState({ chatId: null, translateX: 0, isSwiping: false });
  };

  const handleMarkAsRead = (chatId: string) => {
    onMarkAsRead?.(chatId);
    setSwipeState({ chatId: null, translateX: 0, isSwiping: false });
  };

  if (chats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
        <MessageSquare className="h-16 w-16 mb-4 opacity-50" aria-hidden="true" />
        <p className="text-lg font-medium mb-2">{t('sidebar.noChats')}</p>
        <p className="text-sm text-center">{t('sidebar.addContactsToStart')}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || refreshing) && (
        <div
          className="flex items-center justify-center bg-accent/50 transition-all duration-200 overflow-hidden"
          style={{
            height: refreshing ? 48 : Math.min(pullDistance, 80),
            opacity: refreshing ? 1 : Math.min(pullDistance / 60, 1),
          }}
        >
          {refreshing ? (
            <>
              <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">{t('common.refreshing')}</span>
            </>
          ) : (
            <>
              <div
                className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full mr-2 transition-transform"
                style={{
                  transform: `rotate(${Math.min(pullDistance * 2, 360)}deg)`,
                  opacity: pullDistance > 60 ? 1 : 0.5,
                }}
              />
              <span className="text-sm text-muted-foreground">
                {pullDistance > 60 ? t('common.releaseToRefresh') : t('common.pullToRefresh')}
              </span>
            </>
          )}
        </div>
      )}

      <ScrollArea
        ref={scrollRef}
        className="flex-1"
        onTouchStart={handleTouchStart}
      >
        <div className="divide-y divide-border">
          {chats.map((chat) => {
            const isActive = activeChat?.id === chat.id;
            const isSwiped = swipeState.chatId === chat.id;
            const translateX = isSwiped ? swipeState.translateX : 0;

            const unreadCount = getUnreadCount(chat);

            return (
              <div
                key={chat.id}
                className="relative overflow-hidden"
                onTouchMove={(e) => handleTouchMove(e, chat.id)}
                onTouchEnd={() => handleTouchEnd(chat)}
              >
                {/* Swipe actions background - Left side (Mark as Read) */}
                {swipeState.translateX > 0 && swipeState.chatId === chat.id && (
                  <div className="absolute inset-0 flex items-center bg-muted">
                    <button
                      onClick={() => handleMarkAsRead(chat.id)}
                      className={cn(
                        "h-full px-4 flex items-center justify-center min-w-[80px] touch-target transition-colors",
                        unreadCount > 0
                          ? "bg-blue-500 text-white"
                          : "bg-muted text-muted-foreground"
                      )}
                      aria-label={unreadCount > 0 ? t('chat.markAsRead') : t('chat.alreadyRead')}
                      disabled={unreadCount === 0}
                    >
                      {unreadCount > 0 ? <MailOpen className="h-5 w-5" /> : <Mail className="h-5 w-5" />}
                    </button>
                  </div>
                )}

                {/* Swipe actions background - Right side (Archive/Delete) */}
                {(!swipeState.chatId || swipeState.chatId !== chat.id || swipeState.translateX <= 0) && (
                  <div className="absolute inset-0 flex justify-end items-center bg-muted">
                    <button
                      onClick={() => handleArchive(chat.id)}
                      className="h-full px-4 bg-secondary text-secondary-foreground flex items-center justify-center min-w-[80px] touch-target active:bg-secondary/80"
                      aria-label={t('chat.archiveChat')}
                    >
                      <Archive className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(chat.id)}
                      className="h-full px-4 bg-destructive text-destructive-foreground flex items-center justify-center min-w-[80px] touch-target active:bg-destructive/80"
                      aria-label={t('chat.deleteChat')}
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                )}

                {/* Chat item */}
                <button
                  onClick={() => onChatSelect(chat)}
                  className={cn(
                    'w-full flex items-center gap-4 p-4 transition-transform duration-200 ease-out',
                    'min-h-[72px] touch-target',
                    isActive ? 'bg-primary text-primary-foreground' : 'bg-card',
                    isSwiped && 'swiping'
                  )}
                  style={{
                    transform: `translateX(${translateX}px)`,
                  }}
                  aria-label={t('sidebar.startChatWith', { name: chat.contact?.name })}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {/* Avatar */}
                  <div className="relative shrink-0">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback className={isActive ? 'bg-primary-foreground/20' : ''}>
                        {getInitials(chat.contact?.name || '??')}
                      </AvatarFallback>
                    </Avatar>
                    {chat.contact?.status === 'online' && (
                      <span
                        className={cn(
                          'absolute bottom-0 right-0 h-3 w-3 rounded-full border-2',
                          isActive ? 'border-primary bg-green-400' : 'border-card bg-green-500'
                        )}
                        aria-label={t('common.online')}
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center justify-between gap-2">
                      <h3
                        className={cn(
                          'font-semibold truncate',
                          isActive ? 'text-primary-foreground' : 'text-foreground'
                        )}
                      >
                        {chat.contact?.name}
                      </h3>
                      {chat.lastMessageTimestamp && (
                        <span
                          className={cn(
                            'text-xs shrink-0',
                            isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'
                          )}
                        >
                          {formatTime(chat.lastMessageTimestamp)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p
                        className={cn(
                          'text-sm truncate',
                          isActive ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        )}
                      >
                        {chat.contact?.status === 'online'
                          ? t('common.online')
                          : t('common.offline')}
                      </p>
                      {chat.unreadCount > 0 && (
                        <Badge
                          variant={isActive ? 'secondary' : 'default'}
                          className="text-xs shrink-0"
                        >
                          {chat.unreadCount}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Chevron */}
                  <ChevronRight
                    className={cn(
                      'h-5 w-5 shrink-0',
                      isActive ? 'text-primary-foreground/50' : 'text-muted-foreground/50'
                    )}
                    aria-hidden="true"
                  />
                </button>
              </div>
            );
          })}
        </div>

        {/* Bottom padding for safe area */}
        <div className="h-20" />
      </ScrollArea>
    </div>
  );
}

/**
 * Mobile Empty State Component
 */
export function MobileEmptyState() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-muted-foreground">
      <MessageSquare className="h-20 w-20 mb-6 opacity-30" aria-hidden="true" />
      <h2 className="text-xl font-semibold mb-2 text-foreground">{t('chat.welcome')}</h2>
      <p className="text-center mb-6">{t('chat.welcomeDescription')}</p>
      <div className="flex flex-col items-center gap-2 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span>{t('chat.pgpActive')}</span>
        </div>
      </div>
    </div>
  );
}
