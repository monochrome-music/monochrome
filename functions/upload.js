// functions/upload.js
// Handles cover image uploads via imgur.gg API

const API_BASE = 'https://temp.imgur.gg/api/upload';

export async function onRequest(context) {
    const { request } = context;

    // Handle CORS preflight
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
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }

    try {
        // Parse the multipart form data
        const formData = await request.formData();
        const file = formData.get('file');

        if (!file) {
            return new Response(JSON.stringify({ error: 'No file provided' }), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            });
        }

        // Validate file type
        if (!file.type.startsWith('image/')) {
            return new Response(JSON.stringify({ error: 'File must be an image' }), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            });
        }

        // Validate file size (max 10MB)
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
            return new Response(JSON.stringify({ error: 'File size exceeds 10MB limit' }), {
                status: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            });
        }

        // Get file bytes
        const fileBytes = await file.arrayBuffer();

        // Step 1: Request upload metadata
        const metadataPayload = {
            files: [
                {
                    fileName: file.name,
                    fileType: file.type,
                    fileSize: file.size,
                },
            ],
        };

        const metadataResponse = await fetch(API_BASE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(metadataPayload),
        });

        if (!metadataResponse.ok) {
            throw new Error(`Metadata request failed: ${metadataResponse.status}`);
        }

        const metadata = await metadataResponse.json();

        if (!metadata.success || !metadata.files || !metadata.files[0]) {
            throw new Error('Failed to get upload URL from imgur.gg');
        }

        const fileInfo = metadata.files[0];
        const uploadUrl = fileInfo.uploadUrl;

        // Step 2: Upload the file
        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            body: fileBytes,
            headers: {
                'Content-Type': file.type,
            },
        });

        if (!uploadResponse.ok) {
            throw new Error(`File upload failed: ${uploadResponse.status}`);
        }

        // Step 3: Return the public URL
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
        console.error('Upload error:', error);
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
