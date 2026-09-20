// js/accounts/config.js
import { createAuthClient } from 'better-auth/client';

const getBaseURL = () => {
    const local = localStorage.getItem('monochrome-auth-url');
    if (local) return local;

    if (window.__AUTH_URL__) return window.__AUTH_URL__;

    const hostname = window.location.hostname;
    if (
        hostname.endsWith('monochrome.st') ||
        hostname === 'monochrome.st' ||
        hostname.endsWith('monochrome.tf') ||
        hostname === 'monochrome.tf'
    ) {
        return 'https://auth.monochrome.st';
    }
    return 'https://auth.monochrome.st';
};

export const AUTH_BASE_URL = getBaseURL();

export const authClient = createAuthClient({
    baseURL: AUTH_BASE_URL,
});

export { authClient as auth };
