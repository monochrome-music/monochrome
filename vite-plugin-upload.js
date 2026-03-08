import { formidable } from 'formidable';
import fs from 'fs';
import { Blob } from 'buffer';
import { loadEnv } from 'vite';

export default function uploadPlugin() {
    let env = {};

    const handler = async (req, res, next) => {
        if (req.url === '/upload' && req.method === 'POST') {
            const form = formidable({});

            try {
                const [_fields, files] = await form.parse(req);
                const uploadedFile = files.file?.[0];

                if (!uploadedFile) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ success: false, error: 'No file provided' }));
                    return;
                }

                const fileData = fs.readFileSync(uploadedFile.filepath);
                const useR2 = env.R2_ENABLED === 'true';

                let url;

                if (useR2) {
                    // We could implement R2 upload here too, but for simplicity in dev
                    // we'll stick to catbox unless specifically requested to match R2 perfectly.
                    // However, to be helpful, let's at least mention it.
                    console.log('R2 upload detected in env, but dev plugin is using catbox fallback for now.');
                }

                // Forward to catbox.moe (default production behavior when R2 is disabled)
                const formData = new FormData();
                formData.append('reqtype', 'fileupload');
                formData.append(
                    'fileToUpload',
                    new Blob([fileData], { type: uploadedFile.mimetype }),
                    uploadedFile.originalFilename
                );

                const response = await fetch('https://catbox.moe/user/api.php', {
                    method: 'POST',
                    body: formData,
                });

                url = await response.text();

                if (!response.ok) {
                    throw new Error(`Upload failed: ${url}`);
                }

                res.setHeader('Content-Type', 'application/json');
                res.end(
                    JSON.stringify({
                        success: true,
                        url: url.trim(),
                    })
                );
            } catch (err) {
                console.error('Local upload error:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ success: false, error: err.message }));
            }
            return;
        }
        next();
    };

    return {
        name: 'upload-plugin',
        config(_, { mode }) {
            env = loadEnv(mode, process.cwd(), '');
        },
        configureServer(server) {
            server.middlewares.use(handler);
        },
        configurePreviewServer(server) {
            server.middlewares.use(handler);
        },
    };
}
