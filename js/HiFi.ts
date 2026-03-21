const API_VERSION = '2.6';
const BROWSER_CLIENT_ID = 'txNoH4kkV41MfH25';
const BROWSER_CLIENT_SECRET = 'dQjy0MinCEvxi1O4UmxvxWnDjt4cgHBPw8ll6nYBk98=';

type Params = Record<string, string | number | undefined | null>;

class ResponseError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

export class TidalResponse extends Response {
    constructor(body: BodyInit, init?: ResponseInit) {
        super(body, init);
    }
}

export class HiFiClient {
    private static tokenPromise: Promise<string> | null = null;
    private static albumTracksMax = 20;
    private static albumTracksActive = 0;
    private static albumTracksQueue: Array<() => void> = [];
    private countryCode: string;
    private clientId: string;
    private clientSecret: string;
    private static _localStorage: Record<string, string> = {};
    private static get localStorage() {
        return (
            globalThis?.localStorage ?? {
                getItem: (key) => HiFiClient._localStorage[key],
                setItem: (key, value) => {
                    HiFiClient._localStorage[key] = String(value);
                },
                removeItem: (key) => {
                    delete HiFiClient._localStorage[key];
                },
                get length() {
                    return Object.keys(HiFiClient._localStorage).length;
                },
                clear() {
                    for (const key in HiFiClient._localStorage) {
                        delete HiFiClient._localStorage[key];
                    }
                },
                key(index) {
                    const keys = Object.keys(HiFiClient._localStorage);
                    return keys[index] || null;
                },
            }
        );
    }

    private static get token(): string | null {
        return HiFiClient.localStorage.getItem('hifi_token') || null;
    }

    private static set token(value: string | null) {
        if (value) {
            HiFiClient.localStorage.setItem('hifi_token', value);
        } else {
            HiFiClient.localStorage.removeItem('hifi_token');
        }
    }

    private static get appTokenExpiry() {
        return Number(HiFiClient.localStorage.getItem('hifi_token_expiry') || '0');
    }

    private static set appTokenExpiry(value: number) {
        if (value) {
            HiFiClient.localStorage.setItem('hifi_token_expiry', value.toString());
        } else {
            HiFiClient.localStorage.removeItem('hifi_token_expiry');
        }

        if (value < Date.now()) {
            HiFiClient.localStorage.removeItem('hifi_token');
        }
    }

    private static buildUrl(base: string, params?: Params) {
        if (!params) return base;
        const u = new URL(base);
        Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .forEach(([k, v]) => u.searchParams.set(k, String(v)));
        return u.toString();
    }

    private static encodeBasic(id: string, secret: string) {
        if (typeof globalThis.btoa === 'function') {
            return btoa(`${id}:${secret}`);
        }
        // Node fallback
        return Buffer.from(`${id}:${secret}`).toString('base64');
    }

    static setToken(token: string, expiry: number = Date.now() + 60000) {
        HiFiClient.token = token;
        HiFiClient.appTokenExpiry = expiry;
    }

