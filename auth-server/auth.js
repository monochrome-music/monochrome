import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.DB_PATH || '/data/auth.db';
mkdirSync(dirname(DB_PATH), { recursive: true });

const trustedOrigins = (process.env.TRUSTED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

if (!process.env.AUTH_SECRET) {
    console.error('AUTH_SECRET is required');
    process.exit(1);
}
if (!process.env.AUTH_BASE_URL) {
    console.error('AUTH_BASE_URL is required (e.g. https://auth.example.com)');
    process.exit(1);
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Better-auth core schema (idempotent). Mirrors what `better-auth migrate`
// produces, so the container self-initializes with no migration step.
db.exec(`
  CREATE TABLE IF NOT EXISTS "user" (
    "id" text not null primary key,
    "name" text not null,
    "email" text not null unique,
    "emailVerified" integer not null,
    "image" text,
    "createdAt" date not null,
    "updatedAt" date not null
  );
  CREATE TABLE IF NOT EXISTS "session" (
    "id" text not null primary key,
    "expiresAt" date not null,
    "token" text not null unique,
    "createdAt" date not null,
    "updatedAt" date not null,
    "ipAddress" text,
    "userAgent" text,
    "userId" text not null references "user" ("id") on delete cascade
  );
  CREATE TABLE IF NOT EXISTS "account" (
    "id" text not null primary key,
    "accountId" text not null,
    "providerId" text not null,
    "userId" text not null references "user" ("id") on delete cascade,
    "accessToken" text, "refreshToken" text, "idToken" text,
    "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date,
    "scope" text, "password" text,
    "createdAt" date not null, "updatedAt" date not null
  );
  CREATE TABLE IF NOT EXISTS "verification" (
    "id" text not null primary key,
    "identifier" text not null,
    "value" text not null,
    "expiresAt" date not null,
    "createdAt" date not null,
    "updatedAt" date not null
  );
`);

export const auth = betterAuth({
    database: db,
    baseURL: process.env.AUTH_BASE_URL,
    secret: process.env.AUTH_SECRET,
    trustedOrigins,
    emailAndPassword: {
        enabled: true,
        // Personal instance: no SMTP wired up, so don't block on verification.
        requireEmailVerification: false,
        autoSignIn: true,
        minPasswordLength: 8,
    },
    // Social providers intentionally omitted — local accounts only.
    plugins: [bearer()],
});
