import { AUTH_BASE_URL } from './config.js';

export async function authApi(path, options = {}) {
    const response = await fetch(`${AUTH_BASE_URL}${path}`, {
        credentials: 'include',
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
        },
    });

    if (!response.ok) {
        const text = await response.text();
        const error = new Error(text || `Auth server error: ${response.status}`);
        error.status = response.status;
        throw error;
    }

    return response.status === 204 ? null : response.json();
}
