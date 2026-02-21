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
        const contentType = request.headers.get('content-type') || '';
        let file;
        let fileName;
        let fileType;

        if (contentType.includes('application/json')) {
            const body = await request.json();
            if (!body.fileUrl) {
                return new Response(JSON.stringify({ error: 'No fileUrl provided' }), {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    },
                });
            }

            const fileResponse = await fetch(body.fileUrl);
            if (!fileResponse.ok) {
                throw new Error('Failed to fetch remote file');
            }

            const buffer = await fileResponse.arrayBuffer();
            file = buffer;
            fileName = body.fileName || body.fileUrl.split('/').pop() || 'file';
            fileType = fileResponse.headers.get('content-type') || 'application/octet-stream';
        } else {
            const formData = await request.formData();
            const uploadedFile = formData.get('file');

            if (!uploadedFile) {
                return new Response(JSON.stringify({ error: 'No file provided' }), {
                    status: 400,
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                    },
                });
            }

            if (uploadedFile.size > 500 * 1024 * 1024) {
                return new Response(
                    JSON.stringify({
                        error: 'File size exceeds 500MB limit',
                        size: uploadedFile.size,
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

            file = await uploadedFile.arrayBuffer();
            fileName = uploadedFile.name;
            fileType = uploadedFile.type || 'application/octet-stream';
        }

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
                    fileName,
                    fileType,
                    fileSize: file.byteLength || 0,
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

        const metadata = JSON.parse(metadataText);

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
            body: file,
            headers: {
                'Content-Type': fileType,
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
