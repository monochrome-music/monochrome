import { Databases, ID, Query } from 'appwrite';
import { client } from './config.js';
import { db } from '../db.js';
import { authManager } from './auth.js';

const DATABASE_ID = 'database-monochrome';
const USERS_COLLECTION = 'DB_users';
const PUBLIC_COLLECTION = 'public_playlistspublic_playlists';

const databases = new Databases(client);

const parseFilterExpression = (filter) => {
    if (!filter || typeof filter !== 'string') return [];
    const matches = [...filter.matchAll(/([a-zA-Z0-9_$]+)\s*=\s*"([^"]*)"/g)];
    return matches.map(([, field, value]) => Query.equal(field, value));
};

const createPocketBaseCompat = () => ({
    collection(collectionId) {
        return {
            async getList(page = 1, perPage = 50, options = {}) {
                const queries = [...parseFilterExpression(options.filter), Query.limit(perPage), Query.offset((page - 1) * perPage)];
                if (options.sort) {
                    if (options.sort.startsWith('-')) {
                        queries.push(Query.orderDesc(options.sort.slice(1)));
                    } else {
                        queries.push(Query.orderAsc(options.sort));
                    }
                }
                const result = await databases.listDocuments(DATABASE_ID, collectionId, queries);
                return {
                    page,
                    perPage,
                    totalItems: result.total,
                    totalPages: Math.max(1, Math.ceil(result.total / perPage)),
                    items: result.documents,
                };
            },
            async getFirstListItem(filter) {
                const result = await databases.listDocuments(DATABASE_ID, collectionId, [
                    ...parseFilterExpression(filter),
                    Query.limit(1),
                ]);
                if (!result.documents.length) {
                    const notFound = new Error('Not found');
                    notFound.status = 404;
                    throw notFound;
                }
                return result.documents[0];
            },
            async getOne(id) {
                return databases.getDocument(DATABASE_ID, collectionId, id);
            },
            async create(data) {
                return databases.createDocument(DATABASE_ID, collectionId, ID.unique(), normalizeProfileUpdate(data));
            },
            async update(id, data) {
                return databases.updateDocument(DATABASE_ID, collectionId, id, normalizeProfileUpdate(data));
            },
            async delete(id) {
                return databases.deleteDocument(DATABASE_ID, collectionId, id);
            },
        };
    },
    files: {
        getUrl(record, fileName) {
            return fileName || record?.image || record?.cover || '';
        },
    },
});

const defaultUserPayload = (uid) => ({
    user_id: uid,
    username: '',
    display_name: '',
    avatar_url: '',
    banner: '',
    status: '',
    about: '',
    website: '',
    lastfm_username: '',
    privacy: JSON.stringify({ playlists: 'public', lastfm: 'public' }),
    user_settings: '{}',
    library: '{}',
    history: '[]',
    user_playlists: '{}',
    user_folders: '{}',
    favorite_albums: '[]',
});

const stringifyJSONField = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

const normalizeProfileUpdate = (data) => {
    const jsonFields = new Set([
        'privacy',
        'user_settings',
        'library',
        'history',
        'user_playlists',
        'user_folders',
        'favorite_albums',
        'tracks',
        'data',
    ]);

    const normalized = { ...data };
    Object.keys(normalized).forEach((key) => {
        if (jsonFields.has(key) && normalized[key] !== undefined && normalized[key] !== null) {
            normalized[key] = stringifyJSONField(normalized[key]);
        }
    });
    return normalized;
};