    private static async fetchAppToken(
        signal: AbortSignal = new AbortController().signal,
        clientId: string,
        clientSecret: string
    ) {
        if (HiFiClient.token && Date.now() < HiFiClient.appTokenExpiry) return HiFiClient.token;

        return await (HiFiClient.tokenPromise ??= (async () => {
            try {
                const res = await fetch('https://auth.tidal.com/v1/oauth2/token', {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/x-www-form-urlencoded',
                        authorization: `Basic ${this.encodeBasic(clientId, clientSecret)}`,
                    },
                    body: new URLSearchParams({
                        grant_type: 'client_credentials',
                        client_id: clientId,
                        client_secret: clientSecret,
                    }),
                    signal,
                });

                if (!res.ok) {
                    const txt = await res.text().catch(() => '');
                    throw new Error(`Failed to obtain app token: ${res.status} ${txt}`);
                }

                const json = await res.json();
                const token = json.access_token;
                const expires_in = json.expires_in ?? 3600;
                HiFiClient.token = token;
                HiFiClient.appTokenExpiry = Date.now() + expires_in * 1000 - 60_000;

                return token;
            } finally {
                HiFiClient.tokenPromise = null;
            }
        })());
    }

    constructor(clientId = BROWSER_CLIENT_ID, clientSecret = BROWSER_CLIENT_SECRET, countryCode = 'US') {
        this.countryCode = countryCode;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
    }

    private async fetchJson(url: string, params?: Params, signal: AbortSignal = new AbortController().signal) {
        const final = HiFiClient.buildUrl(url, params);
        const res = await fetch(final, {
            headers: {
                authorization: `Bearer ${await HiFiClient.fetchAppToken(signal, this.clientId, this.clientSecret)}`,
            },
            signal,
        });

        if (!res.ok) {
            throw new ResponseError(res.status, res.statusText);
        }

        return res.json();
    }

    private static extractUuidFromTidalUrl(href?: string | null) {
        if (!href) return null;
        const parts = href.split('/');
        return parts.length >= 9 ? parts.slice(4, 9).join('-') : null;
    }

    private async withAlbumTrackSlot<T>(fn: () => Promise<T>) {
        if (HiFiClient.albumTracksActive >= HiFiClient.albumTracksMax) {
            await new Promise<void>((res) => HiFiClient.albumTracksQueue.push(res));
        }
        HiFiClient.albumTracksActive++;
        try {
            return await fn();
        } finally {
            HiFiClient.albumTracksActive--;
            const next = HiFiClient.albumTracksQueue.shift();
            if (next) next();
        }
    }

    async getInfo(id: number, signal?: AbortSignal) {
        const url = `https://api.tidal.com/v1/tracks/${id}/`;
        const data = await this.fetchJson(url, { countryCode: this.countryCode }, signal);
        return { version: API_VERSION, data };
    }

    async getTrack(id: number, quality = 'HI_RES_LOSSLESS', signal?: AbortSignal) {
        const url = `https://api.tidal.com/v1/tracks/${id}/playbackinfo`;
        const params = {
            audioquality: quality,
            playbackmode: 'STREAM',
            assetpresentation: 'FULL',
            countryCode: this.countryCode,
        };
        const data = await this.fetchJson(url, params, signal);
        return { version: API_VERSION, data };
    }

    async getRecommendations(id: number, signal?: AbortSignal) {
        const url = `https://api.tidal.com/v1/tracks/${id}/recommendations`;
        const data = await this.fetchJson(url, { limit: '20', countryCode: this.countryCode }, signal);
        return { version: API_VERSION, data };
    }

    async getSimilarArtists(id: number, cursor?: string | number | null, signal?: AbortSignal) {
        const url = `https://openapi.tidal.com/v2/artists/${id}/relationships/similarArtists`;
        const params: Params = {
            'page[cursor]': cursor ?? undefined,
            countryCode: this.countryCode,
            include: 'similarArtists,similarArtists.profileArt',
        };

        const payload = await this.fetchJson(url, params, signal);
        const included = Array.isArray(payload?.included) ? payload.included : [];
        const artists_map: Record<string, any> = {};
        const artworks_map: Record<string, any> = {};
        for (const i of included) {
            if (i.type === 'artists') artists_map[i.id] = i;
            if (i.type === 'artworks') artworks_map[i.id] = i;
        }

        const resolveArtist = (entry: any) => {
            const aid = entry.id;
            const inc = artists_map[aid] || {};
            const attr = inc.attributes || {};

            let pic_id: string | null = null;
            const art_data = inc.relationships?.profileArt?.data;
            if (Array.isArray(art_data) && art_data.length > 0) {
                const artwork = artworks_map[art_data[0].id];
                const files = artwork?.attributes?.files;
                if (Array.isArray(files) && files[0]?.href) {
                    pic_id = HiFiClient.extractUuidFromTidalUrl(files[0].href);
                }
            }

            return {
                ...attr,
                id: String(aid).match(/^\d+$/) ? Number(aid) : aid,
                picture: pic_id || attr.selectedAlbumCoverFallback,
                url: `http://www.tidal.com/artist/${aid}`,
                relationType: 'SIMILAR_ARTIST',
            };
        };

        return { version: API_VERSION, artists: (payload?.data || []).map(resolveArtist) };
    }

    async getSimilarAlbums(id: number, cursor?: string | number | null, signal?: AbortSignal) {
        const url = `https://openapi.tidal.com/v2/albums/${id}/relationships/similarAlbums`;
        const params: Params = {
            'page[cursor]': cursor ?? undefined,
            countryCode: this.countryCode,
            include: 'similarAlbums,similarAlbums.coverArt,similarAlbums.artists',
        };

        const payload = await this.fetchJson(url, params, signal);
        const included = Array.isArray(payload?.included) ? payload.included : [];
        const albums_map: Record<string, any> = {};
        const artworks_map: Record<string, any> = {};
        const artists_map: Record<string, any> = {};
        for (const i of included) {
            if (i.type === 'albums') albums_map[i.id] = i;
            if (i.type === 'artworks') artworks_map[i.id] = i;
            if (i.type === 'artists') artists_map[i.id] = i;
        }

        const resolveAlbum = (entry: any) => {
            const aid = entry.id;
            const inc = albums_map[aid] || {};
            const attr = inc.attributes || {};

            let cover_id: string | null = null;
            const art_data = inc.relationships?.coverArt?.data;
            if (Array.isArray(art_data) && art_data.length > 0) {
                const artwork = artworks_map[art_data[0].id];
                const files = artwork?.attributes?.files;
                if (Array.isArray(files) && files[0]?.href) {
                    cover_id = HiFiClient.extractUuidFromTidalUrl(files[0].href);
                }
            }

            const artist_list: any[] = [];
            const artists_data = inc.relationships?.artists?.data;
            if (Array.isArray(artists_data)) {
                for (const a_entry of artists_data) {
                    const a_obj = artists_map[a_entry.id];
                    if (a_obj) {
                        const a_id = a_obj.id;
                        artist_list.push({
                            id: String(a_id).match(/^\d+$/) ? Number(a_id) : a_id,
                            name: a_obj.attributes?.name,
                        });
                    }
                }
            }

            return {
                ...attr,
                id: String(aid).match(/^\d+$/) ? Number(aid) : aid,
                cover: cover_id,
                artists: artist_list,
                url: `http://www.tidal.com/album/${aid}`,
            };
        };

        return { version: API_VERSION, albums: (payload?.data || []).map(resolveAlbum) };
    }

    async getArtist(
        id?: number | null,
        f?: number | null,
        skip_tracks = false,
        signal?: AbortSignal,
        options?: { offset?: number; limit?: number }
    ) {
        if (!id && !f) throw new ResponseError(400, 'Provide id or f query param');

        if (id) {
            const artist_url = `https://api.tidal.com/v1/artists/${id}`;
            const artist_data = await this.fetchJson(artist_url, { countryCode: this.countryCode }, signal);

            let picture = artist_data.picture;
            const fallback = artist_data.selectedAlbumCoverFallback;
            if (!picture && fallback) {
                artist_data.picture = fallback;
                picture = fallback;
            }

            let cover = null;
            if (picture) {
                const slug = picture.replace(/-/g, '/');
                cover = {
                    id: artist_data.id,
                    name: artist_data.name,
                    '750': `https://resources.tidal.com/images/${slug}/750x750.jpg`,
                };
            }

            return { version: API_VERSION, artist: artist_data, cover };
        }

        // f provided -> gather albums and optionally tracks
        const albums_url = `https://api.tidal.com/v1/artists/${f}/albums`;
        const common_params: Params = { countryCode: this.countryCode, limit: 50 };

        const tasks: Promise<any>[] = [
            this.fetchJson(albums_url, common_params, signal),
            this.fetchJson(albums_url, { ...common_params, filter: 'EPSANDSINGLES' }, signal),
        ];

        if (skip_tracks) {
            const offset = options?.offset;
            const limit = options?.limit;
            const toptracks_params: Params = { countryCode: this.countryCode, limit: limit || 15 };
            if (offset !== undefined) {
                toptracks_params.offset = offset;
            }
            tasks.push(this.fetchJson(`https://api.tidal.com/v1/artists/${f}/toptracks`, toptracks_params, signal));
        }

        const results = await Promise.all(tasks.map((p) => p.catch((e) => e)));

        const unique_releases: any[] = [];
        const seen_ids = new Set<any>();

        for (const res of results.slice(0, 2)) {
            if (res && !(res instanceof Error)) {
                const data = res;
                const items = Array.isArray(data?.items) ? data.items : data || [];
                if (Array.isArray(items)) {
                    for (const item of items) {
                        if (item && item.id && !seen_ids.has(item.id)) {
                            unique_releases.push(item);
                            seen_ids.add(item.id);
                        }
                    }
                }
            }
        }

        const album_ids: number[] = unique_releases.map((i) => i.id).filter(Boolean);
        const page_data = { items: unique_releases };

        if (skip_tracks) {
            let top_tracks: any[] = [];
            if (results.length > 2) {
                const res = results[2];
                if (res && !(res instanceof Error)) {
                    top_tracks = Array.isArray(res.items) ? res.items : res || [];
                }
            }

            return { version: API_VERSION, albums: page_data, tracks: top_tracks };
        }

        if (!album_ids.length) return { version: API_VERSION, albums: page_data, tracks: [] };

        const fetchAlbumTracks = async (album_id: number) => {
            return await this.withAlbumTrackSlot(async () => {
                const album_data = await this.fetchJson(
                    'https://api.tidal.com/v1/pages/album',
                    { albumId: album_id, countryCode: this.countryCode, deviceType: 'BROWSER' },
                    signal
                );
                const rows = Array.isArray(album_data?.rows) ? album_data.rows : [];
                if (rows.length < 2) return [];
                const modules = rows[1].modules || [];
                if (!modules || modules.length === 0) return [];
                const paged_list = modules[0].pagedList || {};
                const items = paged_list.items || [];
                const tracks = items.map((t: any) => (t.item ? t.item : t));
                return tracks;
            });
        };

        const trackResults = await Promise.all(album_ids.map((aid) => fetchAlbumTracks(aid).catch(() => [])));
        const tracks: any[] = [];
        for (const t of trackResults) {
            if (Array.isArray(t)) tracks.push(...t);
        }

        return { version: API_VERSION, albums: page_data, tracks };
    }

    private buildCoverEntry(cover_slug: string, name?: string | null, track_id?: number | null) {
        const slug = cover_slug.replace(/-/g, '/');
        return {
            id: track_id,
            name,
            '1280': `https://resources.tidal.com/images/${slug}/1280x1280.jpg`,
            '640': `https://resources.tidal.com/images/${slug}/640x640.jpg`,
            '80': `https://resources.tidal.com/images/${slug}/80x80.jpg`,
        };
    }

    async getCover(id?: number | null, q?: string | null, signal?: AbortSignal) {
        if (!id && !q) throw new ResponseError(400, 'Provide id or q query param');

        if (id) {
            const track_data = await this.fetchJson(
                `https://api.tidal.com/v1/tracks/${id}/`,
                { countryCode: this.countryCode },
                signal
            );
            const album = track_data.album || {};
            const cover_slug = album.cover;
            if (!cover_slug) throw new ResponseError(404, 'Cover not found');
            const entry = this.buildCoverEntry(cover_slug, album.title || track_data.title, album.id || id);
            return { version: API_VERSION, covers: [entry] };
        }

        const search_data = await this.fetchJson(
            'https://api.tidal.com/v1/search/tracks',
            { countryCode: this.countryCode, query: q, limit: 10 },
            signal
        );
        const items = Array.isArray(search_data?.items) ? search_data.items.slice(0, 10) : [];
        if (!items.length) throw new ResponseError(404, 'Cover not found');
        const covers: any[] = [];
        for (const track of items) {
            const album = track.album || {};
            const cover_slug = album.cover;
            if (!cover_slug) continue;
            covers.push(this.buildCoverEntry(cover_slug, track.title, track.id));
        }
        if (!covers.length) throw new ResponseError(404, 'Cover not found');
        return { version: API_VERSION, covers };
    }

    async search(
        options: {
            s?: string;
            a?: string;
            al?: string;
            v?: string;
            p?: string;
            i?: string;
            offset?: number;
            limit?: number;
        },
        signal?: AbortSignal
    ) {
        const { s, a, al, v, p, i, offset = 0, limit = 25 } = options;

        if (i) {
            // try filtered track search first
            try {
                const res = await this.fetchJson(
                    'https://api.tidal.com/v1/tracks',
                    {
                        'filter[isrc]': i,
                        limit,
                        offset,
                        countryCode: this.countryCode,
                    },
                    signal
                );
                return { version: API_VERSION, data: res };
            } catch (err: any) {
                if (err.status && ![400, 404].includes(err.status)) throw err;
                // fallback to text search
            }
            const fallback = await this.fetchJson(
                'https://api.tidal.com/v1/search/tracks',
                {
                    query: i,
                    limit,
                    offset,
                    countryCode: this.countryCode,
                },
                signal
            );
            return { version: API_VERSION, data: fallback };
        }

        const mapping: Array<[string | undefined, string, Params]> = [
            [s, 'https://api.tidal.com/v1/search/tracks', { query: s, limit, offset, countryCode: this.countryCode }],
            [
                a,
                'https://api.tidal.com/v1/search/top-hits',
                { query: a, limit, offset, types: 'ARTISTS,TRACKS', countryCode: this.countryCode },
            ],
            [
                al,
                'https://api.tidal.com/v1/search/top-hits',
                { query: al, limit, offset, types: 'ALBUMS', countryCode: this.countryCode },
            ],
            [
                v,
                'https://api.tidal.com/v1/search/top-hits',
                { query: v, limit, offset, types: 'VIDEOS', countryCode: this.countryCode },
            ],
            [
                p,
                'https://api.tidal.com/v1/search/top-hits',
                { query: p, limit, offset, types: 'PLAYLISTS', countryCode: this.countryCode },
            ],
        ];

        for (const [val, url, params] of mapping) {
            if (val) {
                const data = await this.fetchJson(url, params, signal);
                return { version: API_VERSION, data };
            }
        }

        throw new Error('Provide one of s, a, al, v, p, or i');
    }

    async getAlbum(id: number, limit = 100, offset = 0, signal?: AbortSignal) {
        const albumUrl = `https://api.tidal.com/v1/albums/${id}`;
        const itemsUrl = `https://api.tidal.com/v1/albums/${id}/items`;
        const tasks: Promise<any>[] = [this.fetchJson(albumUrl, { countryCode: this.countryCode }, signal)];

        let remaining = limit;
        let currentOffset = offset;
        const maxChunk = 100;
        while (remaining > 0) {
            const chunk = Math.min(remaining, maxChunk);
            tasks.push(
                this.fetchJson(itemsUrl, { countryCode: this.countryCode, limit: chunk, offset: currentOffset }, signal)
            );
            currentOffset += chunk;
            remaining -= chunk;
        }

        const results = await Promise.all(tasks);
        const albumData = results[0];
        const pages = results.slice(1);
        const allItems: any[] = [];
        for (const p of pages) {
            const pageItems = (p && p.items) || p;
            if (Array.isArray(pageItems)) allItems.push(...pageItems);
        }
        albumData.items = allItems;
        return { version: API_VERSION, data: albumData };
    }

    async getMix(id: string, signal?: AbortSignal) {
        const url = 'https://api.tidal.com/v1/pages/mix';
        const data = await this.fetchJson(
            url,
            { mixId: id, countryCode: this.countryCode, deviceType: 'BROWSER' },
            signal
        );
        let header = {},
            items: any[] = [];
        const rows = data.rows || [];
        for (const row of rows) {
            for (const module of row.modules || []) {
                if (module.type === 'MIX_HEADER') header = module.mix || {};
                if (module.type === 'TRACK_LIST') items = (module.pagedList || {}).items || [];
            }
        }
        return { version: API_VERSION, mix: header, items: items.map((it: any) => (it.item ? it.item : it)) };
    }

    async getPlaylist(id: string, limit = 100, offset = 0, signal?: AbortSignal) {
        const playlistUrl = `https://api.tidal.com/v1/playlists/${id}`;
        const itemsUrl = `https://api.tidal.com/v1/playlists/${id}/items`;
        const [playlistData, itemsData] = await Promise.all([
            this.fetchJson(playlistUrl, { countryCode: this.countryCode }, signal),
            this.fetchJson(itemsUrl, { countryCode: this.countryCode, limit, offset }, signal),
        ]);
        const items = (itemsData && itemsData.items) || itemsData;
        return { version: API_VERSION, playlist: playlistData, items };
    }

    // simplified artist/cover/lyrics/video/topvideos/similar methods (same pattern)
    async getLyrics(id: number, signal?: AbortSignal) {
        const url = `https://api.tidal.com/v1/tracks/${id}/lyrics`;
        const data = await this.fetchJson(
            url,
            { countryCode: this.countryCode, locale: 'en_US', deviceType: 'BROWSER' },
            signal
        );
        if (!data) {
            const err: any = new Error('Lyrics not found');
            err.status = 404;
            throw err;
        }
        return { version: API_VERSION, lyrics: data };
    }

    async getVideo(id: number, quality = 'HIGH', mode = 'STREAM', presentation = 'FULL', signal?: AbortSignal) {
        const url = `https://api.tidal.com/v1/videos/${id}/playbackinfo`;
        const data = await this.fetchJson(
            url,
            { videoquality: quality, playbackmode: mode, assetpresentation: presentation },
            signal
        );
        return { version: API_VERSION, video: data };
    }

    async getTopVideos(
        { countryCode = 'US', locale = 'en_US', deviceType = 'BROWSER', limit = 25, offset = 0 } = {},
        signal?: AbortSignal
    ) {
        const url = 'https://api.tidal.com/v1/pages/mymusic_recommended_videos';
        const data = await this.fetchJson(url, { countryCode, locale, deviceType }, signal);
        const rows = data.rows || [];
        const videos: any[] = [];
        for (const row of rows) {
            for (const module of row.modules || []) {
                const mt = module.type;
                if (['VIDEO_PLAYLIST', 'VIDEO_ROW', 'PAGED_LIST'].includes(mt)) {
                    const items = (module.pagedList || {}).items || [];
                    for (const item of items) videos.push(item.item || item);
                } else if (mt === 'VIDEO' || (mt && mt.toLowerCase().includes('video'))) {
                    const it = module.item || module;
                    if (typeof it === 'object') videos.push(it);
                }
            }
        }
        return { version: API_VERSION, videos: videos.slice(offset, offset + limit), total: videos.length };
    }

    async queryResponse(pathOrUrl: string, signal?: AbortSignal) {
        try {
            return new TidalResponse(JSON.stringify(await this.query(pathOrUrl, signal)), {
                headers: { 'Content-Type': 'application/json' },
            });
        } catch (err: any) {
            if (err instanceof ResponseError) {
                return new TidalResponse(JSON.stringify({ error: err.message }), {
                    status: err.status,
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            throw err;
        }
    }

    // generic helper that accepts local route strings like "/info/?id=123" or full URLs
    async query(pathOrUrl: string, signal?: AbortSignal) {
        // normalize: if starts with http use as-is, else treat as local route
        try {
            const u = new URL(pathOrUrl, 'http://localhost');
            const pathname = u.pathname.replace(/\/+$/, '') || '/';
            const qp: Record<string, string> = {};
            u.searchParams.forEach((v, k) => (qp[k] = v));

            switch (pathname) {
                case '/':
                    return { version: API_VERSION, Repo: 'https://github.com/binimum/hifi-api' };
                case '/info':
                    return await this.getInfo(Number(qp.id));
                case '/track':
                    return await this.getTrack(Number(qp.id), qp.quality || undefined);
                case '/recommendations':
                    return await this.getRecommendations(Number(qp.id));
                case '/artist/similar':
                    return await this.getSimilarArtists(Number(qp.id), qp.cursor ?? undefined, signal);
                case '/album/similar':
                    return await this.getSimilarAlbums(Number(qp.id), qp.cursor ?? undefined, signal);
                case '/artist':
                    return await this.getArtist(
                        qp.id ? Number(qp.id) : undefined,
                        qp.f ? Number(qp.f) : undefined,
                        qp.skip_tracks === 'true' || qp.skip_tracks === '1' || qp.skip_tracks === 'True',
                        signal,
                        {
                            offset: qp.offset !== undefined ? Number(qp.offset) : undefined,
                            limit: qp.limit !== undefined ? Number(qp.limit) : undefined,
                        }
                    );
                case '/cover':
                    return await this.getCover(qp.id ? Number(qp.id) : undefined, qp.q ?? undefined, signal);
                case '/search':
                    return await this.search({
                        s: qp.s,
                        a: qp.a,
                        al: qp.al,
                        v: qp.v,
                        p: qp.p,
                        i: qp.i,
                        offset: qp.offset ? Number(qp.offset) : undefined,
                        limit: qp.limit ? Number(qp.limit) : undefined,
                    });
                case '/album':
                    return await this.getAlbum(
                        Number(qp.id),
                        qp.limit ? Number(qp.limit) : undefined,
                        qp.offset ? Number(qp.offset) : undefined
                    );
                case '/playlist':
                    return await this.getPlaylist(
                        qp.id || '',
                        qp.limit ? Number(qp.limit) : undefined,
                        qp.offset ? Number(qp.offset) : undefined
                    );
                case '/mix':
                    return await this.getMix(qp.id || '');
                case '/lyrics':
                    return await this.getLyrics(Number(qp.id));
                case '/video':
                    return await this.getVideo(
                        Number(qp.id),
                        qp.quality || undefined,
                        qp.mode || undefined,
                        qp.presentation || undefined
                    );
                case '/topvideos':
                    return await this.getTopVideos({
                        countryCode: qp.countryCode || undefined,
                        locale: qp.locale || undefined,
                        deviceType: qp.deviceType || undefined,
                        limit: qp.limit ? Number(qp.limit) : undefined,
                        offset: qp.offset ? Number(qp.offset) : undefined,
                    });
                default:
                    throw new Error(`Unknown route: ${pathname}`);
            }
        } catch (err) {
            throw err;
        }
    }
}
