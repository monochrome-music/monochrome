import { AUTH_BASE_URL } from './config.js';
import { getAuthToken } from './auth.js';

const DATA_BASE_URL =
    window.__POCKETBASE_URL__ || localStorage.getItem('monochrome-pocketbase-url') || 'https://data.monochrome.st';

function buildApi(baseUrl, path, options = {}) {
    const token = getAuthToken();
    return fetch(`${baseUrl}${path}`, {
        credentials: 'include',
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {}),
        },
    });
}

async function handleResponse(response) {
    if (!response.ok) {
        const text = await response.text();
        let data = text;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = text;
        }
        const message =
            (data && typeof data === 'object' && (data.message || data.error)) ||
            text ||
            `Auth server error: ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return response.status === 204 ? null : response.json();
}

export async function authApi(path, options = {}) {
    const response = await buildApi(AUTH_BASE_URL, path, options);
    return handleResponse(response);
}

export async function dataApi(path, options = {}) {
    const response = await buildApi(DATA_BASE_URL, path, options);
    return handleResponse(response);
}

export { DATA_BASE_URL };
