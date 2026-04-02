export async function onRequest(context) {
    const { request, env } = context;
    const pageUrl = request.url;

    const metaHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Monochrome Music | About</title>
            <meta name="description" content="A minimalist music streaming application">
            <meta name="theme-color" content="#000000">

            <meta property="og:site_name" content="Monochrome">
            <meta property="og:title" content="Monochrome Music | About">
            <meta property="og:description" content="A minimalist music streaming application">
            <meta property="og:image" content="https://monochrome.tf/assets/appicon.png">
            <meta property="og:type" content="website">
            <meta property="og:url" content="${pageUrl}">

            <meta name="twitter:card" content="summary_large_image">
            <meta name="twitter:title" content="Monochrome Music | About">
            <meta name="twitter:description" content="A minimalist music streaming application">
            <meta name="twitter:image" content="https://monochrome.tf/assets/appicon.png">
        </head>
        <body>
            <h1>Monochrome Music | About</h1>
            <p>A minimalist music streaming application</p>
        </body>
        </html>
    `;

    return new Response(metaHtml, {
        headers: { 'content-type': 'text/html;charset=UTF-8' },
    });
}
