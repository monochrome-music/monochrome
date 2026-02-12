import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';

const CONFIG_FILE = 'neutralino.config.json';
const DEV_CONFIG_FILE = 'neutralino.config.dev.json';
const BACKUP_CONFIG_FILE = 'neutralino.config.prod.bak';

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

// Ensure we clean up on exit
process.on('SIGINT', () => {
    restoreConfig();
    process.exit();
});

process.on('exit', () => {
    restoreConfig();
});

async function run() {
    if (!fs.existsSync(DEV_CONFIG_FILE)) {
        console.error('Error: neutralino.config.dev.json not found.');
        process.exit(1);
    }

    try {
        // Backup production config
        if (fs.existsSync(CONFIG_FILE)) {
            fs.renameSync(CONFIG_FILE, BACKUP_CONFIG_FILE);
        }

        // Copy dev config to main
        fs.copyFileSync(DEV_CONFIG_FILE, CONFIG_FILE);
        console.log('Switched to development configuration.');

        // Run neu
        const neu = spawn('npx', ['neu', 'run'], { stdio: 'inherit', shell: true });

        neu.on('close', (code) => {
            console.log(`Neutralino process exited with code ${code}`);
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
