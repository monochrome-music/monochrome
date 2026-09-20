import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    TRACKS_API_BASE_URL,
    cleanString,
    normalizeTracksTrack,
    normalizeTracksRelease,
    normalizeTracksArtist,
    normalizeTracksPlaylist,
    normalizeTracksSearchResults,
    extractTracksSuggestions,
    scoreTrackCandidate,
    TracksStreamerAPI,
} from '../tracks-api.js';

describe('tracks-api module', () => {
    describe('cleanString', () => {
        it('normalizes accents, punctuation, and featuring tags', () => {
            expect(cleanString('Get Lucky (feat. Pharrell Williams)')).toBe('getlucky');
            expect(cleanString('HUMBLE. [Explicit]')).toBe('humble');
            expect(cleanString('Beyoncé')).toBe('beyonce');
            expect(cleanString('Daft Punk - One More Time (12" Mix)')).toBe('daftpunkonemoretime');
        });
    });

    describe('normalizeTracksTrack', () => {
        it('normalizes raw track from tracks.monochrome.st correctly', () => {
            const raw = {
                id: '155142501534011392',
                trackId: '155142501534011392',
                title: 'Get Lucky (feat. Pharrell Williams and Nile Rodgers)',
                artistIds: ['153542153123926016', '152963535956086784'],
                artistNames: ['Daft Punk', 'Pharrell Williams'],
                releaseId: '155142458219433984',
                artwork: 'https://tracks.monochrome.st/proxy/mi/155142458219433984-1A01.jpg',
                explicit: false,
                playable: true,
                duration: 369626,
                isrc: 'USQX91300108',
                recordingId: '156637005457920000',
            };

            const track = normalizeTracksTrack(raw);
            expect(track).toBeDefined();
            expect(track.id).toBe('155142501534011392');
            expect(track.trackId).toBe('155142501534011392');
            expect(track.tracksTrackId).toBe('155142501534011392');
            expect(track.title).toBe('Get Lucky (feat. Pharrell Williams and Nile Rodgers)');
            expect(track.duration).toBe(370); // 369626 ms -> 370 s
            expect(track.explicit).toBe(false);
            expect(track.isUnavailable).toBe(false);
            expect(track.isrc).toBe('USQX91300108');
            expect(track.recordingId).toBe('156637005457920000');
            expect(track.artist.name).toBe('Daft Punk');
            expect(track.artist.id).toBe('153542153123926016');
            expect(track.artists.length).toBe(2);
            expect(track.album.id).toBe('155142458219433984');
            expect(track.url).toBe('https://tracks.monochrome.st/track/155142501534011392');
            expect(track._href).toBe('/track/155142501534011392');
            expect(track.audioQuality).toBe('LOSSLESS');
        });
    });

    describe('normalizeTracksRelease', () => {
        it('normalizes raw release into album format', () => {
            const raw = {
                id: '155142458219433984',
                releaseId: '155142458219433984',
                title: 'Random Access Memories',
                artistIds: ['153542153123926016'],
                artistNames: ['Daft Punk'],
                releaseDate: '2013-05-20T00:00:00.000Z',
                releaseType: 'ALBUM',
                label: 'Columbia',
                artwork: 'https://tracks.monochrome.st/proxy/mi/155142458219433984-1A01.jpg',
                explicit: false,
                trackCount: 13,
            };

            const album = normalizeTracksRelease(raw);
            expect(album).toBeDefined();
            expect(album.id).toBe('155142458219433984');
            expect(album.releaseId).toBe('155142458219433984');
            expect(album.tracksReleaseId).toBe('155142458219433984');
            expect(album.title).toBe('Random Access Memories');
            expect(album.artist.name).toBe('Daft Punk');
            expect(album.cover).toBe('https://tracks.monochrome.st/proxy/mi/155142458219433984-1A01.jpg');
            expect(album.numberOfTracks).toBe(13);
            expect(album.type).toBe('ALBUM');
            expect(album._href).toBe('/album/155142458219433984');
        });
    });

    describe('normalizeTracksArtist', () => {
        it('normalizes raw artist', () => {
            const raw = {
                id: '153542153123926016',
                artistId: '153542153123926016',
                name: 'Daft Punk',
                displayName: 'Daft Punk',
                avatar: 'https://tracks.monochrome.st/proxy/c/media/153542153123926016-5A04.jpg',
                bio: 'Electronic music duo',
            };

            const artist = normalizeTracksArtist(raw);
            expect(artist).toBeDefined();
            expect(artist.id).toBe('153542153123926016');
            expect(artist.artistId).toBe('153542153123926016');
            expect(artist.name).toBe('Daft Punk');
            expect(artist.picture).toBe('https://tracks.monochrome.st/proxy/c/media/153542153123926016-5A04.jpg');
            expect(artist.biography).toBe('Electronic music duo');
            expect(artist._href).toBe('/artist/153542153123926016');
        });
    });

    describe('normalizeTracksSearchResults', () => {
        it('structures unified search results into standard tracks, albums, artists, playlists', () => {
            const raw = {
                tracks: [
                    {
                        trackId: '101',
                        title: 'Song A',
                        artistNames: ['Artist A'],
                        releaseId: '201',
                        duration: 180000,
                    },
                ],
                releases: [
                    {
                        releaseId: '201',
                        title: 'Album A',
                        artistNames: ['Artist A'],
                        trackCount: 1,
                    },
                ],
                artists: [
                    {
                        artistId: '301',
                        name: 'Artist A',
                    },
                ],
                playlists: [
                    {
                        playlistId: '401',
                        title: 'Playlist A',
                        trackCount: 5,
                    },
                ],
            };

            const normalized = normalizeTracksSearchResults(raw);
            expect(normalized.tracks.items.length).toBe(1);
            expect(normalized.albums.items.length).toBe(1);
            expect(normalized.artists.items.length).toBe(1);
            expect(normalized.playlists.items.length).toBe(1);
            expect(normalized.videos.items.length).toBe(0);
        });
    });

    describe('scoreTrackCandidate', () => {
        it('gives highest score for exact ISRC match', () => {
            const target = { isrc: 'USQX91300108', title: 'Song X', artist: { name: 'Artist Y' } };
            const candidate = { isrc: 'USQX91300108', title: 'Different Title', artistNames: ['Other'] };
            expect(scoreTrackCandidate(candidate, target)).toBe(200);
        });

        it('scores high on matching title and artist', () => {
            const target = { title: 'Get Lucky', artist: { name: 'Daft Punk' }, duration: 247 };
            const candidate = {
                title: 'Get Lucky (feat. Pharrell Williams)',
                artistNames: ['Daft Punk'],
                duration: 248000,
            };
            const score = scoreTrackCandidate(candidate, target);
            expect(score).toBeGreaterThanOrEqual(150);
        });

        it('gives low score on completely mismatched tracks', () => {
            const target = { title: 'Bohemian Rhapsody', artist: { name: 'Queen' }, duration: 354 };
            const candidate = { title: 'Karma Police', artistNames: ['Radiohead'], duration: 264000 };
            expect(scoreTrackCandidate(candidate, target)).toBe(0);
        });
    });

    describe('extractTracksSuggestions', () => {
        it('builds suggestions including query term and tracks', () => {
            const tracks = [
                {
                    trackId: '155142501534011392',
                    title: 'Get Lucky',
                    artistNames: ['Daft Punk'],
                    artwork: 'https://tracks.monochrome.st/proxy/mi/cover.jpg',
                },
            ];

            const suggestions = extractTracksSuggestions(tracks, 'daft punk');
            expect(suggestions.length).toBe(2);
            expect(suggestions[0].kind).toBe('term');
            expect(suggestions[0].searchTerm).toBe('daft punk');
            expect(suggestions[1].kind).toBe('song');
            expect(suggestions[1].displayTerm).toBe('Get Lucky');
            expect(suggestions[1].subtitle).toBe('Daft Punk');
        });
    });

    describe('TracksStreamerAPI client', () => {
        let api;
        beforeEach(() => {
            api = new TracksStreamerAPI(TRACKS_API_BASE_URL);
        });

        it('generates direct stream URL for any track ID', () => {
            const streamInfo = api.getStreamUrl('155142501534011392');
            expect(streamInfo.url).toBe('https://tracks.monochrome.st/track/155142501534011392');
            expect(streamInfo.provider).toBe('monochrome');
            expect(streamInfo.quality).toBe('LOSSLESS');
            expect(streamInfo.qualityDisplay).toBe('FLAC');
            expect(streamInfo.playbackType).toBe('direct');
            expect(streamInfo.mediaMimeType).toBe('audio/flac');
        });

        it('resolves track stream directly when given a tracks track object', async () => {
            const track = {
                id: 'tracks:track:155142501534011392',
                tracksTrackId: '155142501534011392',
                title: 'Get Lucky',
            };

            const stream = await api.resolveTrackStream(track);
            expect(stream).toBeDefined();
            expect(stream.url).toBe('https://tracks.monochrome.st/track/155142501534011392');
        });

        it('resolves external track via search lookup when matching candidate found', async () => {
            vi.spyOn(api, 'searchTracks').mockResolvedValueOnce({
                items: [
                    {
                        trackId: '157107766404747264',
                        tracksTrackId: '157107766404747264',
                        title: 'Get Lucky',
                        artistNames: ['Daft Punk'],
                        isrc: 'USQX91300108',
                        duration: 369,
                    },
                ],
            });

            const externalTrack = {
                id: 'apple:track:12345',
                provider: 'apple',
                title: 'Get Lucky',
                artist: { name: 'Daft Punk' },
                isrc: 'USQX91300108',
                duration: 369,
            };

            const stream = await api.resolveTrackStream(externalTrack);
            expect(stream).toBeDefined();
            expect(stream.url).toBe('https://tracks.monochrome.st/track/157107766404747264');
            expect(externalTrack.tracksTrackId).toBe('157107766404747264');
        });
    });
});
