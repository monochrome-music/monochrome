#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packageTasks = ['package:linux', 'package:mac', 'package:windows'];

for (const task of packageTasks) {
    console.log(`\n[package-all] Running ${task}...`);
    const result = spawnSync(npmCommand, ['run', task], {
        stdio: 'inherit',
        env: process.env,
    });

    if (result.status !== 0) {
        const exitCode = typeof result.status === 'number' ? result.status : 1;
        process.exit(exitCode);
    }
}

console.log('\n[package-all] All platform packages generated successfully.');
