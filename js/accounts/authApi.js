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
