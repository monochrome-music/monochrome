export async function onRequest(context) {
    const { request, env } = context;
    const pageUrl = request.url;

    const metaHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Monochrome Music | Settings</title>
            <meta name="description" content="A minimalist music streaming application">
            <meta name="theme-color" content="#000000">

            <meta property="og:site_name" content="Monochrome">
            <meta property="og:title" content="Monochrome Music | Settings">
            <meta property="og:description" content="A minimalist music streaming application">
            <meta property="og:type" content="website">
            <meta property="og:url" content="${pageUrl}">

            <meta name="twitter:card" content="summary">
            <meta name="twitter:title" content="Monochrome Music | Settings">
            <meta name="twitter:description" content="A minimalist music streaming application">
        </head>
        <body>
            <h1>Monochrome Music | Settings</h1>
            <p>A minimalist music streaming application</p>
        </body>
        </html>
    `;

    return new Response(metaHtml, {
        headers: { 'content-type': 'text/html;charset=UTF-8' },
    });
}
