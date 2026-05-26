// functions/user/@[username].js

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export async function onRequest(context) {
    const { request, params, env } = context;
    const userAgent = request.headers.get('User-Agent') || '';
    const isBot =
        /discordbot|twitterbot|facebookexternalhit|bingbot|googlebot|slurp|whatsapp|pinterest|slackbot|telegrambot|linkedinbot|mastodon|signal|snapchat|redditbot|skypeuripreview|viberbot|linebot|embedly|quora|outbrain|tumblr|duckduckbot|yandexbot|rogerbot|showyoubot|kakaotalk|naverbot|seznambot|mediapartners|adsbot|petalbot|applebot|ia_archiver/i.test(
            userAgent
        );
    const username = params.username;

    if (isBot && username) {
        try {
            const AUTH_SERVER_URL = env.AUTH_SERVER_URL;
            if (!AUTH_SERVER_URL) {
                throw new Error('Missing AUTH_SERVER_URL configuration');
            }
            const profileUrl = `${AUTH_SERVER_URL}/api/users/${encodeURIComponent(username)}`;

            const response = await fetch(profileUrl);
            if (!response.ok) throw new Error(`Auth server error: ${response.status}`);

            const profile = await response.json();

            if (profile) {
                const rawDisplayName = profile.display_name || profile.username;
                const displayName = escapeHtml(rawDisplayName);
                const profileUsername = escapeHtml(profile.username);
                const title = `${displayName} (@${profileUsername})`;
                let description = escapeHtml(profile.about || `View ${rawDisplayName}'s profile on Monochrome.`);

                if (profile.status) {
                    try {
                        const statusObj = JSON.parse(profile.status);
                        description = `Listening to: ${escapeHtml(statusObj.text)}\n\n${description}`;
                    } catch {
                        description = `Listening to: ${escapeHtml(profile.status)}\n\n${description}`;
                    }
                }

                const imageUrl = escapeHtml(profile.avatar_url || 'https://monochrome.tf/assets/appicon.png');
                const bannerUrl = escapeHtml(profile.banner_url || '');
                const pageUrl = escapeHtml(new URL(request.url).href);

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
                        <h1>${title}</h1>
                        <p>${description}</p>
                        <img src="${imageUrl}" alt="Profile Avatar">
                        ${bannerUrl ? `<img src="${bannerUrl}" alt="Profile Banner">` : ''}
                    </body>
                    </html>
                `;

                return new Response(metaHtml, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
            }
        } catch (error) {
            console.error(`Error for user profile ${username}:`, error);
        }
    }

    const url = new URL(request.url);
    url.pathname = '/';
    return env.ASSETS.fetch(new Request(url, request));
}
