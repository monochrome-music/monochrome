// functions/album/[id].js

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
            console.error('Failed to load instances:', error);
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

    async getAlbumMetadata(id) {
        try {
            const response = await this.fetchWithRetry(`/album/${id}`);
            return await response.json();
        } catch {
            const response = await this.fetchWithRetry(`/album?id=${id}`);
            return await response.json();
        }
    }

    getCoverUrl(id, size = '1280') {
        if (!id) return '';
        const formattedId = id.replace(/-/g, '/');
        return `https://resources.tidal.com/images/${formattedId}/${size}x${size}.jpg`;
    }
}

export async function onRequest(context) {
    const { request, params, env } = context;
    const userAgent = request.headers.get('User-Agent') || '';
    const isBot = /discordbot|twitterbot|facebookexternalhit|bingbot|googlebot|slurp|whatsapp|pinterest|slackbot/i.test(
        userAgent
    );
    const albumId = params.id;

    if (isBot && albumId) {
        try {
            const api = new ServerAPI();
            const data = await api.getAlbumMetadata(albumId);
            const album = data.data || data.album || data;
            const tracks = album.items || data.tracks || [];

            if (album && (album.title || album.name)) {
                const title = album.title || album.name;
                const artist = album.artist?.name || 'Unknown Artist';
                const year = album.releaseDate ? new Date(album.releaseDate).getFullYear() : '';
                const trackCount = album.numberOfTracks || tracks.length;

                const description = `Album by ${artist} • ${year} • ${trackCount} Tracks\nListen on Monochrome`;
                const imageUrl = album.cover
                    ? api.getCoverUrl(album.cover, '1280')
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
                        <meta property="og:type" content="music.album">
                        <meta property="og:url" content="${pageUrl}">
                        <meta property="music:musician" content="${artist}">
                        <meta property="music:release_date" content="${album.releaseDate}">
                        
                        <meta name="twitter:card" content="summary_large_image">
                        <meta name="twitter:title" content="${title}">
                        <meta name="twitter:description" content="${description}">
                        <meta name="twitter:image" content="${imageUrl}">
                    </head>
                    <body>
                        <h1>${title}</h1>
                        <p>${description}</p>
                        <img src="${imageUrl}" alt="Album Cover">
                    </body>
                    </html>
                `;

                return new Response(metaHtml, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
            }
        } catch (error) {
            console.error(`Error for album ${albumId}:`, error);
        }
    }

    const url = new URL(request.url);
    url.pathname = '/';
    return env.ASSETS.fetch(new Request(url, request));
}
