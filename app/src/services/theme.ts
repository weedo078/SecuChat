/**
 * Theme Service
 *
 * Manages dark/light mode and syncs with Android status bar.
 * Handles system theme changes and persists user preference.
 */

import type { AppSettings } from '@/types';
import { storageService } from './storage';
import type { StatusBarPlugin } from '@capacitor/status-bar';
import { Style } from '@capacitor/status-bar';

// Theme colors for status bar
const STATUS_BAR_COLORS = {
  dark: '#0f1115', // Matches --background in dark mode
  light: '#ffffff', // Matches light theme background
};

let StatusBar: StatusBarPlugin | null = null;
let isStatusBarAvailable = false;

async function loadStatusBar() {
  if (typeof window === 'undefined') return;
  try {
    const mod = await import('@capacitor/status-bar');
    StatusBar = mod.StatusBar;
    isStatusBarAvailable = true;
  } catch {
    isStatusBarAvailable = false;
  }
}

const loadPromise = loadStatusBar();

export const themeService = {
  async isStatusBarAvailable(): Promise<boolean> {
    await loadPromise;
    return isStatusBarAvailable;
  },

  /**
   * Apply theme to status bar
   */
  async applyStatusBarTheme(theme: 'dark' | 'light'): Promise<void> {
    await loadPromise;
    if (!StatusBar) return;

    try {
      // Set background color to match app background
      await StatusBar.setBackgroundColor({
        color: theme === 'dark' ? STATUS_BAR_COLORS.dark : STATUS_BAR_COLORS.light,
      });

      // Set style (icons color) - opposite of theme for contrast
      const style: Style = theme === 'dark' ? Style.Dark : Style.Light;
      await StatusBar.setStyle({ style });
    } catch (error) {
      console.warn('[ThemeService] Failed to apply status bar theme:', error);
    }
  },

  /**
   * Get system preferred theme
   */
  getSystemTheme(): 'dark' | 'light' {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },

  /**
   * Check if system theme preference changed
   */
  onSystemThemeChange(callback: (theme: 'dark' | 'light') => void): () => void {
    if (typeof window === 'undefined') return () => {};

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handler = (event: MediaQueryListEvent | MediaQueryList) => {
      const matches = 'matches' in event ? event.matches : (event as MediaQueryList).matches;
      callback(matches ? 'dark' : 'light');
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handler);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mediaQuery as any).addListener(handler);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handler);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mediaQuery as any).removeListener(handler);
      }
    };
  },

  /**
   * Initialize theme from settings or system preference
   */
  async initializeTheme(): Promise<'dark' | 'light'> {
    const settings = await storageService.getSettings();

    // Use saved theme or default to dark
    const theme = settings?.theme || 'dark';

    // Apply to status bar if on native platform
    await this.applyStatusBarTheme(theme);

    return theme;
  },

  /**
   * Update theme and persist
   */
  async setTheme(theme: 'dark' | 'light'): Promise<void> {
    // Apply to status bar
    await this.applyStatusBarTheme(theme);

    // Save to settings
    const settings = await storageService.getSettings();
    if (settings) {
      const updated: AppSettings = { ...settings, theme };
      await storageService.saveSettings(updated);
    }
  },
};
