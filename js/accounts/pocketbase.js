import PocketBase from 'pocketbase';
import { db } from '../db.js';
import { authManager } from './auth.js';

const PUBLIC_COLLECTION = 'public_playlists';
const POCKETBASE_URL = 'https://monodb.samidy.com';
const pb = new PocketBase(POCKETBASE_URL);
pb.autoCancellation(false);

const syncManager = {
    pb: pb,
    _userRecordCache: null,
    _isSyncing: false,

    async _getUserRecord(uid) {
        if (!uid) {
            console.warn('_getUserRecord called with no UID.');
            return null;
        }
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
                        },
                        { f_id: uid }
                    );
                    this._userRecordCache = newRecord;
                    return newRecord;
                } catch (createError) {
                    console.error('Failed to create user record in PocketBase:', createError);
                    return null;
                }
            }
            console.error('Failed to get user record from PocketBase:', error);
            return null;
        }
    },

    async getUserData() {
        const user = authManager.user;
        if (!user) return null;

        const record = await this._getUserRecord(user.uid);
        if (!record) return null;

        let library = record.library || {};
        if (typeof library === 'string') {
            try {
                library = JSON.parse(library);
            } catch (e) {
                console.error('Failed to parse library JSON:', e);
                library = {};
            }
        }

        let history = record.history || [];
        if (typeof history === 'string') {
            try {
                history = JSON.parse(history);
            } catch (e) {
                console.error('Failed to parse history JSON:', e);
                history = [];
            }
        }

        let userPlaylists = record.user_playlists || {};
        if (typeof userPlaylists === 'string') {
            try {
                userPlaylists = JSON.parse(userPlaylists);
            } catch (e) {
                console.error('Failed to parse user_playlists JSON:', e);
                userPlaylists = {};
            }
        }

        return { library, history, userPlaylists };
    },

    async _updateUserJSON(uid, field, data) {
        const record = await this._getUserRecord(uid);
        if (!record) {
            console.error('Cannot update: no user record found');
            return;
        }

        try {
            const updated = await this.pb.collection('DB_users').update(record.id, { [field]: data }, { f_id: uid });
            this._userRecordCache = updated;
        } catch (error) {
            console.error(`Failed to sync ${field} to PocketBase:`, error);
        }
    },

    async syncLibraryItem(type, item, added) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.uid);
        if (!record) return;

        let library = record.library || {};

        if (typeof library === 'string') {
            try {
                library = JSON.parse(library);
            } catch (e) {
                console.error('Library field is not valid JSON', e);
                library = {};
            }
        }

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

        let history = record.history || [];
        if (typeof history === 'string') {
            try {
                history = JSON.parse(history);
            } catch (e) {
                console.error('History field is not valid JSON', e);
                history = [];
            }
        }

        const newHistory = [historyEntry, ...history].slice(0, 100);
        await this._updateUserJSON(user.uid, 'history', newHistory);
    },

    async syncUserPlaylist(playlist, action) {
        const user = authManager.user;
        if (!user) return;

        const record = await this._getUserRecord(user.uid);
        if (!record) return;

        let userPlaylists = record.user_playlists || {};

        if (typeof userPlaylists === 'string') {
            try {
                userPlaylists = JSON.parse(userPlaylists);
            } catch (e) {
                console.error('user_playlists field is not valid JSON', e);
                userPlaylists = {};
            }
        }

        if (action === 'delete') {
            delete userPlaylists[playlist.id];
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
        }

        await this._updateUserJSON(user.uid, 'user_playlists', userPlaylists);
    },

    async getPublicPlaylist(uuid) {
        try {
            const record = await this.pb
                .collection(PUBLIC_COLLECTION)
                .getFirstListItem(`uuid="${uuid}"`, { p_id: uuid });

            let rawCover = record.image || record.cover || record.playlist_cover || '';
            let extraData = record.data;

            if (typeof extraData === 'string') {
                try {
                    extraData = JSON.parse(extraData);
                } catch {
                    // Ignore
                }
            }

            if (!rawCover && extraData && typeof extraData === 'object') {
                rawCover = extraData.cover || extraData.image || '';
            }

            let finalCover = rawCover;
            if (rawCover && !rawCover.startsWith('http') && !rawCover.startsWith('data:')) {
                finalCover = this.pb.files.getUrl(record, rawCover);
            }

            let images = [];
            let tracks = record.tracks || [];

            if (typeof tracks === 'string') {
                try {
                    tracks = JSON.parse(tracks);
                } catch (e) {
                    console.error('Failed to parse tracks JSON:', e);
                    tracks = [];
                }
            }

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

            return {
                ...record,
                id: record.uuid,
                name: finalTitle,
                title: finalTitle,
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
            title: playlist.name,
            name: playlist.name,
            playlist_name: playlist.name,
            image: playlist.cover,
            cover: playlist.cover,
            playlist_cover: playlist.cover,
            tracks: playlist.tracks,
            isPublic: true,
            data: {
                title: playlist.name,
                cover: playlist.cover,
            },
        };

        try {
            const existing = await this.pb.collection(PUBLIC_COLLECTION).getList(1, 1, {
                filter: `uuid="${playlist.id}"`,
                p_id: playlist.id,
            });

            if (existing.items.length > 0) {
                await this.pb.collection(PUBLIC_COLLECTION).update(existing.items[0].id, data);
            } else {
                await this.pb.collection(PUBLIC_COLLECTION).create(data);
            }
        } catch (error) {
            console.error('Failed to publish playlist:', error);
        }
    },

    async unpublishPlaylist(uuid) {
        const uid = authManager.user?.uid;
        if (!uid) return;

        try {
            const existing = await this.pb.collection('public_playlists').getList(1, 1, {
                filter: `uuid="${uuid}"`,
                p_id: uuid,
            });

            if (existing.items && existing.items.length > 0) {
                await this.pb.collection('public_playlists').delete(existing.items[0].id, { p_id: uuid });
            }
        } catch (error) {
            console.error('Failed to unpublish playlist:', error);
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

    async onAuthStateChanged(user) {
        if (user) {
            if (this._isSyncing) return;

            this._isSyncing = true;

            try {
                const data = await this.getUserData();

                if (data) {
                    const convertedData = {
                        favorites_tracks: data.library.tracks
                            ? Object.values(data.library.tracks).filter((t) => t && typeof t === 'object')
                            : [],
                        favorites_albums: data.library.albums
                            ? Object.values(data.library.albums).filter((a) => a && typeof a === 'object')
                            : [],
                        favorites_artists: data.library.artists
                            ? Object.values(data.library.artists).filter((a) => a && typeof a === 'object')
                            : [],
                        favorites_playlists: data.library.playlists
                            ? Object.values(data.library.playlists).filter((p) => p && typeof p === 'object')
                            : [],
                        favorites_mixes: data.library.mixes
                            ? Object.values(data.library.mixes).filter((m) => m && typeof m === 'object')
                            : [],
                        history_tracks: data.history || [],
                        user_playlists: data.userPlaylists
                            ? Object.values(data.userPlaylists).filter((p) => p && typeof p === 'object')
                            : [],
                    };

                    await db.importData(convertedData);
                    await new Promise((resolve) => setTimeout(resolve, 300));

                    window.dispatchEvent(new CustomEvent('library-changed'));
                    window.dispatchEvent(new CustomEvent('history-changed'));
                    window.dispatchEvent(new HashChangeEvent('hashchange'));
                }
            } catch (error) {
                console.error('Error during PocketBase sync!', error);
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
