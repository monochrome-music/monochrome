// functions/userplaylist/[id].js

const POCKETBASE_URL = 'https://data.samidy.xyz';
const PUBLIC_COLLECTION = 'public_playlists';

function safeParseTracks(tracksData) {
    if (!tracksData) return [];
    if (Array.isArray(tracksData)) return tracksData;
    if (typeof tracksData === 'string') {
        try {
            return JSON.parse(tracksData);
        } catch {
            return [];
        }
    }
    return [];
}

function parseDuration(durationStr) {
    if (!durationStr || durationStr === 'N/A' || typeof durationStr !== 'string') return 0;
    const parts = durationStr.split(':');
    if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }
    return 0;
}

function calculatePlaylistDuration(tracks) {
    let totalSeconds = 0;
    for (const track of tracks) {
        const duration = track.duration || track.durationSeconds || 0;
        if (typeof duration === 'number') {
            totalSeconds += duration;
        } else if (typeof duration === 'string') {
            totalSeconds += parseDuration(duration);
        }
    }
    return totalSeconds;
}

function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0 min';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
        return `${hours} hr ${minutes} min`;
    }
    return `${minutes} min`;
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
        try {
            const filter = `uuid="${playlistId}"`;
            const apiUrl = `${POCKETBASE_URL}/api/collections/${PUBLIC_COLLECTION}/records?filter=${encodeURIComponent(filter)}&perPage=1`;

            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`PocketBase error: ${response.status}`);

            const result = await response.json();
            const record = result.items && result.items.length > 0 ? result.items[0] : null;

            if (record) {
                let extraData = {};
                try {
                    extraData = record.data ? JSON.parse(record.data) : {};
                } catch {
                    extraData = {};
                }

                const title =
                    record.title ||
                    record.name ||
                    (extraData && (extraData.title || extraData.name)) ||
                    'Untitled Playlist';

                let tracks = safeParseTracks(record.tracks);
                const trackCount = tracks.length;
                const totalDuration = calculatePlaylistDuration(tracks);
                const durationStr = formatDuration(totalDuration);

                let rawCover = record.image || record.cover || record.playlist_cover || '';
                if (!rawCover && extraData && typeof extraData === 'object') {
                    rawCover = extraData.cover || extraData.image || '';
                }

                let imageUrl = '';
                if (rawCover && (rawCover.startsWith('http') || rawCover.startsWith('data:'))) {
                    imageUrl = rawCover;
                } else if (rawCover) {
                    imageUrl = `${POCKETBASE_URL}/api/files/${PUBLIC_COLLECTION}/${record.id}/${rawCover}`;
                }

                if (!imageUrl && tracks.length > 0) {
                    const firstCover = tracks.find((t) => t.album?.cover)?.album?.cover;
                    if (firstCover) {
                        const formattedId = String(firstCover).replace(/-/g, '/');
                        imageUrl = `https://resources.tidal.com/images/${formattedId}/1080x1080.jpg`;
                    }
                }

                if (!imageUrl) {
                    imageUrl = 'https://monochrome.tf/assets/appicon.png';
                }

                const description = `Playlist • ${trackCount} Tracks • ${durationStr}\nListen on Monochrome`;
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
            }
        } catch (error) {
            console.error(`Error for user playlist ${playlistId}:`, error);
        }
    }

    const url = new URL(request.url);
    url.pathname = '/';
    return env.ASSETS.fetch(new Request(url, request));
}
