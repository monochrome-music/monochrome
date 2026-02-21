const BASE = 'https://temp.imgur.gg';

export async function onRequest(context) {
    const { request } = context;

    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file) {
        return new Response('No file', { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    // 1. GET site to grab cookie
    const getRes = await fetch(BASE, {
        method: 'GET',
    });

    const setCookie = getRes.headers.get('set-cookie') || '';
    const cookie = setCookie.split(';')[0]; // _s=xxxxx

    // 2. Request metadata WITH cookie

    const metadataRes = await fetch(`${BASE}/api/upload`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Cookie: cookie,
            Origin: BASE,
            Referer: BASE + '/',
        },
        body: JSON.stringify({
            files: [
                {
                    fileName: file.name,
                    fileType: file.type,
                    fileSize: file.size,
                },
            ],
        }),
    });

    if (!metadataRes.ok) {
        const text = await metadataRes.text();
        return new Response('Metadata failed: ' + text, { status: 500 });
    }

    const metadata = await metadataRes.json();
    const uploadInfo = metadata.files[0];

    // 3. Upload to signed URL

    const uploadRes = await fetch(uploadInfo.uploadUrl, {
        method: 'PUT',
        headers: {
            'Content-Type': file.type,
        },
        body: buffer,
    });

    if (!uploadRes.ok) {
        return new Response('Upload failed', { status: 500 });
    }

    // 4. Return public URL

    const publicUrl = `https://i.imgur.gg/${uploadInfo.fileId}-${uploadInfo.fileName}`;

    return new Response(
        JSON.stringify({
            success: true,
            url: publicUrl,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        }
    );
}
