/**
 * Build script for the Monochrome Capacitor shell.
 *
 * Since the app loads the live website via server.url, the www/ directory
 * only needs the minimal shell (index.html + capacitor-bridge.js).
 * This script ensures the www directory is ready for cap sync.
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const wwwDir = join(projectRoot, 'www');

// Ensure www directory exists
if (!existsSync(wwwDir)) {
  mkdirSync(wwwDir, { recursive: true });
}

// Verify required files exist
const requiredFiles = ['index.html', 'capacitor-bridge.js'];
for (const file of requiredFiles) {
  const filePath = join(wwwDir, file);
  if (!existsSync(filePath)) {
    console.error(`Missing required file: www/${file}`);
    process.exit(1);
  }
}

console.log('Web shell ready:');
readdirSync(wwwDir).forEach((f) => console.log(`  www/${f}`));
console.log('\nRun "npx cap sync" to sync native projects.');
