// js/accounts/config.js
import { Client, Account } from 'appwrite';

const client = new Client()
    .setEndpoint('https://auth.samidy.xyz/v1') 
    .setProject('auth-for-monochrome');

const account = new Account(client);

export { client, account as auth };
export const saveFirebaseConfig = () => { console.log("ill fix this tomorrow"); };
export const clearFirebaseConfig = () => { console.log("ill fix this tomorrow"); };