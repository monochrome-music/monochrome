// functions/unreleased/[sheetId]/[projectName].js

const ARTISTS_NDJSON_URL = 'https://assets.artistgrid.cx/artists.ndjson';
const _ASSETS_BASE_URL = 'https://assets.artistgrid.cx';
const TRACKER_API_ENDPOINTS = [
    'https://trackerapi-1.artistgrid.cx/get/',
    'https://trackerapi-2.artistgrid.cx/get/',
    'https://trackerapi-3.artistgrid.cx/get/',
];

function getSheetId(url) {
    if (!url) return null;
    const match = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

function _normalizeArtistName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function transformImageUrl(url) {
    if (!url) return url;
    return url.replace('https://s3.sad.ovh/trackerapi/', 'https://r2.artistgrid.cx/');
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

async function fetchTrackerData(sheetId) {
    for (const baseUrl of TRACKER_API_ENDPOINTS) {
        try {
            const response = await fetch(`${baseUrl}${sheetId}`);
            if (!response.ok) continue;
            const data = await response.json();
            if (data.eras) {
                for (const eraName in data.eras) {
                    const era = data.eras[eraName];
                    if (era.image) {
                        era.image = transformImageUrl(era.image);
                    }
                }
            }
            return data;
        } catch (e) {
            console.warn(`Failed to fetch from ${baseUrl}, trying next...`, e);
        }
    }
    return null;
}

export async function onRequest(context) {
    const { request, params, env } = context;
    const userAgent = request.headers.get('User-Agent') || '';
    const isBot =
        /discordbot|twitterbot|facebookexternalhit|bingbot|googlebot|slurp|whatsapp|pinterest|slackbot|telegrambot|linkedinbot|linkedinbot|mastodon|signal|snapchat|redditbot|skypeuripreview|viberbot|linebot|embedly|quora|outbrain|tumblr|duckduckbot|yandexbot|rogerbot|showyoubot|kakaotalk|naverbot|seznambot|mediapartners|adsbot|petalbot|applebot|ia_archiver/i.test(
            userAgent
        );
    const sheetId = params.sheetId;
    const projectName = params.projectName ? decodeURIComponent(params.projectName) : null;

    if (isBot && sheetId && projectName) {
        try {
            const artists = await loadArtistsData();
            const artist = artists.find((a) => getSheetId(a.url) === sheetId);
            const trackerData = await fetchTrackerData(sheetId);

            if (artist && artist.name && trackerData && trackerData.eras) {
                const era = trackerData.eras[projectName];
                const imageUrl = era && era.image ? era.image : 'https://monochrome.tf/assets/appicon.png';
                const pageUrl = new URL(request.url).href;
                const title = `${projectName} - ${artist.name}`;
                const description = `Stream ${projectName} by ${artist.name} on Monochrome`;

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

                        <meta name="twitter:card" content="summary_large_image">
                        <meta name="twitter:title" content="${title}">
                        <meta name="twitter:description" content="${description}">
                        <meta name="twitter:image" content="${imageUrl}">
                    </head>
                    <body>
                        <h1>${title}</h1>
                        <p>${description}</p>
                        <img src="${imageUrl}" alt="${projectName} cover">
                    </body>
                    </html>
                `;

                return new Response(metaHtml, {
                    headers: { 'content-type': 'text/html;charset=UTF-8' },
                });
            }
        } catch (error) {
            console.error(`Error generating meta tags for unreleased project ${sheetId}/${projectName}:`, error);
        }
    }

    const url = new URL(request.url);
    url.pathname = '/';
    return env.ASSETS.fetch(new Request(url, request));
}
