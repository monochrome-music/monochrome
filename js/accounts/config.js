import { Client, Account } from 'appwrite';

const getEndpoint = () => {
    const local = localStorage.getItem('monochrome-appwrite-endpoint');
    if (local) return local;

    if (window.__APPWRITE_ENDPOINT__) return window.__APPWRITE_ENDPOINT__;

    const hostname = window.location.hostname;
    if (hostname.endsWith('monochrome.tf') || hostname === 'monochrome.tf') {
        return 'https://auth.monochrome.tf/v1';
    }
    return 'https://auth.samidy.com/v1';
};

const getProject = () => {
    const local = localStorage.getItem('monochrome-appwrite-project');
    if (local) return local;

    if (window.__APPWRITE_PROJECT_ID__) return window.__APPWRITE_PROJECT_ID__;

    return 'auth-for-monochrome';
};

const client = new Client().setEndpoint(getEndpoint()).setProject(getProject());

const account = new Account(client);
export { client, account as auth };
