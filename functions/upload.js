// functions/upload.js
// Handles cover image uploads via imgur.gg API

const API_BASE = 'https://temp.imgur.gg/api/upload';
const PING_URL = 'https://temp.imgur.gg/api/ping';

export async function onRequest(context) {
    const { request } = context;

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': '*',
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

        const maxSize = 10 * 1024 * 1024;

        if (file.size > maxSize) {
            return new Response(
                JSON.stringify({
                    error: 'File size exceeds 10MB limit',
                    size: file.size,
                }),
                {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    },
                }
            );
        }

        const fileBytes = await file.arrayBuffer();

        const pingResponse = await fetch(PING_URL, {
            method: 'GET',
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
        });

        const setCookie = pingResponse.headers.get('set-cookie') || '';
        const sessionCookie = setCookie.split(';').find((c) => c.trim().startsWith('_s=')) || '';

        const metadataPayload = {
            files: [
                {
                    fileName: file.name,
                    fileType: file.type || 'application/octet-stream',
                    fileSize: file.size,
                },
            ],
        };

        const metadataResponse = await fetch(API_BASE, {
            method: 'POST',
            headers: {
                Accept: '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Content-Type': 'application/json',
                Origin: 'https://temp.imgur.gg',
                Pragma: 'no-cache',
                Referer: 'https://temp.imgur.gg/',
                'Sec-Ch-Ua': '"Not A(Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                Cookie: sessionCookie,
            },
            body: JSON.stringify(metadataPayload),
        });

        const metadataText = await metadataResponse.text();

        if (!metadataResponse.ok) {
            throw new Error(`Metadata request failed: ${metadataResponse.status} - ${metadataText}`);
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

        const uploadResponse = await fetch(uploadUrl, {
            method: 'PUT',
            body: fileBytes,
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
            },
        });

        if (!uploadResponse.ok) {
            const uploadText = await uploadResponse.text();
            throw new Error(`File upload failed: ${uploadResponse.status} - ${uploadText}`);
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
