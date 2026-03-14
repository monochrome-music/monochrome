import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'tf.monochrome.app',
  appName: 'Monochrome',
  webDir: 'www',

  // Load the live website instead of bundled assets
  server: {
    url: 'https://monochrome.tf',
    cleartext: false,
    // Allow navigation within the app domain
    allowNavigation: [
      'monochrome.tf',
      '*.monochrome.tf',
      'monochrome.samidy.com',
      // TIDAL API instances
      'eu-central.monochrome.tf',
      'us-west.monochrome.tf',
      'arran.monochrome.tf',
      // Auth providers
      '*.google.com',
      'accounts.google.com',
      // PocketBase sync
      '*.pocketbase.io',
    ],
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      launchFadeOutDuration: 500,
      backgroundColor: '#000000',
      showSpinner: true,
      spinnerColor: '#ffffff',
      androidSplashResourceName: 'splash',
      iosSpinnerStyle: 'large',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#000000',
      overlaysWebView: true,
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_notification',
      iconColor: '#ffffff',
    },
    ScreenOrientation: {
      // Allow all orientations on tablet, portrait on phone
    },
  },

  // iOS-specific configuration
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#000000',
    scrollEnabled: false,
    allowsLinkPreview: false,
    preferredContentMode: 'mobile',
    // Enable background audio
    limitsNavigationsToAppBoundDomains: false,
    handleApplicationNotifications: false,
  },

  // Android-specific configuration
  android: {
    backgroundColor: '#000000',
    allowMixedContent: false,
    useLegacyBridge: false,
    // Enable hardware acceleration for visualizers
    overrideUserAgent: 'Monochrome/2.5.0 (Android; Capacitor)',
  },
};

export default config;
