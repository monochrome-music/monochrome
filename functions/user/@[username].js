// functions/user/@[username].js

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
            const POCKETBASE_URL = 'https://data.samidy.xyz';
            const filter = `username="${username}"`;
            const profileUrl = `${POCKETBASE_URL}/api/collections/DB_users/records?filter=${encodeURIComponent(filter)}&fields=username,display_name,avatar_url,banner,about,status`;

            const response = await fetch(profileUrl);
            if (!response.ok) throw new Error(`PocketBase error: ${response.status}`);

            const data = await response.json();
            const profile = data.items && data.items.length > 0 ? data.items[0] : null;

            if (profile) {
                const displayName = profile.display_name || profile.username;
                const title = `${displayName} (@${profile.username})`;
                let description = profile.about || `View ${displayName}'s profile on Monochrome.`;

                if (profile.status) {
                    try {
                        const statusObj = JSON.parse(profile.status);
                        description = `Listening to: ${statusObj.text}\n\n${description}`;
                    } catch {
                        description = `Listening to: ${profile.status}\n\n${description}`;
                    }
                }

                const imageUrl = profile.avatar_url || 'https://monochrome.tf/assets/appicon.png';
                const bannerUrl = profile.banner || '';
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
