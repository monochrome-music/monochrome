// functions/track/[id].js

function getTrackTitle(track, { fallback = 'Unknown Title' } = {}) {
    if (!track?.title) return fallback;
    return track?.version ? `${track.title} (${track.version})` : track.title;
}

function getTrackArtists(track = {}, { fallback = 'Unknown Artist' } = {}) {
    if (track?.artists?.length) {
        return track.artists.map((artist) => artist?.name).join(', ');
    }
    return fallback;
}

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

    async getTrackMetadata(id) {
        return await this.fetchJson(`https://api.tidal.com/v1/tracks/${id}/`, { countryCode: 'US' });
    }

    async getStreamUrl(id) {
        const data = await this.fetchJson(`https://api.tidal.com/v1/tracks/${id}/playbackinfo`, {
            audioquality: 'LOW',
            playbackmode: 'STREAM',
            assetpresentation: 'FULL',
            countryCode: 'US',
        });
        return data.url || data.streamUrl;
    }

    getCoverUrl(id, size = '1280') {
        if (!id) return '';
        const formattedId = String(id).replace(/-/g, '/');
        return `https://resources.tidal.com/images/${formattedId}/${size}x${size}.jpg`;
    }
}

class ServerAPI {
    constructor() {
        this.INSTANCES_URLS = [
            'https://tidal-uptime.jiffy-puffs-1j.workers.dev/',
            'https://tidal-uptime.props-76styles.workers.dev/',
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
            this.apiInstances = (data.api || []).map((item) => item.url || item);
            return this.apiInstances;
        }

        console.error('Failed to load instances from all uptime APIs');
        return [
            'https://eu-central.monochrome.tf',
            'https://us-west.monochrome.tf',
            'https://arran.monochrome.tf',
            'https://triton.squid.wtf',
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

    async getTrackMetadata(id) {
        const response = await this.fetchWithRetry(`/info/?id=${id}`);
        const json = await response.json();
        const data = json.data || json;
        const items = Array.isArray(data) ? data : [data];
        const found = items.find((i) => i.id == id || (i.item && i.item.id == id));
        if (found) {
            return found.item || found;
        }
        throw new Error('Track metadata not found');
    }

    getCoverUrl(id, size = '1280') {
        if (!id) return '';
        const formattedId = String(id).replace(/-/g, '/');
        return `https://resources.tidal.com/images/${formattedId}/${size}x${size}.jpg`;
    }

    async getStreamUrl(id) {
        const response = await this.fetchWithRetry(`/stream?id=${id}&quality=LOW`);
        const data = await response.json();
        return data.url || data.streamUrl;
    }
}

export async function onRequest(context) {
    const { request, params, env } = context;
    const userAgent = request.headers.get('User-Agent') || '';
    const isBot =
        /discordbot|twitterbot|facebookexternalhit|bingbot|googlebot|slurp|whatsapp|pinterest|slackbot|telegrambot|linkedinbot|mastodon|signal|snapchat|redditbot|skypeuripreview|viberbot|linebot|embedly|quora|outbrain|tumblr|duckduckbot|yandexbot|rogerbot|showyoubot|kakaotalk|naverbot|seznambot|mediapartners|adsbot|petalbot|applebot|ia_archiver/i.test(
            userAgent
        );
    const trackId = params.id;

    if (isBot && trackId) {
        // Try direct Tidal API first, fall back to proxy instances
        let api;
        let track;
        try {
            api = new TidalAPI();
            track = await api.getTrackMetadata(trackId);
        } catch (directError) {
            console.warn(`Direct Tidal API failed for track ${trackId}, falling back to proxies:`, directError);
            try {
                api = new ServerAPI();
                track = await api.getTrackMetadata(trackId);
            } catch (fallbackError) {
                console.error(`All methods failed for track ${trackId}:`, fallbackError);
            }
        }

        if (track) {
            try {
                const title = getTrackTitle(track);
                const artist = getTrackArtists(track);
                const description = `${artist} - ${track.album.title}`;
                const imageUrl = api.getCoverUrl(track.album.cover, '1280');
                const trackUrl = new URL(request.url).href;

                let audioUrl = track.previewUrl || track.previewURL;

                if (!audioUrl) {
                    try {
                        audioUrl = await api.getStreamUrl(trackId);
                    } catch (e) {
                        console.error('Failed to fetch stream fallback:', e);
                    }
                }

                const audioMeta = audioUrl
                    ? `
                    <meta property="og:audio" content="${audioUrl}">
                    <meta property="og:audio:type" content="audio/mp4">
                    <meta property="og:video" content="${audioUrl}">
                    <meta property="og:video:type" content="audio/mp4">
                `
                    : '';

                const metaHtml = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <title>${title} by ${artist}</title>
                        <meta name="description" content="${description}">

                        <meta property="og:title" content="${title}">
                        <meta property="og:description" content="${description}">
                        <meta property="og:image" content="${imageUrl}">
                        <meta property="og:type" content="music.song">
                        <meta property="og:url" content="${trackUrl}">
                        <meta property="music:duration" content="${track.duration}">
                        <meta property="music:album" content="${track.album.title}">
                        <meta property="music:musician" content="${artist}">

                        ${audioMeta}

                        <meta name="twitter:card" content="summary_large_image">
                        <meta name="twitter:title" content="${title}">
                        <meta name="twitter:description" content="${description}">
                        <meta name="twitter:image" content="${imageUrl}">

                        <meta name="theme-color" content="#000000">
                    </head>
                    <body>
                        <h1>${title}</h1>
                        <p>by ${artist}</p>
                    </body>
                    </html>
                `;

                return new Response(metaHtml, {
                    headers: { 'content-type': 'text/html;charset=UTF-8' },
                });
            } catch (error) {
                console.error(`Error generating meta tags for track ${trackId}:`, error);
            }
        }
    }

    const url = new URL(request.url);
    url.pathname = '/';
    return env.ASSETS.fetch(new Request(url, request));
}
