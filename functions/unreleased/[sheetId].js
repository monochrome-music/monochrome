// functions/unreleased/[sheetId].js

const ARTISTS_NDJSON_URL = 'https://assets.artistgrid.cx/artists.ndjson';
const ASSETS_BASE_URL = 'https://assets.artistgrid.cx';

function getSheetId(url) {
    if (!url) return null;
    const match = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

function normalizeArtistName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function loadArtistsData() {
    try {
        const response = await fetch(ARTISTS_NDJSON_URL);
        if (!response.ok) throw new Error('Network response was not ok');
        const text = await response.text();
        return text
            .trim()
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter((item) => item !== null);
    } catch (e) {
        console.error('Failed to load Artists List:', e);
        return [];
    }
}

export async function onRequest(context) {
    const { request, params, env } = context;
    const userAgent = request.headers.get('User-Agent') || '';
    const isBot =
        /discordbot|twitterbot|facebookexternalhit|bingbot|googlebot|slurp|whatsapp|pinterest|slackbot|telegrambot|linkedinbot|mastodon|signal|snapchat|redditbot|skypeuripreview|viberbot|linebot|embedly|quora|outbrain|tumblr|duckduckbot|yandexbot|rogerbot|showyoubot|kakaotalk|naverbot|seznambot|mediapartners|adsbot|petalbot|applebot|ia_archiver/i.test(
            userAgent
        );
    const sheetId = params.sheetId;

    if (isBot && sheetId) {
        try {
            const artists = await loadArtistsData();
            const artist = artists.find((a) => getSheetId(a.url) === sheetId);

            if (artist && artist.name) {
                const normalizedName = normalizeArtistName(artist.name);
                const imageUrl = `${ASSETS_BASE_URL}/${normalizedName}.webp`;
                const pageUrl = new URL(request.url).href;
                const title = `${artist.name} | Unreleased`;
                const description = `Stream unreleased music by ${artist.name} on Monochrome`;

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
                        <meta property="og:type" content="profile">
                        <meta property="og:url" content="${pageUrl}">

                        <meta name="twitter:card" content="summary_large_image">
                        <meta name="twitter:title" content="${title}">
                        <meta name="twitter:description" content="${description}">
                        <meta name="twitter:image" content="${imageUrl}">
                    </head>
                    <body>
                        <h1>${artist.name}</h1>
                        <p>${description}</p>
                        <img src="${imageUrl}" alt="${artist.name}">
                    </body>
                    </html>
                `;

                return new Response(metaHtml, {
                    headers: { 'content-type': 'text/html;charset=UTF-8' },
                });
            }
        } catch (error) {
            console.error(`Error generating meta tags for unreleased artist ${sheetId}:`, error);
        }
    }

    const url = new URL(request.url);
    url.pathname = '/';
    return env.ASSETS.fetch(new Request(url, request));
}
