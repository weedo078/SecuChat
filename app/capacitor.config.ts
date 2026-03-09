import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.secuchat.app',
  appName: 'SecuChat',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true, // Required for localhost WebSocket connections to i2pd
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      releaseType: 'APK',
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#000000',
    },
    StatusBar: {
      backgroundColor: '#0f1115',
      style: 'DARK',
    },
  },
};

export default config;
