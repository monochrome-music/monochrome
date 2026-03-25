//js/accounts/config.js
import PocketBase from 'pocketbase';

const getPocketBaseURL = () => {
    const local = localStorage.getItem('monochrome-pocketbase-url');
    if (local) return local;

    if (window.__POCKETBASE_URL__) return window.__POCKETBASE_URL__;

    const hostname = window.location.hostname;
    // Default to the user's custom server if on Netlify or samidy.com
    if (hostname.includes('netlify.app') || hostname.includes('samidy.com')) {
        return 'https://pb.ahbh.top';
    }
    
    // Default fallback
    return 'https://pb.ahbh.top';
};

const pb = new PocketBase(getPocketBaseURL());
pb.autoCancellation(false);

export { pb };
