//js/accounts/pocketbase.js
import PocketBase from 'pocketbase';
import { db } from '../db.js';
import { authManager } from './auth.js';

const PUBLIC_COLLECTION = 'public_playlists';
const DEFAULT_POCKETBASE_URL = 'https://monodb.samidy.com';
const POCKETBASE_URL = localStorage.getItem('monochrome-pocketbase-url') || DEFAULT_POCKETBASE_URL;

console.log('[PocketBase] Using URL:', POCKETBASE_URL);

const pb = new PocketBase(POCKETBASE_URL);
pb.autoCancellation(false);

const syncManager = {
    pb: pb,
    _userRecordCache: null,
    _isSyncing: false,

    async _getUserRecord(uid) {
        if (!uid) return null;

        if (this._userRecordCache && this._userRecordCache.firebase_id === uid) {
            return this._userRecordCache;
        }

        try {
            const record = await this.pb.collection('DB_users').getFirstListItem(`firebase_id="${uid}"`, { f_id: uid });
            this._userRecordCache = record;
            return record;
        } catch (error) {
            if (error.status === 404) {
                try {
                    const newRecord = await this.pb.collection('DB_users').create(
                        {
                            firebase_id: uid,
                            library: {},
                            history: [],
                            user_playlists: {},
                            user_folders: {},
                        },
                        { f_id: uid }
                    );
                    this._userRecordCache = newRecord;
                    return newRecord;
                } catch (createError) {
                    console.error('[PocketBase] Failed to create user:', createError);
                    return null;
                }
            }
            console.error('[PocketBase] Failed to get user:', error);
            return null;
        }
    },

    async getUserData() {
        const user = authManager.user;
        if (!user) return null;

        const record = await this._getUserRecord(user.uid);
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
            const stringifiedData = typeof data === 'string' ? data : JSON.stringify(data);
            const updated = await this.pb
                .collection('DB_users')
                .update(record.id, { [field]: stringifiedData }, { f_id: uid });
            this._userRecordCache = updated;
        } catch (error) {
            console.error(`Failed to sync ${field} to PocketBase:`, error);
        }
    },

    safeParseInternal(str, fieldName, fallback) {
        if (!str) return fallback;
        if (typeof str !== 'string') return str;
        try {
            return JSON.parse(str);
        } catch {
            try {
                // Recovery attempt: replace illegal internal quotes in name/title fields
                const recovered = str.replace(/(:\s*")(.+?)("(?=\s*[,}\n\r]))/g, (match, p1, p2, p3) => {
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

    _realtimeSubscribed: false,

    async setupRealtimeSubscriptions() {
        const user = authManager.user;
        if (!user || this._realtimeSubscribed) return;

        try {
            await this.pb.collection('DB_users').subscribe('*', (e) => {
                if (!authManager.user) return;

                // If it's our own record
                if (e.record.firebase_id === authManager.user.uid) {
                    this._userRecordCache = e.record;
                    window.dispatchEvent(new CustomEvent('pb-user-updated', { detail: e.record }));
                } else {
                    // It might be a friend's record (e.g., status update)
                    window.dispatchEvent(new CustomEvent('pb-friend-updated', { detail: e.record }));
                }
            });
            this._realtimeSubscribed = true;
            console.log('[PocketBase] Real-time subscriptions active');
        } catch (err) {
            console.error('[PocketBase] Failed to initialize real-time subscriptions:', err);
        }
    },

    async syncLibraryItem(type, item, added) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.uid);
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

        await this._updateUserJSON(user.uid, 'library', library);
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

        const record = await this._getUserRecord(user.uid);
        if (!record) return;

        let history = this.safeParseInternal(record.history, 'history', []);

        const newHistory = [historyEntry, ...history].slice(0, 100);
        await this._updateUserJSON(user.uid, 'history', newHistory);
    },

    async syncUserPlaylist(playlist, action) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.uid);
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
                tracks: playlist.tracks ? playlist.tracks.map((t) => this._minifyItem('track', t)) : [],
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

        await this._updateUserJSON(user.uid, 'user_playlists', userPlaylists);
    },

    async syncUserFolder(folder, action) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.uid);
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

        await this._updateUserJSON(user.uid, 'user_folders', userFolders);
    },

    async getPublicPlaylist(uuid) {
        try {
            const record = await this.pb
                .collection(PUBLIC_COLLECTION)
                .getFirstListItem(`uuid="${uuid}"`, { p_id: uuid });

            let rawCover = record.image || record.cover || record.playlist_cover || '';
            let extraData = this.safeParseInternal(record.data, 'data', {});

            if (!rawCover && extraData && typeof extraData === 'object') {
                rawCover = extraData.cover || extraData.image || '';
            }

            let finalCover = rawCover;
            if (rawCover && !rawCover.startsWith('http') && !rawCover.startsWith('data:')) {
                finalCover = this.pb.files.getUrl(record, rawCover);
            }

            let images = [];
            let tracks = this.safeParseInternal(record.tracks, 'tracks', []);

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

            let finalTitle = record.title || record.name || record.playlist_name;
            if (!finalTitle && extraData && typeof extraData === 'object') {
                finalTitle = extraData.title || extraData.name;
            }
            if (!finalTitle) finalTitle = 'Untitled Playlist';

            let finalDescription = record.description || '';
            if (!finalDescription && extraData && typeof extraData === 'object') {
                finalDescription = extraData.description || '';
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
        const uid = authManager.user?.uid;
        if (!uid) return;

        const data = {
            uuid: playlist.id,
            uid: uid,
            firebase_id: uid,
            title: playlist.name,
            name: playlist.name,
            playlist_name: playlist.name,
            image: playlist.cover,
            cover: playlist.cover,
            playlist_cover: playlist.cover,
            description: playlist.description || '',
            tracks: JSON.stringify(playlist.tracks || []),
            isPublic: true,
            data: {
                title: playlist.name,
                cover: playlist.cover,
                description: playlist.description || '',
            },
        };

        try {
            const existing = await this.pb.collection(PUBLIC_COLLECTION).getList(1, 1, {
                filter: `uuid="${playlist.id}"`,
                p_id: playlist.id,
            });

            if (existing.items.length > 0) {
                await this.pb.collection(PUBLIC_COLLECTION).update(existing.items[0].id, data, { f_id: uid });
            } else {
                await this.pb.collection(PUBLIC_COLLECTION).create(data, { f_id: uid });
            }
        } catch (error) {
            console.error('Failed to publish playlist:', error);
        }
    },

    async unpublishPlaylist(uuid) {
        const uid = authManager.user?.uid;
        if (!uid) return;

        try {
            const existing = await this.pb.collection(PUBLIC_COLLECTION).getList(1, 1, {
                filter: `uuid="${uuid}"`,
                p_id: uuid,
            });

            if (existing.items && existing.items.length > 0) {
                await this.pb.collection(PUBLIC_COLLECTION).delete(existing.items[0].id, { p_id: uuid, f_id: uid });
            }
        } catch (error) {
            console.error('Failed to unpublish playlist:', error);
        }
    },

    async getProfile(username) {
        try {
            const record = await this.pb.collection('DB_users').getFirstListItem(`username="${username}"`, {
                fields: 'username,display_name,avatar_url,banner,status,about,website,lastfm_username,privacy,user_playlists,favorite_albums',
            });
            return {
                ...record,
                privacy: this.safeParseInternal(record.privacy, 'privacy', { playlists: 'public', lastfm: 'public' }),
                user_playlists: this.safeParseInternal(record.user_playlists, 'user_playlists', {}),
                favorite_albums: this.safeParseInternal(record.favorite_albums, 'favorite_albums', []),
            };
        } catch (error) {
            return null;
        }
    },

    async updateProfile(data) {
        const user = authManager.user;
        if (!user) return;
        const record = await this._getUserRecord(user.uid);
        if (!record) return;

        const updateData = { ...data };
        if (updateData.privacy) {
            updateData.privacy = JSON.stringify(updateData.privacy);
        }

        await this.pb.collection('DB_users').update(record.id, updateData, { f_id: user.uid });
        if (this._userRecordCache) {
            this._userRecordCache = { ...this._userRecordCache, ...updateData };
        }
    },

    async isUsernameTaken(username) {
        try {
            const list = await this.pb.collection('DB_users').getList(1, 1, { filter: `username="${username}"` });
            return list.totalItems > 0;
        } catch (e) {
            return false;
        }
    },

    async clearCloudData() {
        const user = authManager.user;
        if (!user) return;

        try {
            const record = await this._getUserRecord(user.uid);
            if (record) {
                await this.pb.collection('DB_users').delete(record.id, { f_id: user.uid });
                this._userRecordCache = null;
                alert('Cloud data cleared successfully.');
            }
        } catch (error) {
            console.error('Failed to clear cloud data!', error);
            alert('Failed to clear cloud data! :( Check console for details.');
        }
    },

    // ========== FRIENDS SYNC ==========

    // Sync friends list to cloud
    async syncFriends(friends) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.uid);
        if (!record) return;

        const friendsData = friends.map((f) => ({
            uid: f.uid,
            username: f.username || '',
            displayName: f.displayName || f.username || '',
            avatarUrl: f.avatarUrl || '',
            addedAt: f.addedAt || Date.now(),
        }));

        try {
            await this.pb
                .collection('DB_users')
                .update(record.id, { friends: JSON.stringify(friendsData) }, { f_id: user.uid });
        } catch (error) {
            console.error('[PocketBase] Failed to sync friends:', error);
        }
    },

    // Get friends from cloud
    async getCloudFriends() {
        const user = authManager.user;
        if (!user) return [];

        const record = await this._getUserRecord(user.uid);
        if (!record) return [];

        const friendsStr = record.friends || '[]';
        return this.safeParseInternal(friendsStr, 'friends', []);
    },

    // Sync friend requests
    async syncFriendRequests(requests) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.uid);
        if (!record) return;

        const requestsData = requests.map((r) => ({
            uid: r.uid,
            username: r.username || '',
            displayName: r.displayName || r.username || '',
            avatarUrl: r.avatarUrl || '',
            requestedAt: r.requestedAt || Date.now(),
            status: r.status || 'pending',
            outgoing: r.outgoing || false,
        }));

        try {
            await this.pb
                .collection('DB_users')
                .update(record.id, { friend_requests: JSON.stringify(requestsData) }, { f_id: user.uid });
        } catch (error) {
            console.error('[PocketBase] Failed to sync friend requests:', error);
        }
    },

    // Get friend requests from cloud
    async getCloudFriendRequests() {
        const user = authManager.user;
        if (!user) return [];

        const record = await this._getUserRecord(user.uid);
        if (!record) return [];

        const requestsStr = record.friend_requests || '[]';
        return this.safeParseInternal(requestsStr, 'friend_requests', []);
    },

    // Send friend request to another user
    async sendFriendRequestToUser(targetUsername) {
        const user = authManager.user;
        if (!user) return null;

        try {
            // Find target user
            const targetUser = await this.pb.collection('DB_users').getFirstListItem(`username="${targetUsername}"`);
            if (!targetUser) return null;

            // Create outgoing request record
            const outgoingRequests = await this.getCloudFriendRequests();
            const newRequest = {
                uid: targetUser.firebase_id,
                username: targetUser.username,
                displayName: targetUser.display_name || targetUser.username,
                avatarUrl: targetUser.avatar_url || '',
                requestedAt: Date.now(),
                status: 'pending',
                outgoing: true,
            };

            // Add to outgoing requests
            const existingOutgoing = outgoingRequests.filter((r) => r.outgoing);
            existingOutgoing.push(newRequest);
            await this.syncFriendRequests([...outgoingRequests.filter((r) => !r.outgoing), ...existingOutgoing]);

            return newRequest;
        } catch (error) {
            console.error('[PocketBase] Failed to send friend request:', error);
            return null;
        }
    },

    // ========== COLLABORATIVE PLAYLISTS SYNC ==========

    // Sync collaborative playlists to cloud
    async syncCollaborativePlaylists(playlists) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.uid);
        if (!record) return;

        const playlistsData = playlists.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description || '',
            cover: p.cover || '',
            tracks: p.tracks ? p.tracks.map((t) => this._minifyItem('track', t)) : [],
            members: p.members || [],
            owner: p.owner || '',
            createdAt: p.createdAt || Date.now(),
            updatedAt: p.updatedAt || Date.now(),
            isCollaborative: true,
        }));

        try {
            await this.pb
                .collection('DB_users')
                .update(record.id, { collaborative_playlists: JSON.stringify(playlistsData) }, { f_id: user.uid });
        } catch (error) {
            console.error('[PocketBase] Failed to sync collaborative playlists:', error);
        }
    },

    // Get collaborative playlists from cloud
    async getCloudCollaborativePlaylists() {
        const user = authManager.user;
        if (!user) return [];

        const record = await this._getUserRecord(user.uid);
        if (!record) return [];

        const playlistsStr = record.collaborative_playlists || '[]';
        return this.safeParseInternal(playlistsStr, 'collaborative_playlists', []);
    },

    // ========== SHARED TRACKS SYNC ==========

    // Share a track with a friend
    async shareTrackWithFriend(track, friendUid, message = '') {
        const user = authManager.user;
        if (!user) return null;

        const record = await this._getUserRecord(user.uid);
        if (!record) return null;

        // Get existing shared tracks
        const sharedTracks = this.safeParseInternal(record.shared_tracks || '[]', 'shared_tracks', []);

        const newShare = {
            id: crypto.randomUUID(),
            track: this._minifyItem('track', track),
            sharedWith: friendUid,
            sharedBy: user.uid,
            sharedByName: record.display_name || record.username || 'Anonymous',
            message: message,
            sharedAt: Date.now(),
            played: false,
        };

        sharedTracks.push(newShare);

        try {
            await this.pb
                .collection('DB_users')
                .update(record.id, { shared_tracks: JSON.stringify(sharedTracks) }, { f_id: user.uid });
            return newShare;
        } catch (error) {
            console.error('[PocketBase] Failed to share track:', error);
            return null;
        }
    },

    // Get shared tracks from cloud
    async getCloudSharedTracks() {
        const user = authManager.user;
        if (!user) return [];

        const record = await this._getUserRecord(user.uid);
        if (!record) return [];

        const sharedTracksStr = record.shared_tracks || '[]';
        return this.safeParseInternal(sharedTracksStr, 'shared_tracks', []);
    },

    // Get user profile by UID (for friends)
    async getUserProfileByUid(uid) {
        try {
            const record = await this.pb.collection('DB_users').getFirstListItem(`firebase_id="${uid}"`, {
                fields: 'firebase_id,username,display_name,avatar_url,banner,status,about,website',
            });
            return {
                uid: record.firebase_id,
                username: record.username,
                displayName: record.display_name,
                avatarUrl: record.avatar_url,
                banner: record.banner,
                status: record.status,
                about: record.about,
                website: record.website,
            };
        } catch (error) {
            return null;
        }
    },

    async onAuthStateChanged(user) {
        if (user) {
            this.setupRealtimeSubscriptions();

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

                    const getAll = async (store) => {
                        if (database && typeof database.getAll === 'function') return database.getAll(store);
                        if (database && database.db && typeof database.db.getAll === 'function')
                            return database.db.getAll(store);
                        return [];
                    };

                    const localData = {
                        tracks: (await getAll('favorites_tracks')) || [],
                        albums: (await getAll('favorites_albums')) || [],
                        artists: (await getAll('favorites_artists')) || [],
                        playlists: (await getAll('favorites_playlists')) || [],
                        mixes: (await getAll('favorites_mixes')) || [],
                        history: (await getAll('history_tracks')) || [],
                        userPlaylists: (await getAll('user_playlists')) || [],
                        userFolders: (await getAll('user_folders')) || [],
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
                                tracks: playlist.tracks ? playlist.tracks.map((t) => this._minifyItem('track', t)) : [],
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

                    if (history.length === 0 && localData.history.length > 0) {
                        history = localData.history;
                        needsUpdate = true;
                    }

                    if (needsUpdate) {
                        await this._updateUserJSON(user.uid, 'library', library);
                        await this._updateUserJSON(user.uid, 'user_playlists', userPlaylists);
                        await this._updateUserJSON(user.uid, 'user_folders', userFolders);
                        await this._updateUserJSON(user.uid, 'history', history);
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

            if (this._realtimeSubscribed) {
                try {
                    this.pb.collection('DB_users').unsubscribe('*');
                    this._realtimeSubscribed = false;
                    console.log('[PocketBase] Real-time subscriptions disabled');
                } catch (err) {
                    console.error('[PocketBase] Failed to unsubscribe:', err);
                }
            }
        }
    },
};

if (pb) {
    authManager.onAuthStateChanged(syncManager.onAuthStateChanged.bind(syncManager));
}

export { pb, syncManager };
