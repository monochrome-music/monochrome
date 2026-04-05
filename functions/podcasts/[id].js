// functions/podcasts/[id].js

const PODCASTINDEX_API_BASE = 'https://api.podcastindex.org/api/1.0';
const PODCAST_API_KEY = 'YU5HMSDYBQQVYDF6QN4P';
const PODCAST_API_SECRET = '8hCvpjSL7T$S7^5ftnf5MhqQwYUYVjM^fmUL3Ld$';

async function sha1(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getAuthHeaders() {
    const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
    const combined = PODCAST_API_KEY + PODCAST_API_SECRET + apiHeaderTime;
    const authHeader = await sha1(combined);
    return {
        'User-Agent': 'MonochromeMusic/1.0',
        'X-Auth-Key': PODCAST_API_KEY,
        'X-Auth-Date': apiHeaderTime,
        Authorization: authHeader,
    };
}

export async function onRequest(context) {
    const { request, params, env } = context;
    const userAgent = request.headers.get('User-Agent') || '';
    const isBot =
        /discordbot|twitterbot|facebookexternalhit|bingbot|googlebot|slurp|whatsapp|pinterest|slackbot|telegrambot|linkedinbot|mastodon|signal|snapchat|redditbot|skypeuripreview|viberbot|linebot|embedly|quora|outbrain|tumblr|duckduckbot|yandexbot|rogerbot|showyoubot|kakaotalk|naverbot|seznambot|mediapartners|adsbot|petalbot|applebot|ia_archiver/i.test(
            userAgent
        );
    const podcastId = params.id;

    if (isBot && podcastId) {
        try {
            const headers = await getAuthHeaders();
            const response = await fetch(`${PODCASTINDEX_API_BASE}/podcasts/byfeedid?id=${podcastId}&pretty`, {
                method: 'GET',
                headers,
            });

            if (!response.ok) throw new Error(`PodcastIndex error: ${response.status}`);

            const data = await response.json();
            const feed = data.status === 'true' && data.feed ? data.feed : null;

            if (feed && feed.title) {
                const title = feed.title;
                const author = feed.author || feed.ownerName || '';
                const episodeCount = feed.episodeCount || 0;
                const _rawDescription = feed.description || '';
                const description = author
                    ? `Podcast by ${author} • ${episodeCount} Episodes\nListen on Monochrome`
                    : `Podcast • ${episodeCount} Episodes\nListen on Monochrome`;
                const imageUrl = feed.image || feed.artwork || 'https://monochrome.tf/assets/appicon.png';
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
                        <meta property="og:type" content="website">
                        <meta property="og:url" content="${pageUrl}">

                        <meta name="twitter:card" content="summary_large_image">
                        <meta name="twitter:title" content="${title}">
                        <meta name="twitter:description" content="${description}">
                        <meta name="twitter:image" content="${imageUrl}">
                    </head>
                    <body>
                        <h1>${title}</h1>
                        <p>${description}</p>
                        <img src="${imageUrl}" alt="Podcast Cover">
                    </body>
                    </html>
                `;

                return new Response(metaHtml, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
            }
        } catch (error) {
            console.error(`Error for podcast ${podcastId}:`, error);
        }
    }

    const url = new URL(request.url);
    url.pathname = '/';
    return env.ASSETS.fetch(new Request(url, request));
}
