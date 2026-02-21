// functions/upload.js
// Handles cover image uploads via imgur.gg API

const API_BASE = 'https://temp.imgur.gg/api/upload';

export async function onRequest(context) {
    const { request } = context;

    console.log('Incoming request:', request.method);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        console.log('Handling OPTIONS preflight');

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
        console.log('Method not allowed:', request.method);

        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }

    try {
        console.log('Parsing form data...');
        const formData = await request.formData();
        const file = formData.get('file');

        console.log('File received:', file);

        if (!file) {
            console.error('No file provided');

            return new Response(JSON.stringify({ error: 'No file provided' }), {
                status: 400,
            });
        }

        if (!file.type || !file.type.startsWith('image/')) {
            console.error('Invalid file type:', file?.type);

            return new Response(JSON.stringify({ error: 'File must be an image' }), {
                status: 400,
            });
        }

        const maxSize = 10 * 1024 * 1024;
        console.log('File size:', file.size);

        if (file.size > maxSize) {
            console.error('File too large');

            return new Response(
                JSON.stringify({
                    error: 'File size exceeds 10MB limit',
                    size: file.size,
                }),
                {
                    status: 400,
                }
            );
        }

        const fileBytes = await file.arrayBuffer();
        console.log('File bytes length:', fileBytes.byteLength);

        // -------------------------
        // STEP 1 — Metadata Request
        // -------------------------

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
        console.log('Metadata payload:', JSON.stringify(metadataPayload));

        const metadataResponse = await fetch(API_BASE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0',
                Origin: 'https://your-domain.com',
            },
            body: JSON.stringify(metadataPayload),
        });

        console.log('Metadata status:', metadataResponse.status);

        const metadataText = await metadataResponse.text();
        console.log('Metadata raw response:', metadataText);

        if (!metadataResponse.ok) {
            throw new Error(`Metadata request failed: ${metadataResponse.status} - ${metadataText}`);
        }

        let metadata;
        try {
            metadata = JSON.parse(metadataText);
        } catch (err) {
            console.error('Failed to parse metadata JSON');
            throw new Error('Metadata response not valid JSON');
        }

        console.log('Metadata parsed:', metadata);

        if (!metadata.success || !metadata.files || !metadata.files[0]) {
            throw new Error('Metadata missing required fields');
        }

        const fileInfo = metadata.files[0];
        console.log('File info:', fileInfo);

        const uploadUrl = fileInfo.uploadUrl;

        if (!uploadUrl) {
            throw new Error('No uploadUrl returned from metadata');
        }

        console.log('Upload URL:', uploadUrl);

        // -------------------------
        // STEP 2 — Upload File
        // -------------------------

        console.log('Uploading file...');

        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            body: fileBytes,
            headers: {
                'Content-Type': file.type,
            },
        });

        console.log('Upload status:', uploadResponse.status);

        const uploadText = await uploadResponse.text();
        console.log('Upload raw response:', uploadText);

        if (!uploadResponse.ok) {
            throw new Error(`File upload failed: ${uploadResponse.status} - ${uploadText}`);
        }

        const publicUrl = `https://i.imgur.gg/${fileInfo.fileId}-${fileInfo.fileName}`;

        console.log('Upload successful:', publicUrl);

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
