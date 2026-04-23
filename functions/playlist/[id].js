// functions/playlist/[id].js

class TidalAPI {
    static CLIENT_ID = 'txNoH4kkV41MfH25';
    static CLIENT_SECRET = 'dQjy0MinCEvxi1O4UmxvxWnDjt4cgHBPw8ll6nYBk98=';

    async getToken() {
        const params = new URLSearchParams({
            client_id: TidalAPI.CLIENT_ID,
            client_secret: TidalAPI.CLIENT_SECRET,
            grant_type: 'client_credentials',
        });
        const res = await fetch('https://auth.tidal.com/v1/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Authorization: 'Basic ' + btoa(`${TidalAPI.CLIENT_ID}:${TidalAPI.CLIENT_SECRET}`),
            },
            body: params,
        });
        if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
        const data = await res.json();
        return data.access_token;
    }

    async fetchJson(url, params = {}) {
        const token = await this.getToken();
        const u = new URL(url);
        Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, String(v)));
        const res = await fetch(u.toString(), {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Tidal API error: ${res.status}`);
        return res.json();
    }

    async getPlaylistMetadata(id) {
        return await this.fetchJson(`https://api.tidal.com/v1/playlists/${id}`, { countryCode: 'US' });
    }

    getCoverUrl(id, size = '1080') {
        if (!id) return '';
        const formattedId = String(id).replace(/-/g, '/');
        return `https://resources.tidal.com/images/${formattedId}/${size}x${size}.jpg`;
    }
}

class ServerAPI {
    constructor() {
        this.INSTANCES_URLS = [
            'https://tidal-uptime.geeked.wtf',
        ];
        this.apiInstances = null;
    }

    async getInstances() {
        if (this.apiInstances) return this.apiInstances;

        let data = null;
        const urls = [...this.INSTANCES_URLS].sort(() => Math.random() - 0.5);

        for (const url of urls) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                data = await response.json();
                break;
            } catch (error) {
                console.warn(`Failed to fetch from ${url}:`, error);
            }
        }

        if (data) {
            this.apiInstances = (data.api || [])
                .map((item) => item.url || item)
                .filter((url) => !/\.squid\.wtf/i.test(url));
            return this.apiInstances;
        }

        console.error('Failed to load instances from all uptime APIs');
        return [
            'https://eu-central.monochrome.tf',
            'https://us-west.monochrome.tf',
            'https://arran.monochrome.tf',
            'https://api.monochrome.tf',
            'https://monochrome-api.samidy.com',
            'https://maus.qqdl.site',
            'https://vogel.qqdl.site',
            'https://katze.qqdl.site',
            'https://hund.qqdl.site',
            'https://tidal.kinoplus.online',
            'https://wolf.qqdl.site',
        ];
    }

    async fetchWithRetry(relativePath) {
        const instances = await this.getInstances();
        if (instances.length === 0) {
            throw new Error('No API instances configured.');
        }

        let lastError = null;
        for (const baseUrl of instances) {
            const url = baseUrl.endsWith('/') ? `${baseUrl}${relativePath.substring(1)}` : `${baseUrl}${relativePath}`;
            try {
                const response = await fetch(url);
                if (response.ok) {
                    return response;
                }
                lastError = new Error(`Request failed with status ${response.status}`);
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error(`All API instances failed for: ${relativePath}`);
    }

    async getPlaylistMetadata(id) {
        try {
            const response = await this.fetchWithRetry(`/playlist/${id}`);
            return await response.json();
        } catch {
            const response = await this.fetchWithRetry(`/playlist?id=${id}`);
            return await response.json();
        }
    }

    getCoverUrl(id, size = '1080') {
        if (!id) return '';
        const formattedId = String(id).replace(/-/g, '/');
        return `https://resources.tidal.com/images/${formattedId}/${size}x${size}.jpg`;
    }
}

export async function onRequest(context) {
    const { request, params, env } = context;
    const userAgent = request.headers.get('User-Agent') || '';
    const isBot =
        /discordbot|twitterbot|facebookexternalhit|bingbot|googlebot|slurp|whatsapp|pinterest|slackbot|telegrambot|linkedinbot|mastodon|signal|snapchat|redditbot|skypeuripreview|viberbot|linebot|embedly|quora|outbrain|tumblr|duckduckbot|yandexbot|rogerbot|showyoubot|kakaotalk|naverbot|seznambot|mediapartners|adsbot|petalbot|applebot|ia_archiver/i.test(
            userAgent
        );
    const playlistId = params.id;

    if (isBot && playlistId) {
        let api;
        let playlist;
        try {
            api = new TidalAPI();
            playlist = await api.getPlaylistMetadata(playlistId);
        } catch (directError) {
            console.warn(`Direct Tidal API failed for playlist ${playlistId}, falling back to proxies:`, directError);
            try {
                api = new ServerAPI();
                const data = await api.getPlaylistMetadata(playlistId);
                playlist = data.playlist || data.data || data;
            } catch (fallbackError) {
                console.error(`All methods failed for playlist ${playlistId}:`, fallbackError);
            }
        }

        if (playlist && (playlist.title || playlist.name)) {
            try {
                const title = playlist.title || playlist.name;
                const trackCount = playlist.numberOfTracks;
                const description = `Playlist • ${trackCount} Tracks\nListen on Monochrome`;
                const imageId = playlist.squareImage || playlist.image;
                const imageUrl = imageId
                    ? api.getCoverUrl(imageId, '1080')
                    : 'https://monochrome.samidy.com/assets/appicon.png';
                const pageUrl = new URL(request.url).href;

                const metaHtml = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <title>${title}</title>
                        <meta name="description" content="${description}">
                        <meta name="theme-color" content="#000000">

                        <meta property="og:site_name" content="Monochrome">
                        <meta property="og:title" content="${title}">
                        <meta property="og:description" content="${description}">
                        <meta property="og:image" content="${imageUrl}">
                        <meta property="og:type" content="music.playlist">
                        <meta property="og:url" content="${pageUrl}">
                        <meta property="music:song_count" content="${trackCount}">

                        <meta name="twitter:card" content="summary_large_image">
                        <meta name="twitter:title" content="${title}">
                        <meta name="twitter:description" content="${description}">
                        <meta name="twitter:image" content="${imageUrl}">
                    </head>
                    <body>
                        <h1>${title}</h1>
                        <p>${description}</p>
                        <img src="${imageUrl}" alt="Playlist Cover">
                    </body>
                    </html>
                `;

                return new Response(metaHtml, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
            } catch (error) {
                console.error(`Error generating meta tags for playlist ${playlistId}:`, error);
            }
        }
    }

    const url = new URL(request.url);
    url.pathname = '/';
    return env.ASSETS.fetch(new Request(url, request));
}