const syncManager = {
    pb: createPocketBaseCompat(),
    _userRecordCache: null,
    _getUserRecordPromise: null,
    _isSyncing: false,

    async _getUserRecord(uid) {
        if (!uid) return null;

        if (this._userRecordCache && this._userRecordCache.user_id === uid) {
            return this._userRecordCache;
        }

        if (this._getUserRecordPromise && this._getUserRecordPromise.uid === uid) {
            return this._getUserRecordPromise.promise;
        }

        const promise = (async () => {
            try {
                const result = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
                    Query.equal('user_id', uid),
                    Query.limit(1),
                ]);

                if (result.documents.length > 0) {
                    const record = result.documents[0];
                    this._userRecordCache = record;
                    return record;
                }

                try {
                    const newRecord = await databases.createDocument(
                        DATABASE_ID,
                        USERS_COLLECTION,
                        ID.unique(),
                        defaultUserPayload(uid)
                    );
                    this._userRecordCache = newRecord;
                    return newRecord;
                } catch (createError) {
                    const retryResult = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
                        Query.equal('user_id', uid),
                        Query.limit(1),
                    ]);
                    if (retryResult.documents.length > 0) {
                        this._userRecordCache = retryResult.documents[0];
                        return this._userRecordCache;
                    }
                    console.error('[Appwrite] Failed to create user:', createError);
                    return null;
                }
            } catch (error) {
                console.error('[Appwrite] Failed to get user:', error);
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
        const userPlaylists = this.safeParseInternal(record.user_playlists, 'user_playlists', {});
        const userFolders = this.safeParseInternal(record.user_folders, 'user_folders', {});
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
            const stringifiedData = stringifyJSONField(data);
            const updated = await databases.updateDocument(DATABASE_ID, USERS_COLLECTION, record.$id, {
                [field]: stringifiedData,
            });
            this._userRecordCache = updated;
        } catch (error) {
            console.error(`Failed to sync ${field} to Appwrite:`, error);
        }
    },

    safeParseInternal(str, fieldName, fallback) {
        if (!str) return fallback;
        if (typeof str !== 'string') return str;
        try {
            return JSON.parse(str);
        } catch {
            try {
                const recovered = str.replace(/(:\s*")(.+?)("(?=\s*[,}\n\r]))/g, (match, p1, p2, p3) => {
                    const escapedContent = p2.replace(/(?<!\\)"/g, '\\"');
                    return p1 + escapedContent + p3;
                });
                return JSON.parse(recovered);
            } catch {
                try {
                    if (str.includes("'") || str.includes('True') || str.includes('False')) {
                        const jsFriendly = str
                            .replace(/\bTrue\b/g, 'true')
                            .replace(/\bFalse\b/g, 'false')
                            .replace(/\bNone\b/g, 'null');

                        if (
                            (jsFriendly.trim().startsWith('[') || jsFriendly.trim().startsWith('{')) &&
                            !jsFriendly.match(/function|=>|window|document|alert|eval/)
                        ) {
                            return new Function('return ' + jsFriendly)();
                        }
                    }
                } catch (error) {
                    console.log(error);
                }
                return fallback;
            }
        }
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

    async syncSettings(settings) {
        const user = authManager.user;
        if (!user) return;
        await this._updateUserJSON(user.$id, 'user_settings', settings || {});
    },

    async getPublicPlaylist(uuid) {
        try {
            const docs = await databases.listDocuments(DATABASE_ID, PUBLIC_COLLECTION, [
                Query.equal('uuid', uuid),
                Query.limit(1),
            ]);
            const record = docs.documents[0];
            if (!record) return null;

            const extraData = this.safeParseInternal(record.data, 'data', {});
            const tracks = this.safeParseInternal(record.tracks, 'tracks', []);
            const finalCover = record.image || record.cover || record.playlist_cover || extraData.cover || '';
            const finalTitle =
                record.title || record.name || record.playlist_name || extraData.title || extraData.name || 'Untitled Playlist';
            const finalDescription = record.description || extraData.description || '';

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

            return {
                ...record,
                id: record.uuid,
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
                collaborative: record.collaborative !== false,
                user: { name: 'Community Playlist' },
            };
        } catch (error) {
            if (error?.code === 404) return null;
            console.error('Failed to fetch public playlist:', error);
            throw error;
        }
    },

    async publishPlaylist(playlist) {
        if (!playlist || !playlist.id) return;
        const uid = authManager.user?.$id;
        if (!uid) return;

        const data = {
            uuid: playlist.id,
            uid: uid,
            firebase_id: uid,
            title: playlist.name,
            name: playlist.name,
            playlist_name: playlist.name,
            image: playlist.cover || '',
            cover: playlist.cover || '',
            playlist_cover: playlist.cover || '',
            description: playlist.description || '',
            tracks: JSON.stringify(playlist.tracks || []),
            isPublic: true,
            collaborative: playlist.collaborative !== false,
            data: JSON.stringify({
                title: playlist.name,
                cover: playlist.cover || '',
                description: playlist.description || '',
            }),
        };

        try {
            const existing = await databases.listDocuments(DATABASE_ID, PUBLIC_COLLECTION, [
                Query.equal('uuid', playlist.id),
                Query.limit(1),
            ]);

            if (existing.documents.length > 0) {
                await databases.updateDocument(DATABASE_ID, PUBLIC_COLLECTION, existing.documents[0].$id, data);
            } else {
                await databases.createDocument(DATABASE_ID, PUBLIC_COLLECTION, ID.unique(), data);
            }
        } catch (error) {
            console.error('Failed to publish playlist:', error);
        }
    },

    async updatePublicPlaylistTracks(uuid, tracks, metadata = {}) {
        if (!uuid || !Array.isArray(tracks)) {
            throw new Error('Invalid collaborative playlist payload');
        }

        const uid = authManager.user?.$id;
        if (!uid) {
            throw new Error('Sign in required for collaborative edits');
        }

        const existing = await databases.listDocuments(DATABASE_ID, PUBLIC_COLLECTION, [
            Query.equal('uuid', uuid),
            Query.limit(1),
        ]);
        if (!existing.documents?.length) {
            throw new Error('Public playlist not found');
        }

        const record = existing.documents[0];
        if (record.collaborative === false) {
            throw new Error('Collaborative editing is disabled for this playlist');
        }

        const payload = {
            tracks: JSON.stringify(tracks),
            title: metadata.title || record.title || record.name || 'Untitled Playlist',
            name: metadata.title || record.name || record.title || 'Untitled Playlist',
            description: metadata.description ?? record.description ?? '',
            collaborative: record.collaborative !== false,
            data: JSON.stringify({
                title: metadata.title || record.title || record.name || 'Untitled Playlist',
                cover: metadata.cover || record.cover || record.image || '',
                description: metadata.description ?? record.description ?? '',
                lastCollaborator: uid,
                updatedAt: Date.now(),
            }),
        };

        await databases.updateDocument(DATABASE_ID, PUBLIC_COLLECTION, record.$id, payload);
    },

    async unpublishPlaylist(uuid) {
        const uid = authManager.user?.$id;
        if (!uid) return;

        try {
            const existing = await databases.listDocuments(DATABASE_ID, PUBLIC_COLLECTION, [
                Query.equal('uuid', uuid),
                Query.limit(1),
            ]);

            if (existing.documents && existing.documents.length > 0) {
                await databases.deleteDocument(DATABASE_ID, PUBLIC_COLLECTION, existing.documents[0].$id);
            }
        } catch (error) {
            console.error('Failed to unpublish playlist:', error);
        }
    },

    async getProfile(username) {
        try {
            const docs = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
                Query.equal('username', username),
                Query.limit(1),
            ]);
            const record = docs.documents[0];
            if (!record) return null;
            return {
                ...record,
                privacy: this.safeParseInternal(record.privacy, 'privacy', { playlists: 'public', lastfm: 'public' }),
                user_playlists: this.safeParseInternal(record.user_playlists, 'user_playlists', {}),
                favorite_albums: this.safeParseInternal(record.favorite_albums, 'favorite_albums', []),
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

        const updated = await databases.updateDocument(
            DATABASE_ID,
            USERS_COLLECTION,
            record.$id,
            normalizeProfileUpdate(data)
        );
        this._userRecordCache = updated;
    },

    async isUsernameTaken(username) {
        try {
            const list = await databases.listDocuments(DATABASE_ID, USERS_COLLECTION, [
                Query.equal('username', username),
                Query.limit(1),
            ]);
            return list.total > 0;
        } catch {
            return false;
        }
    },

    async clearCloudData() {
        const user = authManager.user;
        if (!user) return;

        try {
            const record = await this._getUserRecord(user.$id);
            if (record) {
                await databases.deleteDocument(DATABASE_ID, USERS_COLLECTION, record.$id);
                this._userRecordCache = null;
                alert('Cloud data cleared successfully.');
            }
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
                    if (typeof database === 'function') {
                        database = await database();
                    } else {
                        database = await database;
                    }

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

                    await database.importData(convertedData);
                    await new Promise((resolve) => setTimeout(resolve, 300));

                    window.dispatchEvent(new CustomEvent('library-changed'));
                    window.dispatchEvent(new CustomEvent('history-changed'));
                    window.dispatchEvent(new HashChangeEvent('hashchange'));

                    console.log('[Appwrite] ✓ Sync completed');
                }
            } catch (error) {
                console.error('[Appwrite] Sync error:', error);
            } finally {
                this._isSyncing = false;
            }
        } else {
            this._userRecordCache = null;
            this._isSyncing = false;
        }
    },
};

authManager.onAuthStateChanged(syncManager.onAuthStateChanged.bind(syncManager));

export { syncManager };
