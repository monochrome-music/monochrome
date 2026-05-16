// js/accounts/config.js
import { createAuthClient } from 'https://esm.sh/better-auth/client';

const getBaseURL = () => {
    const local = localStorage.getItem('monochrome-auth-url');
    if (local) return local;

    if (window.__AUTH_URL__) return window.__AUTH_URL__;

    const hostname = window.location.hostname;
    if (hostname.endsWith('monochrome.tf') || hostname === 'monochrome.tf') {
        return 'https://auth.monochrome.tf';
    }
    return 'https://auth.samidy.com';
};

export const authClient = createAuthClient({
    baseURL: getBaseURL(),
});

export { authClient as auth };
