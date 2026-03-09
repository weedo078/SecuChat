/**
 * Mobile Detection Hook
 *
 * Detects if the current viewport is mobile-sized.
 * Uses matchMedia for responsive breakpoints.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

// Breakpoints matching Tailwind defaults
const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

interface UseIsMobileOptions {
  breakpoint?: keyof typeof BREAKPOINTS;
}

/**
 * Hook to detect mobile viewport
 * Returns true if viewport is below the specified breakpoint
 */
export function useIsMobile(options: UseIsMobileOptions = {}): boolean {
  const { breakpoint = 'lg' } = options;
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < BREAKPOINTS[breakpoint];
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(`(max-width: ${BREAKPOINTS[breakpoint] - 1}px)`);

    const handleChange = (event: MediaQueryListEvent | MediaQueryList) => {
      const matches = 'matches' in event ? event.matches : (event as MediaQueryList).matches;
      setIsMobile(matches);
    };

    // Set initial value
    handleChange(mediaQuery);

    // Listen for changes
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      } else {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, [breakpoint]);

  return isMobile;
}

/**
 * Hook to detect if device supports touch
 */
export function useIsTouchDevice(): boolean {
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Check for touch support in a microtask to avoid setState during render warning
    const checkTouch = () => {
      const hasTouch: boolean =
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        ((window as unknown as { DocumentTouch?: unknown }).DocumentTouch != null &&
          typeof (window as unknown as { DocumentTouch?: unknown }).DocumentTouch === 'function');

      setIsTouch(hasTouch);
    };

    // Use setTimeout to defer state update
    const timeoutId = setTimeout(checkTouch, 0);
    return () => clearTimeout(timeoutId);
  }, []);

  return isTouch;
}

/**
 * Hook to detect screen orientation
 */
export function useOrientation(): 'portrait' | 'landscape' {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(() => {
    if (typeof window === 'undefined') return 'portrait';
    return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      setOrientation(window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  return orientation;
}

/**
 * Hook to detect if keyboard is visible (mobile)
 * Uses visual viewport API when available
 */
export function useKeyboardVisible(): boolean {
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const handleResize = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const windowHeight = window.innerHeight;
      // If viewport is significantly smaller than window, keyboard is likely visible
      setIsKeyboardVisible(windowHeight - viewportHeight > 150);
    };

    window.visualViewport.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.visualViewport?.removeEventListener('resize', handleResize);
    };
  }, []);

  return isKeyboardVisible;
}

/**
 * Hook to get safe area insets
 * Useful for notched devices
 */
export function useSafeAreaInsets(): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const [insets, setInsets] = useState({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Get CSS environment variables for safe areas
    const computedStyle = getComputedStyle(document.documentElement);

    const getInset = (name: string): number => {
      const value = computedStyle.getPropertyValue(name);
      return value ? parseInt(value, 10) : 0;
    };

    // Use queueMicrotask to avoid synchronous setState warning
    // Safe area insets are computed from CSS and don't need immediate sync
    queueMicrotask(() => {
      setInsets({
        top: getInset('--safe-area-inset-top') || getInset('env(safe-area-inset-top)') || 0,
        bottom: getInset('--safe-area-inset-bottom') || getInset('env(safe-area-inset-bottom)') || 0,
        left: getInset('--safe-area-inset-left') || getInset('env(safe-area-inset-left)') || 0,
        right: getInset('--safe-area-inset-right') || getInset('env(safe-area-inset-right)') || 0,
      });
    });
  }, []);

  return insets;
}

/**
 * Hook to handle long press on touch devices
 */
export function useLongPress(
  callback: () => void,
  options: { threshold?: number } = {}
): {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchMove: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
} {
  const { threshold = 500 } = options;
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const start = useCallback(() => {
    timerRef.current = setTimeout(() => {
      callback();
    }, threshold);
  }, [callback, threshold]);

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    onTouchStart: (e: React.TouchEvent) => {
      e.preventDefault();
      start();
    },
    onTouchEnd: stop,
    onTouchMove: stop,
    onMouseDown: (e: React.MouseEvent) => {
      e.preventDefault();
      start();
    },
    onMouseUp: stop,
    onMouseLeave: stop,
  };
}

// Re-export for convenience
export { useIsMobile as default };
