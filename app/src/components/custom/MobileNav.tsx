/**
 * Mobile Navigation Component
 *
 * Provides bottom navigation bar for mobile devices.
 * Replaces the desktop sidebar with a touch-friendly bottom nav.
 * Uses CSS env(safe-area-inset-*) for safe area handling.
 */

import { useTranslation } from 'react-i18next';
import { MessageSquare, Users, Settings } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { cn } from '@/lib/utils';

interface MobileNavProps {
  onAddContact: () => void;
  onShareContact?: () => void;
  onSettingsClick: () => void;
  activeTab?: 'chats' | 'contacts' | 'settings';
}

export function MobileNav({
  onAddContact,
  onSettingsClick,
  activeTab = 'chats',
}: MobileNavProps) {
  const { t } = useTranslation();
  const { setActiveChat, chats, activeChat } = useApp();

  const handleChatsClick = () => {
    // If already on chats tab and a chat is active, go back to chat list
    if (activeTab === 'chats' && activeChat) {
      setActiveChat(null);
    }
  };

  const handleContactsClick = () => {
    onAddContact();
  };

  return (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 z-50',
        'bg-card/95 backdrop-blur-lg border-t border-border',
        'md:hidden' // Hide on desktop (md and up)
      )}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
      aria-label={t('mobileNav.navigation')}
    >
      <div className="flex items-center justify-around h-16">
        {/* Chats Tab */}
        <button
          onClick={handleChatsClick}
          className={cn(
            'flex flex-col items-center justify-center flex-1 h-full min-h-[44px]',
            'transition-colors duration-200',
            activeTab === 'chats'
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
          aria-label={t('mobileNav.chats')}
          aria-current={activeTab === 'chats' ? 'page' : undefined}
        >
          <div className="relative">
            <MessageSquare className="h-6 w-6" aria-hidden="true" />
            {chats.some((c) => c.unreadCount > 0) && (
              <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary" />
            )}
          </div>
          <span className="text-xs mt-1">{t('mobileNav.chats')}</span>
        </button>

        {/* Contacts Tab */}
        <button
          onClick={handleContactsClick}
          className={cn(
            'flex flex-col items-center justify-center flex-1 h-full min-h-[44px]',
            'transition-colors duration-200',
            activeTab === 'contacts'
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
          aria-label={t('mobileNav.contacts')}
          aria-current={activeTab === 'contacts' ? 'page' : undefined}
        >
          <Users className="h-6 w-6" aria-hidden="true" />
          <span className="text-xs mt-1">{t('mobileNav.contacts')}</span>
        </button>

        {/* Settings Tab */}
        <button
          onClick={onSettingsClick}
          className={cn(
            'flex flex-col items-center justify-center flex-1 h-full min-h-[44px]',
            'transition-colors duration-200',
            activeTab === 'settings'
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
          aria-label={t('mobileNav.settings')}
          aria-current={activeTab === 'settings' ? 'page' : undefined}
        >
          <Settings className="h-6 w-6" aria-hidden="true" />
          <span className="text-xs mt-1">{t('mobileNav.settings')}</span>
        </button>
      </div>
    </nav>
  );
}

/**
 * Mobile Header Component
 *
 * Condensed header for mobile with safe area support.
 */
interface MobileHeaderProps {
  title: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
}

export function MobileHeader({ title, onBack, rightAction }: MobileHeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-40',
        'bg-card/95 backdrop-blur-lg border-b border-border'
      )}
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      <div className="flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 -ml-2 rounded-full hover:bg-accent min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Back"
            >
              <svg
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
          )}
          <h1 className="text-lg font-semibold truncate">{title}</h1>
        </div>
        {rightAction && <div className="flex items-center">{rightAction}</div>}
      </div>
    </header>
  );
}

/**
 * Safe Area Container
 *
 * Wraps content to handle safe areas on mobile devices.
 */
interface SafeAreaContainerProps {
  children: React.ReactNode;
  className?: string;
  bottomNav?: boolean;
}

export function SafeAreaContainer({
  children,
  className,
  bottomNav = false,
}: SafeAreaContainerProps) {
  // Calculate bottom padding including nav height if present
  const bottomPadding = bottomNav ? 'calc(env(safe-area-inset-bottom, 0px) + 64px)' : 'env(safe-area-inset-bottom, 0px)';

  return (
    <div
      className={cn('min-h-screen', className)}
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: bottomPadding,
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {children}
    </div>
  );
}
