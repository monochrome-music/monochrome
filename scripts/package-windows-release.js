#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');

const distDir = path.join(projectRoot, 'dist', 'Monochrome');
const releaseDir = path.join(projectRoot, 'release', 'windows-x64');

const binarySrc = path.join(distDir, 'Monochrome-win_x64.exe');
const binaryDest = path.join(releaseDir, 'Monochrome.exe');

if (!fs.existsSync(binarySrc)) {
    console.error(`Missing built binary: ${binarySrc}`);
    console.error("Run 'npm run build' first.");
    process.exit(1);
}

fs.rmSync(releaseDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

fs.copyFileSync(path.join(projectRoot, 'neutralino.config.json'), path.join(releaseDir, 'neutralino.config.json'));
fs.copyFileSync(path.join(distDir, 'resources.neu'), path.join(releaseDir, 'resources.neu'));
fs.cpSync(path.join(distDir, 'extensions'), path.join(releaseDir, 'extensions'), { recursive: true });
fs.copyFileSync(binarySrc, binaryDest);

console.log(`Windows release prepared at: ${releaseDir}`);
