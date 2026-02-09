# Global Auth Gate

This document explains the optional server-side login gate and what it implies for your site.

## Overview

- When enabled, all HTML routes require login.
- Login uses Firebase Auth (Google or email) and exchanges a Firebase ID token for a server session.
- The session is stored in a signed cookie and checked on every request.

## Where it runs

- The gate runs only in `vite preview` (production-like server).
- The Vite dev server (`vite dev`) does not enable the gate.
- Static hosting cannot enforce the gate, because there is no server to verify tokens or set cookies.

## Flow

1. User requests `/` or any HTML route.
2. Server checks the `mono_session` cookie.
3. If missing, redirect to `/login`.
4. Login page signs in with Firebase and POSTs to `/api/auth/login`.
5. Server verifies the ID token and sets a session cookie.
6. User is redirected back to `/`.

## Configuration

- `AUTH_ENABLED=true` enables the gate (default is false).
- `AUTH_SECRET` is required when the gate is enabled. It signs the session cookie.
- `FIREBASE_PROJECT_ID` sets the Firebase project used to verify tokens.
- `FIREBASE_CONFIG` (JSON) injects config into the login page.
- `POCKETBASE_URL` hides the custom DB setting field.
- `SESSION_MAX_AGE` sets cookie lifetime in ms (default 7 days).

## Implications for the site

- Requires a server runtime. Pure static hosting will not force login.
- Unauthenticated requests to non-HTML assets return 401.
- `/login` and `/login.html` remain accessible to start the flow.
- Logging out clears the session and redirects to `/login`.
- Authenticated visits to `/login` redirect back to `/`.

## Enable (Docker)

1. `cp .env.example .env`
2. Set `AUTH_ENABLED=true` and `AUTH_SECRET=...`
3. Optionally set `FIREBASE_CONFIG` and `FIREBASE_PROJECT_ID`
4. `docker compose up -d`
5. Visit `http://localhost:3000`

## Enable (local preview)

1. `npm run build`
2. Set env vars in your shell or `.env`
3. `npm run preview`
