// functions/unreleased/[sheetId]/[projectName].js

const ARTISTS_CSV_URL = 'https://artists.artistgrid.cx/artists.csv';
const _ASSETS_BASE_URL = 'https://assets.artistgrid.cx';
const TRACKER_API_BASE = 'https://trackerapi.artistgrid.cx/sh/';

// Some trackers are hosted at their own domain instead of a Google Sheets URL;
// the domain itself doubles as the sheetId on the tracker API.
const SPECIAL_TRACKER_DOMAINS = ['yetracker.net'];

function getSheetId(url) {
    if (!url) return null;
    const special = SPECIAL_TRACKER_DOMAINS.find((domain) => url.includes(domain));
    if (special) return special;
    const match = url.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match) return match[1];
    // The artists CSV now provides bare sheet IDs instead of full URLs
    const bare = url.trim();
    if (/^[a-zA-Z0-9-_]+$/.test(bare)) return bare;
    return null;
}

function _normalizeArtistName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Parse RFC4180-style CSV (quoted fields, escaped "" quotes, commas/newlines inside quotes)
function parseCSVRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[i + 1] === '\n') i++;
            row.push(field);
            rows.push(row);
            row = [];
            field = '';
        } else {
            field += char;
        }
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

function parseArtistsCSV(text) {
    const rows = parseCSVRows(text).filter((r) => r.length > 1 || r[0]);
    if (rows.length < 2) return [];
    const headers = rows[0];
    return rows.slice(1).map((row) => {
        const obj = {};
        headers.forEach((header, i) => {
            obj[header] = row[i] ?? '';
        });
        return obj;
    });
}

async function loadArtistsData() {
    try {
        const response = await fetch(ARTISTS_CSV_URL);
        if (!response.ok) throw new Error('Network response was not ok');
        const text = await response.text();
        return parseArtistsCSV(text);
    } catch (e) {
        console.error('Failed to load Artists List:', e);
        return [];
    }
}

async function fetchTrackerData(sheetId) {
    try {
        const response = await fetch(`${TRACKER_API_BASE}${sheetId}/`);
        if (!response.ok) return null;
        return await response.json();
    } catch (e) {
        console.warn(`Failed to fetch tracker data for ${sheetId}`, e);
        return null;
    }
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
                const era = trackerData.eras.find((e) => e.name === projectName);
                const imageUrl = era && era.cover_art ? era.cover_art : 'https://monochrome.tf/assets/appicon.png';
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
