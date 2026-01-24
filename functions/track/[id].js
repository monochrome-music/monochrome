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

class ServerAPI {
    constructor() {
        this.INSTANCES_URL = 'https://raw.githubusercontent.com/SamidyFR/monochrome/main/instances.json';
        this.apiInstances = null;
    }

    async getInstances() {
        if (this.apiInstances) return this.apiInstances;
        try {
            const response = await fetch(this.INSTANCES_URL);
            if (!response.ok) throw new Error('Failed to fetch instances');
            const data = await response.json();
            this.apiInstances = data.api || [];
            return this.apiInstances;
        } catch (error) {
            console.error('Failed to load instances from GitHub:', error);
            return [
                'https://triton.squid.wtf',
                'https://wolf.qqdl.site',
                'https://tidal-api.binimum.org',
                'https://monochrome-api.samidy.com',
            ];
        }
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
        const formattedId = id.replace(/-/g, '/');
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
    const isBot = /discordbot|twitterbot|facebookexternalhit|bingbot|googlebot|slurp|whatsapp|pinterest|slackbot/i.test(
        userAgent
    );
    const trackId = params.id;

    if (isBot && trackId) {
        try {
            const api = new ServerAPI();
            const track = await api.getTrackMetadata(trackId);

            if (track) {
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
                // this prob wont work im js winging it
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
            }
        } catch (error) {
            console.error(`Error generating meta tags for track ${trackId}:`, error);
        }
    }

    const url = new URL(request.url);
    url.pathname = '/';
    return env.ASSETS.fetch(new Request(url, request));
}
