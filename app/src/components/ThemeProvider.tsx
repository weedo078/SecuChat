/**
 * Theme Provider Component
 *
 * Applies the current theme to the document and handles theme changes.
 * Syncs with Android status bar when running as native app.
 */

import { useEffect } from 'react';
import { useApp } from '@/contexts/AppContext';

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const { theme } = useApp();

  useEffect(() => {
    // Apply theme to document
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.classList.add('dark');
    }
  }, [theme]);

  return <>{children}</>;
}
