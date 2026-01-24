// functions/userplaylist/[id].js

// note that, since this NEEDS a playlist to yknow, be public, this only works for PUBLIC playlists (and you will need an account)

export async function onRequest(context) {
    const { request, params, env } = context;
    const userAgent = request.headers.get('User-Agent') || '';
    const isBot = /discordbot|twitterbot|facebookexternalhit|bingbot|googlebot|slurp|whatsapp|pinterest|slackbot/i.test(
        userAgent
    );
    const playlistId = params.id;

    if (isBot && playlistId) {
        try {
            let pbUrl = `https://monodb.samidy.com/api/collections/user_playlists/records/${playlistId}`;
            let response = await fetch(pbUrl);

            if (!response.ok) {
                pbUrl = `https://monodb.samidy.com/api/collections/public_playlists/records?filter=(uuid='${playlistId}')`;
                response = await fetch(pbUrl);
            }

            if (response.ok) {
                let playlist = await response.json();
                if (playlist.items && Array.isArray(playlist.items) && playlist.items.length > 0) {
                    playlist = playlist.items[0];
                }

                if (!playlist) throw new Error('Playlist not found');

                const title = playlist.name || playlist.title || 'User Playlist';
                let tracks = [];
                try {
                    tracks = Array.isArray(playlist.tracks)
                        ? playlist.tracks
                        : playlist.tracks
                          ? JSON.parse(playlist.tracks)
                          : [];
                } catch (e) {
                    console.error('Failed to parse tracks JSON', e);
                }

                const trackCount = tracks.length;
                const description = `User Playlist • ${trackCount} Tracks\nListen on Monochrome`;

                let imageUrl = 'https://monochrome.samidy.com/assets/appicon.png';
                if (playlist.cover) {
                    if (playlist.cover.startsWith('http')) {
                        imageUrl = playlist.cover;
                    } else {
                        imageUrl = `https://monodb.samidy.com/api/files/${playlist.collectionId}/${playlist.id}/${playlist.cover}`;
                    }
                } else if (
                    tracks.length > 0 &&
                    typeof tracks[0] === 'object' &&
                    tracks[0].album &&
                    tracks[0].album.cover
                ) {
                    const cover = tracks[0].album.cover;
                    imageUrl = `https://resources.tidal.com/images/${cover.replace(/-/g, '/')}/1280x1280.jpg`;
                }

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
