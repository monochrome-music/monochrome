import express from 'express';
import cors from 'cors';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { auth, db } from './auth.js';

// --- App-data table (library / history / playlists / folders / profile) ---
// Keyed by the better-auth user id. This is the store the Monochrome client
// reads and writes through /api/sync.
db.exec(`
  CREATE TABLE IF NOT EXISTS app_user_data (
    user_id        TEXT PRIMARY KEY,
    username       TEXT UNIQUE,
    profile        TEXT NOT NULL DEFAULT '{}',
    library        TEXT NOT NULL DEFAULT '{}',
    history        TEXT NOT NULL DEFAULT '[]',
    user_playlists TEXT NOT NULL DEFAULT '{}',
    user_folders   TEXT NOT NULL DEFAULT '{}'
  );
`);

const j = (v, fallback) => {
    try {
        return v == null ? fallback : JSON.parse(v);
    } catch {
        return fallback;
    }
};

function getOrCreateRow(userId) {
    let row = db.prepare('SELECT * FROM app_user_data WHERE user_id = ?').get(userId);
    if (!row) {
        db.prepare('INSERT INTO app_user_data (user_id) VALUES (?)').run(userId);
        row = db.prepare('SELECT * FROM app_user_data WHERE user_id = ?').get(userId);
    }
    return row;
}

function toSyncPayload(user, row) {
    return {
        appUserId: user.id,
        profile: j(row.profile, {}),
        library: j(row.library, {}),
        history: j(row.history, []),
        userPlaylists: j(row.user_playlists, {}),
        userFolders: j(row.user_folders, {}),
    };
}

const app = express();
app.set('trust proxy', 1); // behind Caddy/reverse proxy

const trustedOrigins = (process.env.TRUSTED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

app.use(
    cors({
        origin: trustedOrigins.length ? trustedOrigins : true,
        credentials: true,
    })
);

// better-auth handler must be mounted BEFORE express.json().
app.all('/api/auth/*', toNodeHandler(auth));

app.use(express.json({ limit: '15mb' }));

app.get('/health', (_req, res) => res.send('OK'));

async function requireUser(req, res) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return null;
    }
    return session.user;
}

// Native/bearer session probe used by the mobile wrapper.
app.get('/api/me', async (req, res) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ user: session.user, session: session.session });
});

// --- Library sync ---
app.get('/api/sync', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const row = getOrCreateRow(user.id);
    res.json(toSyncPayload(user, row));
});

app.patch('/api/sync', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    getOrCreateRow(user.id);

    const map = {
        library: 'library',
        history: 'history',
        userPlaylists: 'user_playlists',
        userFolders: 'user_folders',
    };
    const sets = [];
    const vals = [];
    for (const [incoming, column] of Object.entries(map)) {
        if (req.body && Object.prototype.hasOwnProperty.call(req.body, incoming)) {
            sets.push(`${column} = ?`);
            vals.push(JSON.stringify(req.body[incoming]));
        }
    }
    if (sets.length) {
        vals.push(user.id);
        db.prepare(`UPDATE app_user_data SET ${sets.join(', ')} WHERE user_id = ?`).run(...vals);
    }
    const row = db.prepare('SELECT * FROM app_user_data WHERE user_id = ?').get(user.id);
    res.json({
        library: j(row.library, {}),
        history: j(row.history, []),
        userPlaylists: j(row.user_playlists, {}),
        userFolders: j(row.user_folders, {}),
    });
});

// --- Profile ---
app.patch('/api/me/profile', async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return;
    const row = getOrCreateRow(user.id);
    const profile = { ...j(row.profile, {}), ...(req.body || {}) };

    // Keep the username column in sync (used for lookups / uniqueness).
    let username = row.username;
    if (typeof profile.username === 'string' && profile.username.trim()) {
        const candidate = profile.username.trim();
        const taken = db
            .prepare('SELECT user_id FROM app_user_data WHERE username = ? AND user_id != ?')
            .get(candidate, user.id);
        if (taken) return res.status(409).json({ error: 'Username already taken' });
        username = candidate;
    }
    db.prepare('UPDATE app_user_data SET profile = ?, username = ? WHERE user_id = ?').run(
        JSON.stringify(profile),
        username,
        user.id
    );
    res.json(profile);
});

// --- Public profile lookup (also powers "is username taken") ---
app.get('/api/users/:username', (req, res) => {
    const row = db
        .prepare('SELECT * FROM app_user_data WHERE username = ?')
        .get(req.params.username);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const profile = j(row.profile, {});
    const privacy = profile.privacy || { playlists: 'public' };
    res.json({
        username: row.username,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url,
        banner: profile.banner,
        status: profile.status,
        about: profile.about,
        website: profile.website,
        favorite_albums: profile.favorite_albums || [],
        privacy,
    });
});

// Public playlist viewing is not backed by this minimal server.
app.get('/api/public/playlists/:uuid', (_req, res) => res.status(404).json({ error: 'Not found' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Monochrome auth server listening on :${PORT}`);
    console.log(`baseURL = ${process.env.AUTH_BASE_URL}`);
    console.log(`trustedOrigins = ${JSON.stringify(trustedOrigins)}`);
});
