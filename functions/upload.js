// functions/upload.js
// Handles cover image uploads via imgur.gg API

const API_BASE = 'https://temp.imgur.gg/api/upload';

export async function onRequest(context) {
    const { request } = context;

    console.log('Incoming request:', request.method);

    // -------------------------
    // CORS Preflight
    // -------------------------
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
    }

    if (request.method !== 'POST') {
        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            {
                status: 405,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            }
        );
    }

    try {
        // -------------------------
        // Parse form data
        // -------------------------
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file) {
            return new Response(
                JSON.stringify({ error: 'No file provided' }),
                { status: 400 }
            );
        }

        if (!file.type || !file.type.startsWith('image/')) {
            return new Response(
                JSON.stringify({ error: 'File must be an image' }),
                { status: 400 }
            );
        }

        const maxSize = 10 * 1024 * 1024;

        if (file.size > maxSize) {
            return new Response(
                JSON.stringify({
                    error: 'File size exceeds 10MB limit',
                    size: file.size,
                }),
                { status: 400 }
            );
        }

        const fileBytes = await file.arrayBuffer();

        // -------------------------
        // STEP 1 — Metadata Request
        // -------------------------

        const cookies = request.headers.get('cookie');

        const metadataPayload = {
            files: [
                {
                    fileName: file.name,
                    fileType: file.type,
                    fileSize: file.size,
                },
            ],
        };

        console.log('Sending metadata request...');

        const metadataResponse = await fetch(API_BASE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://temp.imgur.gg/',
                'Origin': 'https://temp.imgur.gg',
                ...(cookies ? { Cookie: cookies } : {}),
            },
            body: JSON.stringify(metadataPayload),
        });

        const metadataText = await metadataResponse.text();

        if (!metadataResponse.ok) {
            throw new Error(
                `Metadata request failed: ${metadataResponse.status} - ${metadataText}`
            );
        }

        let metadata;
        try {
            metadata = JSON.parse(metadataText);
        } catch {
            throw new Error('Metadata response not valid JSON');
        }

        if (!metadata.success || !metadata.files || !metadata.files[0]) {
            throw new Error('Metadata missing required fields');
        }

        const fileInfo = metadata.files[0];
        const uploadUrl = fileInfo.uploadUrl;

        if (!uploadUrl) {
            throw new Error('No uploadUrl returned from metadata');
        }

        // -------------------------
        // STEP 2 — Upload File
        // -------------------------

        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            body: fileBytes,
            headers: {
                'Content-Type': file.type,
            },
        });

        const uploadText = await uploadResponse.text();

        if (!uploadResponse.ok) {
            throw new Error(
                `File upload failed: ${uploadResponse.status} - ${uploadText}`
            );
        }

        const publicUrl = `https://i.imgur.gg/${fileInfo.fileId}-${fileInfo.fileName}`;

        return new Response(
            JSON.stringify({
                success: true,
                url: publicUrl,
                fileId: fileInfo.fileId,
                fileName: fileInfo.fileName,
            }),
            {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            }
        );
    } catch (error) {
        console.error('Upload failed:', error);

        return new Response(
            JSON.stringify({
                error: 'Upload failed',
                message: error.message,
            }),
            {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            }
        );
    }
}
