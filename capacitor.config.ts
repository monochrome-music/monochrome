import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'tf.monochrome.music',
    appName: 'Monochrome Music',
    webDir: 'dist',
    assets: {
        iconBackgroundColor: '#000000',
        iconBackgroundColorDark: '#000000',
        splashBackgroundColor: '#000000',
        splashBackgroundColorDark: '#000000',
    },
    // Uncomment for live reload during development (requires `npm run dev` running on PC)
    // server: {
    //     url: 'http://192.168.1.7:5173',
    //     cleartext: true,
    // },
};

export default config;
