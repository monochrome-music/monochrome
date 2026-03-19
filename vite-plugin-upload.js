import { formidable } from 'formidable';
import fs from 'fs';
import path from 'path';
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
                } else if (uploadedFile.size > 1024 * 1024 * 10) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ success: false, error: 'File too large' }));
                    return;
                }

                const uploadFolder = path.join(process.cwd(), 'public', 'uploads');
                if (!fs.existsSync(uploadFolder)) {
                    fs.mkdirSync(uploadFolder, { recursive: true });
                }

                const ext = path.extname(uploadedFile.originalFilename || '');
                const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
                const destPath = path.join(uploadFolder, filename);

                fs.copyFileSync(uploadedFile.filepath, destPath);

                let url = `http://${req.headers.host}/uploads/${filename}`;

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
