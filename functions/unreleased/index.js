export async function onRequest(context) {
    const { request, env } = context;
    const pageUrl = request.url;

    const metaHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>Monochrome Music | Unreleased</title>
            <meta name="description" content="Stream unreleased music on Monochrome. Provided by Artistgrid.">
            <meta name="theme-color" content="#000000">

            <meta property="og:site_name" content="Monochrome">
            <meta property="og:title" content="Monochrome Music | Unreleased">
            <meta property="og:description" content="Stream unreleased music on Monochrome. Provided by Artistgrid.">
            <meta property="og:type" content="website">
            <meta property="og:url" content="${pageUrl}">

            <meta name="twitter:card" content="summary">
            <meta name="twitter:title" content="Monochrome Music | Unreleased">
            <meta name="twitter:description" content="Stream unreleased music on Monochrome. Provided by Artistgrid.">
        </head>
        <body>
            <h1>Monochrome Music | Unreleased</h1>
            <p>Stream unreleased music on Monochrome. Provided by Artistgrid.</p>
        </body>
        </html>
    `;

    return new Response(metaHtml, {
        headers: { 'content-type': 'text/html;charset=UTF-8' },
    });
}
