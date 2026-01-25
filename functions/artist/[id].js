// functions/artist/[id].js

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

    async getArtistMetadata(id) {
        try {
            const response = await this.fetchWithRetry(`/artist/${id}`);
            return await response.json();
        } catch {
            const response = await this.fetchWithRetry(`/artist?id=${id}`);
            return await response.json();
        }
    }

    getArtistPictureUrl(id, size = '750') {
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
    const artistId = params.id;

    if (isBot && artistId) {
        try {
            const api = new ServerAPI();
            const data = await api.getArtistMetadata(artistId);
            const artist = data.artist || data.data || data;

            if (artist && (artist.name || artist.title)) {
                const name = artist.name || artist.title;
                const description = `Listen to ${name} on Monochrome`;
                const imageUrl = artist.picture
                    ? api.getArtistPictureUrl(artist.picture, '750')
                    : 'https://monochrome.samidy.com/assets/appicon.png';
                const pageUrl = new URL(request.url).href;

                const metaHtml = `
                    <!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <title>${name}</title>
                        <meta name="description" content="${description}">
                        <meta name="theme-color" content="#000000">
                        
                        <meta property="og:site_name" content="Monochrome">
                        <meta property="og:title" content="${name}">
                        <meta property="og:description" content="${description}">
                        <meta property="og:image" content="${imageUrl}">
                        <meta property="og:type" content="profile">
                        <meta property="og:url" content="${pageUrl}">
                        
                        <meta name="twitter:card" content="summary_large_image">
                        <meta name="twitter:title" content="${name}">
                        <meta name="twitter:description" content="${description}">
                        <meta name="twitter:image" content="${imageUrl}">
                    </head>
                    <body>
                        <h1>${name}</h1>
                        <img src="${imageUrl}" alt="Artist Picture">
                    </body>
                    </html>
                `;

                return new Response(metaHtml, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
            }
        } catch (error) {
            console.error(`Error for artist ${artistId}:`, error);
        }
    }

    const url = new URL(request.url);
    url.pathname = '/';
    return env.ASSETS.fetch(new Request(url, request));
}
