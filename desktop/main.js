import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { createServer } from 'net';
import { createServer as createHttpServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB_DIR = app.isPackaged
    ? path.resolve(process.resourcesPath, 'web')
    : path.resolve(__dirname, '..', 'dist');

const MIME_MAP = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.mp3': 'audio/mpeg',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
};

function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

function startServer(port) {
    const server = createHttpServer((req, res) => {
        let urlPath = req.url.split('?')[0].split('#')[0];
        if (urlPath === '/') urlPath = '/index.html';

        const filePath = path.join(WEB_DIR, urlPath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_MAP[ext] || 'application/octet-stream';

        fs.access(filePath, fs.constants.F_OK, (err) => {
            if (err) {
                if (!ext) {
                    const htmlPath = path.join(WEB_DIR, 'index.html');
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    fs.createReadStream(htmlPath).pipe(res);
                    return;
                }
                res.writeHead(404);
                res.end('Not found');
                return;
            }

            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=31536000, immutable',
            });
            fs.createReadStream(filePath).pipe(res);
        });
    });

    return new Promise((resolve, reject) => {
        server.listen(port, '127.0.0.1', () => resolve(server));
        server.on('error', reject);
    });
}

let mainWindow;
let server;

const menuTemplate = [
    {
        label: 'Monochrome',
        submenu: [
            { role: 'about' },
            { type: 'separator' },
            {
                label: 'Preferences',
                accelerator: 'CmdOrCtrl+,',
                click: () => mainWindow?.webContents.send('navigate', '/settings'),
            },
            { type: 'separator' },
            { role: 'quit' },
        ],
    },
    {
        label: 'Edit',
        submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
        ],
    },
    {
        label: 'View',
        submenu: [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
        ],
    },
    {
        label: 'Window',
        submenu: [
            { role: 'minimize' },
            { role: 'close' },
        ],
    },
    {
        label: 'Help',
        submenu: [
            {
                label: 'Monochrome Website',
                click: () => shell.openExternal('https://monochrome.tf'),
            },
            {
                label: 'GitHub',
                click: () => shell.openExternal('https://github.com/monochrome-music/monochrome'),
            },
        ],
    },
];

async function createWindow() {
    const port = await getFreePort();
    server = await startServer(port);

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        title: 'Monochrome',
        icon: path.resolve(__dirname, '..', 'public', 'assets', '256.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webSecurity: true,
        },
        show: false,
        backgroundColor: '#000000',
    });

    mainWindow.loadURL(`http://127.0.0.1:${port}`);

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (server) server.close();
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (server) server.close();
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
