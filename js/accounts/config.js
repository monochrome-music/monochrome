import { Client, Account } from 'appwrite';

const getEndpoint = () => {
    const hostname = window.location.hostname;
    if (hostname.endsWith('monochrome.tf') || hostname === 'monochrome.tf') {
        return 'https://auth.monochrome.tf/v1';
    }
    return 'https://auth.samidy.com/v1';
};

const client = new Client()
    .setEndpoint(getEndpoint())
    .setProject('auth-for-monochrome');

const account = new Account(client);
export { client, account as auth };
export const saveFirebaseConfig = () => { console.log("ill fix this tomorrow"); };
export const clearFirebaseConfig = () => { console.log("ill fix this tomorrow"); };