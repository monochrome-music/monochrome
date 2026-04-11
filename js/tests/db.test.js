import { expect, test, describe, beforeEach, afterEach, vi } from 'vitest';
import { MusicDatabase } from '../db.js';

describe('MusicDatabase', () => {
    let db;
    const TEST_DB_NAME = 'TestMonochromeDB';

    beforeEach(async () => {
        db = new MusicDatabase();
        db.dbName = TEST_DB_NAME;
        const req = indexedDB.deleteDatabase(TEST_DB_NAME);
        await new Promise((resolve) => {
            req.onsuccess = resolve;
            req.onerror = resolve;
        });
    });

    afterEach(async () => {
        if (db.db) {
            db.db.close();
        }
        const req = indexedDB.deleteDatabase(TEST_DB_NAME);
        await new Promise((resolve) => {
            req.onsuccess = resolve;
            req.onerror = resolve;
        });
    });

    test('opens database and creates stores', async () => {
        const openedDb = await db.open();
        expect(openedDb.name).toBe(TEST_DB_NAME);
        expect(openedDb.objectStoreNames.contains('favorites_tracks')).toBe(true);
        expect(openedDb.objectStoreNames.contains('history_tracks')).toBe(true);
        expect(openedDb.objectStoreNames.contains('user_playlists')).toBe(true);
    });

    test('toggleFavorite adds and removes items', async () => {
        const track = { id: 'track1', title: 'Test Track', artist: { name: 'Artist' } };

        const added = await db.toggleFavorite('track', track);
        expect(added).toBe(true);
        const favorites = await db.getFavorites('track');
        expect(favorites.length).toBe(1);
        expect(favorites[0].id).toBe('track1');

        const removed = await db.toggleFavorite('track', track);
        expect(removed).toBe(false);
        const favoritesAfter = await db.getFavorites('track');
        expect(favoritesAfter.length).toBe(0);
    });

    test('addToHistory manages recent tracks and avoids duplicates', async () => {
        const track1 = { id: 't1', title: 'Track 1' };
        const track2 = { id: 't2', title: 'Track 2' };

        await db.addToHistory(track1);
        await db.addToHistory(track2);
        await db.addToHistory(track1);

        const history = await db.getHistory();
        expect(history.length).toBe(2);
        expect(history[0].id).toBe('t1');
        expect(history[1].id).toBe('t2');
    });

    test('playlist operations: create, add, remove, delete', async () => {
        const track = { id: 'track1', title: 'Test Track' };

        const playlist = await db.createPlaylist('My Playlist', [track]);
        expect(playlist.name).toBe('My Playlist');
        expect(playlist.tracks.length).toBe(1);

        const track2 = { id: 'track2', title: 'Track 2' };
        await db.addTrackToPlaylist(playlist.id, track2);

        const updated = await db.getPlaylist(playlist.id);
        expect(updated.tracks.length).toBe(2);
        expect(updated.tracks[1].id).toBe('track2');

        await db.removeTrackFromPlaylist(playlist.id, 'track1');
        const afterRemove = await db.getPlaylist(playlist.id);
        expect(afterRemove.tracks.length).toBe(1);
        expect(afterRemove.tracks[0].id).toBe('track2');

        await db.deletePlaylist(playlist.id);
        const deleted = await db.getPlaylist(playlist.id);
        expect(deleted).toBeUndefined();
    });

    test('pinned items management', async () => {
        const album = { id: 'album1', title: 'Album 1', type: 'album' };

        await db.togglePinned(album, 'album');
        let pinned = await db.getPinned();
        expect(pinned.length).toBe(1);
        expect(pinned[0].id).toBe('album1');

        await db.togglePinned({ id: 'a2', title: 'A2' }, 'album');
        await db.togglePinned({ id: 'a3', title: 'A3' }, 'album');
        await db.togglePinned({ id: 'a4', title: 'A4' }, 'album');

        pinned = await db.getPinned();
        expect(pinned.length).toBe(3);
        expect(pinned.some((p) => p.id === 'a4')).toBe(true);
        expect(pinned.some((p) => p.id === 'album1')).toBe(false);
    });
});
