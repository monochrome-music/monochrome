import fs from 'fs';
import { spawn, execSync } from 'child_process';

const CONFIG_FILE = 'neutralino.config.json';
const DEV_CONFIG_FILE = 'neutralino.config.dev.json';
const BACKUP_CONFIG_FILE = 'neutralino.config.prod.bak';
let viteProcess = null;
let neuProcess = null;

function restoreConfig() {
    if (fs.existsSync(BACKUP_CONFIG_FILE)) {
        try {
            // If the current config is the dev one (we can check via content or assume), remove it
            if (fs.existsSync(CONFIG_FILE)) {
                fs.unlinkSync(CONFIG_FILE);
            }
            fs.renameSync(BACKUP_CONFIG_FILE, CONFIG_FILE);
            console.log('Restored production configuration.');
        } catch (e) {
            console.error('Failed to restore configuration:', e);
        }
    }
}

function stopChildProcesses() {
    if (neuProcess && !neuProcess.killed) {
        neuProcess.kill('SIGTERM');
    }
    if (viteProcess && !viteProcess.killed) {
        viteProcess.kill('SIGTERM');
    }
}

function isWaylandSession(env) {
    const sessionType = (env.XDG_SESSION_TYPE || '').toLowerCase();
    return sessionType === 'wayland' || Boolean(env.WAYLAND_DISPLAY);
}

function applyLinuxWebKitEnv(env) {
    if (process.platform !== 'linux') {
        return;
    }

    if (!env.GDK_BACKEND) {
        env.GDK_BACKEND = isWaylandSession(env) ? 'wayland' : 'x11';
    }

    const backendPrefersWayland = env.GDK_BACKEND.split(',')
        .map((value) => value.trim())
        .includes('wayland');

    const hasNvidiaDriver = fs.existsSync('/proc/driver/nvidia/version');

    if (backendPrefersWayland) {
        if (!env.WEBKIT_DISABLE_DMABUF_RENDERER) {
            env.WEBKIT_DISABLE_DMABUF_RENDERER = '1';
        }
        if (hasNvidiaDriver && !env.__NV_DISABLE_EXPLICIT_SYNC) {
            env.__NV_DISABLE_EXPLICIT_SYNC = '1';
        }
        return;
    }

    if (!env.WEBKIT_DISABLE_DMABUF_RENDERER) {
        env.WEBKIT_DISABLE_DMABUF_RENDERER = '1';
    }
    if (!env.WEBKIT_DISABLE_COMPOSITING_MODE) {
        env.WEBKIT_DISABLE_COMPOSITING_MODE = '1';
    }
}

// Ensure we clean up on exit
process.on('SIGINT', () => {
    stopChildProcesses();
    restoreConfig();
    process.exit(130);
});

process.on('SIGTERM', () => {
    stopChildProcesses();
    restoreConfig();
    process.exit(143);
});

process.on('exit', () => {
    stopChildProcesses();
    restoreConfig();
});

function startVite(env) {
    return new Promise((resolve, reject) => {
        let resolved = false;
        let timeoutId = null;
        let detectedPort = '5173';

        viteProcess = spawn('npx vite --host 127.0.0.1 --port 5173', {
            shell: true,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const processOutput = (chunk, writer) => {
            const text = chunk.toString();
            writer(text);
            const match = text.match(/Local:\s+http:\/\/localhost:(\d+)\//);
            if (match && match[1]) {
                detectedPort = match[1];
            }
            if (!resolved && text.includes('ready in')) {
                resolved = true;
                clearTimeout(timeoutId);
                resolve(detectedPort);
            }
        };

        viteProcess.stdout.on('data', (chunk) => processOutput(chunk, (text) => process.stdout.write(text)));
        viteProcess.stderr.on('data', (chunk) => processOutput(chunk, (text) => process.stderr.write(text)));

        viteProcess.on('error', (error) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeoutId);
                reject(error);
            }
        });

        viteProcess.on('close', (code) => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeoutId);
                reject(new Error(`Vite exited early with code ${code}`));
            }
        });

        timeoutId = setTimeout(() => {
            if (resolved) {
                return;
            }
            resolved = true;
            reject(new Error('Timed out waiting for Vite dev server startup'));
        }, 30000);
    });
}

async function run() {
    if (!fs.existsSync(DEV_CONFIG_FILE)) {
        console.error('Error: neutralino.config.dev.json not found.');
        process.exit(1);
    }

    // Download Neutralino binaries if missing
    const isWindows = process.platform === 'win32';
    const binaryName = isWindows
        ? 'bin/neutralino-win_x64.exe'
        : `bin/neutralino-${process.platform === 'darwin' ? 'mac_' : 'linux_'}x64`;
    if (!fs.existsSync(binaryName)) {
        console.log('Neutralino binaries not found. Running neu update...');
        execSync('npx neu update', { stdio: 'inherit' });
    }

    try {
        // Backup production config
        if (fs.existsSync(CONFIG_FILE)) {
            fs.renameSync(CONFIG_FILE, BACKUP_CONFIG_FILE);
        }

        // Copy dev config to main
        fs.copyFileSync(DEV_CONFIG_FILE, CONFIG_FILE);
        console.log('Switched to development configuration.');

        const env = { ...process.env };
        const vitePort = await startVite(env);
        applyLinuxWebKitEnv(env);
        env.MONOCHROME_DEV_PORT = vitePort;

        neuProcess = spawn(`npx neu run -- --mono-dev-port=${vitePort}`, {
            stdio: 'inherit',
            shell: true,
            env,
        });

        neuProcess.on('close', (code) => {
            console.log(`Neutralino process exited with code ${code}`);
            stopChildProcesses();
            restoreConfig();
            process.exit(code);
        });
    } catch (e) {
        console.error('Error running dev environment:', e);
        restoreConfig();
        process.exit(1);
    }
}

run();
