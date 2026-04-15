import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.secuchat.app',
  appName: 'SecuChat',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Cleartext (HTTP) is required because the app communicates with the i2pd SAM bridge
    // via a local WebSocket proxy on localhost. Since i2pd listens on TCP (not TLS),
    // the WebSocket connection to 127.0.0.1:7657 must use ws:// (not wss://).
    // Android Network Security Config restricts cleartext to localhost only — see
    // android/app/src/main/res/xml/network_security_config.xml
    cleartext: true,
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
