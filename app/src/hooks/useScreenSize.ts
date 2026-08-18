/**
 * Screen Size Hook
 *
 * Comprehensive screen size detection for responsive layouts.
 * Handles breakpoints, device types, and orientation.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

// Breakpoints matching Tailwind defaults
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;
export type DeviceType = 'phone' | 'tablet' | 'desktop';
export type Orientation = 'portrait' | 'landscape';

interface ScreenSizeState {
  // Dimensions
  width: number;
  height: number;

  // Breakpoints (true if viewport is >= breakpoint)
  isSm: boolean;
  isMd: boolean;
  isLg: boolean;
  isXl: boolean;
  is2xl: boolean;

  // Device type detection
  deviceType: DeviceType;

  // Mobile detection (convenience)
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;

  // Orientation
  orientation: Orientation;

  // Specific layouts
  isPhonePortrait: boolean;
  isPhoneLandscape: boolean;
  isTabletPortrait: boolean;
  isTabletLandscape: boolean;
}

/**
 * Hook for comprehensive screen size detection
 */
export function useScreenSize(): ScreenSizeState {
  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1024,
    height: typeof window !== 'undefined' ? window.innerHeight : 768,
  });

  const updateDimensions = useCallback(() => {
    setDimensions({
      width: window.innerWidth,
      height: window.innerHeight,
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Handle resize
    window.addEventListener('resize', updateDimensions);

    // Handle orientation change (mobile)
    window.addEventListener('orientationchange', updateDimensions);

    // Also listen for visual viewport changes (keyboard open/close)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateDimensions);
    }

    return () => {
      window.removeEventListener('resize', updateDimensions);
      window.removeEventListener('orientationchange', updateDimensions);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateDimensions);
      }
    };
  }, [updateDimensions]);

  // Separate effect for initial measurement to avoid setState in effect body
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Use requestAnimationFrame to defer initial measurement
    const rafId = requestAnimationFrame(() => {
      setDimensions({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    });

    return () => cancelAnimationFrame(rafId);
  }, []);

  // Compute derived state
  return useMemo((): ScreenSizeState => {
    const { width, height } = dimensions;

    // Breakpoints
    const isSm = width >= BREAKPOINTS.sm;
    const isMd = width >= BREAKPOINTS.md;
    const isLg = width >= BREAKPOINTS.lg;
    const isXl = width >= BREAKPOINTS.xl;
    const is2xl = width >= BREAKPOINTS['2xl'];

    // Device type based on width
    let deviceType: DeviceType;
    if (width < BREAKPOINTS.md) {
      deviceType = 'phone';
    } else if (width < BREAKPOINTS.lg) {
      deviceType = 'tablet';
    } else {
      deviceType = 'desktop';
    }

    // Orientation
    const orientation: Orientation = width > height ? 'landscape' : 'portrait';

    // Specific layout states
    const isPhonePortrait = deviceType === 'phone' && orientation === 'portrait';
    const isPhoneLandscape = deviceType === 'phone' && orientation === 'landscape';
    const isTabletPortrait = deviceType === 'tablet' && orientation === 'portrait';
    const isTabletLandscape = deviceType === 'tablet' && orientation === 'landscape';

    return {
      width,
      height,
      isSm,
      isMd,
      isLg,
      isXl,
      is2xl,
      deviceType,
      isMobile: deviceType === 'phone' || deviceType === 'tablet',
      isTablet: deviceType === 'tablet',
      isDesktop: deviceType === 'desktop',
      orientation,
      isPhonePortrait,
      isPhoneLandscape,
      isTabletPortrait,
      isTabletLandscape,
    };
  }, [dimensions]);
}

/**
 * Hook to detect if current layout should use two-pane layout
 * Two-pane: sidebar visible alongside content
 */
export function useTwoPaneLayout(): boolean {
  const { deviceType, orientation } = useScreenSize();

  // Two-pane on:
  // - Desktop (always)
  // - Tablet in landscape
  return deviceType === 'desktop' || (deviceType === 'tablet' && orientation === 'landscape');
}

/**
 * Hook to detect if sidebar should be collapsible
 * Collapsible: sidebar can be hidden/shown
 */
export function useCollapsibleSidebar(): boolean {
  const { deviceType, orientation } = useScreenSize();

  // Collapsible on:
  // - Tablet in portrait (can show/hide sidebar)
  return deviceType === 'tablet' && orientation === 'portrait';
}

/**
 * Hook to detect if bottom navigation should be shown
 */
export function useBottomNav(): boolean {
  const { deviceType } = useScreenSize();

  // Bottom nav on:
  // - Phone (always)
  // - Tablet in portrait (optional, but consistent)
  return deviceType === 'phone';
}

/**
 * Hook to get responsive value based on current breakpoint
 */
export function useResponsiveValue<T>(values: {
  default: T;
  sm?: T;
  md?: T;
  lg?: T;
  xl?: T;
  '2xl'?: T;
}): T {
  const { isSm, isMd, isLg, isXl, is2xl } = useScreenSize();

  if (is2xl && values['2xl'] !== undefined) return values['2xl'];
  if (isXl && values.xl !== undefined) return values.xl;
  if (isLg && values.lg !== undefined) return values.lg;
  if (isMd && values.md !== undefined) return values.md;
  if (isSm && values.sm !== undefined) return values.sm;

  return values.default;
}

/**
 * Hook to detect keyboard visibility on mobile
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

export default useScreenSize;
