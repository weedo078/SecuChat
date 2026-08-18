import type { AppInfo } from '@capacitor/app';

let App: typeof import('@capacitor/app').App | null = null;
let isCapacitorAvailable = false;

async function loadApp() {
  if (typeof window === 'undefined') return;
  try {
    const mod = await import('@capacitor/app');
    App = mod.App;
    isCapacitorAvailable = true;
  } catch {
    isCapacitorAvailable = false;
  }
}

const loadPromise = loadApp();

export interface AppState {
  isActive: boolean;
}

export interface URLOpenListenerEvent {
  url: string;
}

export const CapacitorApp = {
  async isAvailable(): Promise<boolean> {
    await loadPromise;
    return isCapacitorAvailable;
  },

  async getInfo(): Promise<AppInfo | null> {
    await loadPromise;
    if (!App) return null;
    return App.getInfo();
  },

  async getState(): Promise<AppState | null> {
    await loadPromise;
    if (!App) return null;
    return App.getState();
  },

  onAppStateChange(callback: (state: AppState) => void): () => void {
    let cleanup = () => {};

    loadPromise.then(() => {
      if (!App) return;
      const listener = App.addListener('appStateChange', callback);
      cleanup = () => {
        listener.then(l => l.remove());
      };
    });

    return () => cleanup();
  },

  onPause(callback: () => void): () => void {
    return this.onAppStateChange((state) => {
      if (!state.isActive) callback();
    });
  },

  onResume(callback: () => void): () => void {
    return this.onAppStateChange((state) => {
      if (state.isActive) callback();
    });
  },

  onAppUrlOpen(callback: (event: URLOpenListenerEvent) => void): () => void {
    let cleanup = () => {};

    loadPromise.then(() => {
      if (!App) return;
      const listener = App.addListener('appUrlOpen', callback);
      cleanup = () => {
        listener.then(l => l.remove());
      };
    });

    return () => cleanup();
  },

  async exitApp(): Promise<void> {
    await loadPromise;
    if (!App) return;
    await App.exitApp();
  },

  async minimizeApp(): Promise<void> {
    await loadPromise;
    if (!App) return;
    await App.minimizeApp();
  },
};
