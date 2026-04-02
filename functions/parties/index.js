export async function onRequest(context) {
    const { request, env } = context;
    const pageUrl = request.url;

    const metaHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Monochrome Music | Listening Parties</title>
            <meta name="description" content="Listen to music with your friends">
            <meta name="theme-color" content="#000000">

            <meta property="og:site_name" content="Monochrome">
            <meta property="og:title" content="Monochrome Music | Listening Parties">
            <meta property="og:description" content="Listen to music with your friends">
            <meta property="og:type" content="website">
            <meta property="og:url" content="${pageUrl}">

            <meta name="twitter:card" content="summary">
            <meta name="twitter:title" content="Monochrome Music | Listening Parties">
            <meta name="twitter:description" content="Listen to music with your friends">
        </head>
        <body>
            <h1>Monochrome Music | Listening Parties</h1>
            <p>Listen to music with your friends</p>
        </body>
        </html>
    `;

    return new Response(metaHtml, {
        headers: { 'content-type': 'text/html;charset=UTF-8' },
    });
}
