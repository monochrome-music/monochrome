//js/accounts/pocketbase.js
import PocketBase from 'pocketbase';
import { db } from '../db.js';
import { authManager } from './auth.js';
import { authApi } from './authApi.js';

const DEFAULT_POCKETBASE_URL = 'https://data.samidy.xyz';
const POCKETBASE_URL =
    window.__POCKETBASE_URL__ || localStorage.getItem('monochrome-pocketbase-url') || DEFAULT_POCKETBASE_URL;

console.log('[PocketBase] Using URL:', POCKETBASE_URL);

const pb = new PocketBase(POCKETBASE_URL);
pb.autoCancellation(false);

const syncManager = {
    pb: pb,
    _userRecordCache: null,
    _getUserRecordPromise: null,
    _isSyncing: false,

    async _getUserRecord(uid) {
        if (!uid) return null;

        if (this._userRecordCache && this._userRecordCache.firebase_id === uid) {
            return this._userRecordCache;
        }

        if (this._getUserRecordPromise && this._getUserRecordPromise.uid === uid) {
            return this._getUserRecordPromise.promise;
        }

        const promise = (async () => {
            try {
                const data = await authApi('/api/sync');
                const record = {
                    id: data.appUserId,
                    firebase_id: uid,
                    username: data.profile?.username,
                    display_name: data.profile?.display_name,
                    avatar_url: data.profile?.avatar_url,
                    banner: data.profile?.banner,
                    status: data.profile?.status,
                    about: data.profile?.about,
                    website: data.profile?.website,
                    privacy: data.profile?.privacy || { playlists: 'public', lastfm: 'public' },
                    lastfm_username: data.profile?.lastfm_username,
                    librefm_username: data.profile?.librefm_username,
                    favorite_albums: data.profile?.favorite_albums || [],
                    library: data.library || {},
                    history: data.history || [],
                    user_playlists: data.userPlaylists || {},
                    user_folders: data.userFolders || {},
                };
                this._userRecordCache = record;
                return record;
            } catch (error) {
                console.error('[CloudSync] Failed to get user sync data:', error);
                return null;
            } finally {
                this._getUserRecordPromise = null;
            }
        })();

        this._getUserRecordPromise = { uid, promise };
        return promise;
    },

    async getUserData() {
        const user = authManager.user;
        if (!user) return null;

        const record = await this._getUserRecord(user.$id);
        if (!record) return null;

        const library = this.safeParseInternal(record.library, 'library', {});
        const history = this.safeParseInternal(record.history, 'history', []);
        const userPlaylists = this._dedupeRecordMap(
            this.safeParseInternal(record.user_playlists, 'user_playlists', {}),
            'playlist'
        );
        const userFolders = this._dedupeRecordMap(
            this.safeParseInternal(record.user_folders, 'user_folders', {}),
            'folder'
        );
        const favoriteAlbums = this.safeParseInternal(record.favorite_albums, 'favorite_albums', []);

        const profile = {
            username: record.username,
            display_name: record.display_name,
            avatar_url: record.avatar_url,
            banner: record.banner,
            status: record.status,
            about: record.about,
            website: record.website,
            privacy: this.safeParseInternal(record.privacy, 'privacy', { playlists: 'public', lastfm: 'public' }),
            lastfm_username: record.lastfm_username,
            favorite_albums: favoriteAlbums,
        };

        return { library, history, userPlaylists, userFolders, profile };
    },

    async _updateUserJSON(uid, field, data) {
        const record = await this._getUserRecord(uid);
        if (!record) {
            console.error('Cannot update: no user record found');
            return;
        }

        try {
            const syncFieldMap = {
                library: 'library',
                history: 'history',
                user_playlists: 'userPlaylists',
                user_folders: 'userFolders',
            };
            const syncField = syncFieldMap[field];
            if (!syncField) return;
            let payload = data;
            if (field === 'user_playlists') payload = this._dedupeRecordMap(data, 'playlist');
            if (field === 'user_folders') payload = this._dedupeRecordMap(data, 'folder');
            const updated = await authApi('/api/sync', {
                method: 'PATCH',
                body: JSON.stringify({ [syncField]: payload }),
            });
            this._userRecordCache = {
                ...record,
                library: updated.library || record.library,
                history: updated.history || record.history,
                user_playlists: updated.userPlaylists || record.user_playlists,
                user_folders: updated.userFolders || record.user_folders,
            };
        } catch (error) {
            console.error(`Failed to sync ${field} to auth server:`, error);
        }
    },

    safeParseInternal(str, _fieldName, fallback) {
        if (!str) return fallback;
        if (typeof str !== 'string') return str;
        try {
            return JSON.parse(str);
        } catch {
            try {
                // Recovery attempt: replace illegal internal quotes in name/title fields
                const recovered = str.replace(/(:\s*")(.+?)("(?=\s*[,}\n\r]))/g, (_match, p1, p2, p3) => {
                    const escapedContent = p2.replace(/(?<!\\)"/g, '\\"');
                    return p1 + escapedContent + p3;
                });
                return JSON.parse(recovered);
            } catch {
                try {
                    // Python-style fallback (Single quotes, True/False, None)
                    // This handles data that was incorrectly serialized as Python repr string
                    if (str.includes("'") || str.includes('True') || str.includes('False')) {
                        const jsFriendly = str
                            .replace(/\bTrue\b/g, 'true')
                            .replace(/\bFalse\b/g, 'false')
                            .replace(/\bNone\b/g, 'null');

                        // Basic safety check: ensure it looks like a structure and doesn't contain obvious code vectors
                        if (
                            (jsFriendly.trim().startsWith('[') || jsFriendly.trim().startsWith('{')) &&
                            !jsFriendly.match(/function|=>|window|document|alert|eval/)
                        ) {
                            // TODO: maybe this could be parsed as json5?
                            // eslint-disable-next-line @typescript-eslint/no-implied-eval
                            return new Function('return ' + jsFriendly)();
                        }
                    }
                } catch (error) {
                    console.log(error); // Ignore fallback error
                }
                return fallback;
            }
        }
    },

    _recordTimestamp(value) {
        const parsed = Number(value || 0);
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
        const date = Date.parse(value || '');
        return Number.isFinite(date) ? date : 0;
    },

    _playlistFingerprint(playlist) {
        const tracks = Array.isArray(playlist?.tracks) ? playlist.tracks : [];
        return JSON.stringify({
            name: String(playlist?.name || playlist?.title || '').trim().toLowerCase(),
            description: String(playlist?.description || ''),
            cover: String(playlist?.cover || playlist?.image || playlist?.cover_url || ''),
            isPublic: playlist?.isPublic === true || playlist?.is_public === true,
            tracks: tracks.map((track) => `${track?.type || track?.item_type || 'track'}:${track?.id || track?.item_id || ''}`),
        });
    },

    _folderFingerprint(folder) {
        const playlists = Array.isArray(folder?.playlists) ? folder.playlists : [];
        return JSON.stringify({
            name: String(folder?.name || '').trim().toLowerCase(),
            cover: String(folder?.cover || folder?.image || folder?.cover_url || ''),
            playlists: playlists.map(String).sort(),
        });
    },

    _dedupeRecordMap(records, _type) {
        const source = records && typeof records === 'object' && !Array.isArray(records) ? records : {};
        const byIdentity = new Map();

        for (const [key, value] of Object.entries(source)) {
            if (!value || typeof value !== 'object') continue;
            const record = { ...value, id: value.id || key };
            const identity = record.canonicalId ? `canonical:${record.canonicalId}` : `id:${record.id}`;
            const existing = byIdentity.get(identity);
            const recordTime = this._recordTimestamp(record.updatedAt || record.updated || record.createdAt || record.created);
            const existingTime = existing
                ? this._recordTimestamp(existing.updatedAt || existing.updated || existing.createdAt || existing.created)
                : -1;
            if (!existing || recordTime >= existingTime) {
                byIdentity.set(identity, record);
            }
        }

        const deduped = {};
        for (const record of byIdentity.values()) {
            if (record.id) deduped[record.id] = record;
        }
        return deduped;
    },

    async syncLibraryItem(type, item, added) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.$id);
        if (!record) return;

        let library = this.safeParseInternal(record.library, 'library', {});

        const pluralType = type === 'mix' ? 'mixes' : `${type}s`;
        const key = type === 'playlist' ? item.uuid : item.id;

        if (!library[pluralType]) {
            library[pluralType] = {};
        }

        if (added) {
            library[pluralType][key] = this._minifyItem(type, item);
        } else {
            delete library[pluralType][key];
        }

        await this._updateUserJSON(user.$id, 'library', library);
    },

    _minifyItem(type, item) {
        if (!item) return item;

        const base = {
            id: item.id,
            addedAt: item.addedAt || Date.now(),
        };

        if (type === 'track') {
            return {
                ...base,
                title: item.title || null,
                duration: item.duration || null,
                explicit: item.explicit || false,
                artist: item.artist || (item.artists && item.artists.length > 0 ? item.artists[0] : null) || null,
                artists: item.artists?.map((a) => ({ id: a.id, name: a.name || null })) || [],
                album: item.album
                    ? {
                          id: item.album.id,
                          title: item.album.title || null,
                          cover: item.album.cover || null,
                          releaseDate: item.album.releaseDate || null,
                          vibrantColor: item.album.vibrantColor || null,
                          artist: item.album.artist || null,
                          numberOfTracks: item.album.numberOfTracks || null,
                      }
                    : null,
                copyright: item.copyright || null,
                isrc: item.isrc || null,
                trackNumber: item.trackNumber || null,
                streamStartDate: item.streamStartDate || null,
                version: item.version || null,
                mixes: item.mixes || null,
                isPodcast: item.isPodcast || (item.id && String(item.id).startsWith('podcast_')) || null,
                enclosureUrl: item.enclosureUrl || null,
                enclosureType: item.enclosureType || null,
                enclosureLength: item.enclosureLength || null,
            };
        }

        if (type === 'video') {
            return {
                ...base,
                type: 'video',
                title: item.title || null,
                duration: item.duration || null,
                image: item.image || item.cover || null,
                artist: item.artist || (item.artists && item.artists.length > 0 ? item.artists[0] : null) || null,
                artists: item.artists?.map((a) => ({ id: a.id, name: a.name || null })) || [],
                album: item.album || { title: 'Video', cover: item.image || item.cover },
            };
        }

        if (type === 'album') {
            return {
                ...base,
                title: item.title || null,
                cover: item.cover || null,
                releaseDate: item.releaseDate || null,
                explicit: item.explicit || false,
                artist: item.artist
                    ? { name: item.artist.name || null, id: item.artist.id }
                    : item.artists?.[0]
                      ? { name: item.artists[0].name || null, id: item.artists[0].id }
                      : null,
                type: item.type || null,
                numberOfTracks: item.numberOfTracks || null,
            };
        }

        if (type === 'artist') {
            return {
                ...base,
                name: item.name || null,
                picture: item.picture || item.image || null,
            };
        }

        if (type === 'playlist') {
            return {
                uuid: item.uuid || item.id,
                addedAt: item.addedAt || Date.now(),
                title: item.title || item.name || null,
                image: item.image || item.squareImage || item.cover || null,
                numberOfTracks: item.numberOfTracks || (item.tracks ? item.tracks.length : 0),
                user: item.user ? { name: item.user.name || null } : null,
            };
        }

        if (type === 'mix') {
            return {
                id: item.id,
                addedAt: item.addedAt || Date.now(),
                title: item.title,
                subTitle: item.subTitle,
                mixType: item.mixType,
                cover: item.cover,
            };
        }

        return item;
    },

    async syncHistoryItem(historyEntry) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.$id);
        if (!record) return;

        let history = this.safeParseInternal(record.history, 'history', []);

        const newHistory = [historyEntry, ...history].slice(0, 100);
        await this._updateUserJSON(user.$id, 'history', newHistory);
    },

    async clearHistory() {
        const user = authManager.user;
        if (!user) return;

        await this._updateUserJSON(user.$id, 'history', []);
    },

    async syncUserPlaylist(playlist, action) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.$id);
        if (!record) return;

        let userPlaylists = this.safeParseInternal(record.user_playlists, 'user_playlists', {});

        if (action === 'delete') {
            delete userPlaylists[playlist.id];
            await this.unpublishPlaylist(playlist.id);
        } else {
            userPlaylists[playlist.id] = {
                id: playlist.id,
                name: playlist.name,
                cover: playlist.cover || null,
                tracks: playlist.tracks ? playlist.tracks.map((t) => this._minifyItem(t.type || 'track', t)) : [],
                createdAt: playlist.createdAt || Date.now(),
                updatedAt: playlist.updatedAt || Date.now(),
                numberOfTracks: playlist.tracks ? playlist.tracks.length : 0,
                images: playlist.images || [],
                isPublic: playlist.isPublic || false,
            };

            if (playlist.isPublic) {
                await this.publishPlaylist(playlist);
            }
        }

        await this._updateUserJSON(user.$id, 'user_playlists', userPlaylists);
    },

    async syncUserFolder(folder, action) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.$id);
        if (!record) return;

        let userFolders = this.safeParseInternal(record.user_folders, 'user_folders', {});

        if (action === 'delete') {
            delete userFolders[folder.id];
        } else {
            userFolders[folder.id] = {
                id: folder.id,
                name: folder.name,
                cover: folder.cover || null,
                playlists: folder.playlists || [],
                createdAt: folder.createdAt || Date.now(),
                updatedAt: folder.updatedAt || Date.now(),
            };
        }

        await this._updateUserJSON(user.$id, 'user_folders', userFolders);
    },

    async getPublicPlaylist(uuid) {
        try {
            const record = await authApi(`/api/public/playlists/${encodeURIComponent(uuid)}`);
            const tracks = (record.tracks || []).map((track) => ({
                ...(track.metadata || {}),
                id: track.item_id,
                type: track.item_type,
            }));
            const finalCover = record.cover_url || '';
            let images = [];

            if (!finalCover && tracks && tracks.length > 0) {
                const uniqueCovers = [];
                const seenCovers = new Set();
                for (const track of tracks) {
                    const c = track.album?.cover;
                    if (c && !seenCovers.has(c)) {
                        seenCovers.add(c);
                        uniqueCovers.push(c);
                        if (uniqueCovers.length >= 4) break;
                    }
                }
                images = uniqueCovers;
            }

            let finalTitle = record.name;
            if (!finalTitle) finalTitle = 'Untitled Playlist';

            let finalDescription = record.description || '';

            return {
                ...record,
                id: record.client_id || record.id,
                serverId: record.id,
                name: finalTitle,
                title: finalTitle,
                description: finalDescription,
                cover: finalCover,
                image: finalCover,
                tracks: tracks,
                images: images,
                numberOfTracks: tracks.length,
                type: 'user-playlist',
                isPublic: true,
                user: { name: 'Community Playlist' },
            };
        } catch (error) {
            if (error.status === 404) return null;
            console.error('Failed to fetch public playlist:', error);
            throw error;
        }
    },

    async publishPlaylist(playlist) {
        if (!playlist || !playlist.id) return;
        const uid = authManager.user?.$id;
        if (!uid) return;
        // Public state is now stored on the normalized playlist row by syncUserPlaylist().
    },

    async unpublishPlaylist(_uuid) {
        const uid = authManager.user?.$id;
        if (!uid) return;
        // Public state is now stored on the normalized playlist row by syncUserPlaylist().
    },

    async getProfile(username) {
        try {
            const record = await authApi(`/api/users/${encodeURIComponent(username)}`);
            return {
                ...record,
                banner: record.banner_url,
                privacy: {
                    playlists: record.privacy_playlists || 'public',
                    lastfm: record.privacy_lastfm || 'public',
                },
                user_playlists: record.user_playlists || {},
                favorite_albums: record.favorite_albums || [],
            };
        } catch {
            return null;
        }
    },

    async updateProfile(data) {
        const user = authManager.user;
        if (!user) return;
        const record = await this._getUserRecord(user.$id);
        if (!record) return;

        const updateData = { ...data };
        if ('banner' in updateData) {
            updateData.banner_url = updateData.banner;
            delete updateData.banner;
        }
        if (updateData.privacy) {
            updateData.privacy_playlists = updateData.privacy.playlists || 'public';
            updateData.privacy_lastfm = updateData.privacy.lastfm || 'public';
            delete updateData.privacy;
        }

        const updated = await authApi('/api/me/profile', {
            method: 'PATCH',
            body: JSON.stringify(updateData),
        });
        this._userRecordCache = {
            ...record,
            ...updated,
            banner: updated.banner_url,
            privacy: {
                playlists: updated.privacy_playlists || record.privacy?.playlists || 'public',
                lastfm: updated.privacy_lastfm || record.privacy?.lastfm || 'public',
            },
        };
    },

    async isUsernameTaken(username) {
        try {
            await authApi(`/api/users/${encodeURIComponent(username)}`);
            return true;
        } catch (error) {
            if (error.response?.status === 404 || error.status === 404) return false;
            throw error;
        }
    },

    async clearCloudData() {
        const user = authManager.user;
        if (!user) return;

        try {
            await authApi('/api/sync', {
                method: 'PATCH',
                body: JSON.stringify({
                    library: {},
                    history: [],
                    userPlaylists: {},
                    userFolders: {},
                }),
            });
            this._userRecordCache = null;
            alert('Cloud data cleared successfully.');
        } catch (error) {
            console.error('Failed to clear cloud data!', error);
            alert('Failed to clear cloud data! :( Check console for details.');
        }
    },

    async onAuthStateChanged(user) {
        if (user) {
            if (this._isSyncing) return;

            this._isSyncing = true;

            try {
                const cloudData = await this.getUserData();

                if (cloudData) {
                    let database = db;

                    const localData = {
                        tracks: (await database.getAll('favorites_tracks')) || [],
                        albums: (await database.getAll('favorites_albums')) || [],
                        artists: (await database.getAll('favorites_artists')) || [],
                        playlists: (await database.getAll('favorites_playlists')) || [],
                        mixes: (await database.getAll('favorites_mixes')) || [],
                        history: (await database.getAll('history_tracks')) || [],
                        userPlaylists: (await database.getAll('user_playlists')) || [],
                        userFolders: (await database.getAll('user_folders')) || [],
                    };

                    let { library, history, userPlaylists, userFolders } = cloudData;
                    let needsUpdate = false;

                    if (!library) library = {};
                    if (!library.tracks) library.tracks = {};
                    if (!library.albums) library.albums = {};
                    if (!library.artists) library.artists = {};
                    if (!library.playlists) library.playlists = {};
                    if (!library.mixes) library.mixes = {};
                    if (!userPlaylists) userPlaylists = {};
                    if (!userFolders) userFolders = {};
                    if (!history) history = [];
                    userPlaylists = this._dedupeRecordMap(userPlaylists, 'playlist');
                    userFolders = this._dedupeRecordMap(userFolders, 'folder');

                    const mergeItem = (collection, item, type) => {
                        const id = type === 'playlist' ? item.uuid || item.id : item.id;
                        if (!collection[id]) {
                            collection[id] = this._minifyItem(type, item);
                            needsUpdate = true;
                        }
                    };

                    localData.tracks.forEach((item) => mergeItem(library.tracks, item, 'track'));
                    localData.albums.forEach((item) => mergeItem(library.albums, item, 'album'));
                    localData.artists.forEach((item) => mergeItem(library.artists, item, 'artist'));
                    localData.playlists.forEach((item) => mergeItem(library.playlists, item, 'playlist'));
                    localData.mixes.forEach((item) => mergeItem(library.mixes, item, 'mix'));

                    localData.userPlaylists.forEach((playlist) => {
                        if (!userPlaylists[playlist.id]) {
                            userPlaylists[playlist.id] = {
                                id: playlist.id,
                                name: playlist.name,
                                cover: playlist.cover || null,
                                tracks: playlist.tracks
                                    ? playlist.tracks.map((t) => this._minifyItem(t.type || 'track', t))
                                    : [],
                                createdAt: playlist.createdAt || Date.now(),
                                updatedAt: playlist.updatedAt || Date.now(),
                                numberOfTracks: playlist.tracks ? playlist.tracks.length : 0,
                                images: playlist.images || [],
                                isPublic: playlist.isPublic || false,
                            };
                            needsUpdate = true;
                        }
                    });
                    userPlaylists = this._dedupeRecordMap(userPlaylists, 'playlist');

                    localData.userFolders.forEach((folder) => {
                        if (!userFolders[folder.id]) {
                            userFolders[folder.id] = {
                                id: folder.id,
                                name: folder.name,
                                cover: folder.cover || null,
                                playlists: folder.playlists || [],
                                createdAt: folder.createdAt || Date.now(),
                                updatedAt: folder.updatedAt || Date.now(),
                            };
                            needsUpdate = true;
                        }
                    });
                    userFolders = this._dedupeRecordMap(userFolders, 'folder');

                    const combinedHistory = [...history, ...localData.history];
                    combinedHistory.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

                    const uniqueHistory = [];
                    const seenTimestamps = new Set();

                    for (const item of combinedHistory) {
                        if (!item.timestamp) continue;
                        if (!seenTimestamps.has(item.timestamp)) {
                            seenTimestamps.add(item.timestamp);
                            uniqueHistory.push(item);
                        }
                        if (uniqueHistory.length >= 100) break;
                    }

                    if (JSON.stringify(history) !== JSON.stringify(uniqueHistory)) {
                        history = uniqueHistory;
                        needsUpdate = true;
                    }

                    if (needsUpdate) {
                        await this._updateUserJSON(user.$id, 'library', library);
                        await this._updateUserJSON(user.$id, 'user_playlists', userPlaylists);
                        await this._updateUserJSON(user.$id, 'user_folders', userFolders);
                        await this._updateUserJSON(user.$id, 'history', history);
                    }

                    const convertedData = {
                        favorites_tracks: Object.values(library.tracks).filter((t) => t && typeof t === 'object'),
                        favorites_albums: Object.values(library.albums).filter((a) => a && typeof a === 'object'),
                        favorites_artists: Object.values(library.artists).filter((a) => a && typeof a === 'object'),
                        favorites_playlists: Object.values(library.playlists).filter((p) => p && typeof p === 'object'),
                        favorites_mixes: Object.values(library.mixes).filter((m) => m && typeof m === 'object'),
                        history_tracks: history,
                        user_playlists: Object.values(userPlaylists).filter((p) => p && typeof p === 'object'),
                        user_folders: Object.values(userFolders).filter((f) => f && typeof f === 'object'),
                    };

                    // Safety check: if we had local data but merged result is completely empty, something went wrong.
                    // Do NOT call importData as it would wipe the user's local stores.
                    const hadLocalData =
                        localData.tracks.length > 0 ||
                        localData.albums.length > 0 ||
                        localData.artists.length > 0 ||
                        localData.playlists.length > 0 ||
                        localData.mixes.length > 0 ||
                        localData.history.length > 0 ||
                        localData.userPlaylists.length > 0 ||
                        localData.userFolders.length > 0;

                    const isConvertedEmpty =
                        convertedData.favorites_tracks.length === 0 &&
                        convertedData.favorites_albums.length === 0 &&
                        convertedData.favorites_artists.length === 0 &&
                        convertedData.favorites_playlists.length === 0 &&
                        convertedData.favorites_mixes.length === 0 &&
                        convertedData.history_tracks.length === 0 &&
                        convertedData.user_playlists.length === 0 &&
                        convertedData.user_folders.length === 0;

                    if (hadLocalData && isConvertedEmpty) {
                        console.warn(
                            '[PocketBase] Sync aborted: local data exists but merged result is empty. Preserving local data to prevent accidental wipe.'
                        );
                    } else {
                        await database.importData(convertedData, true);
                    }
                    await new Promise((resolve) => setTimeout(resolve, 300));

                    window.dispatchEvent(new CustomEvent('library-changed'));
                    window.dispatchEvent(new CustomEvent('history-changed'));
                    window.dispatchEvent(new HashChangeEvent('hashchange'));

                    console.log('[PocketBase] ✓ Sync completed');
                }
            } catch (error) {
                console.error('[PocketBase] Sync error:', error);
            } finally {
                this._isSyncing = false;
            }
        } else {
            this._userRecordCache = null;
            this._isSyncing = false;
        }
    },
};

if (pb) {
    authManager.onAuthStateChanged(syncManager.onAuthStateChanged.bind(syncManager));
}

export { pb, syncManager };
