import { expect, test } from 'vitest';
import { ffmpeg } from './ffmpeg';

test('Run `ffmpeg --help`', async () => {
    const lines: string[] = [];
    await ffmpeg(null, {
        rawArgs: ['--help'],
        logConsole: false,
        outputName: null,
        onProgress: (progress) => {
            if (progress.stage == 'stdout') {
                lines.push(progress.message);
            }
        },
    });

    expect(lines).length.greaterThan(0);
    expect(lines[0]).matches(/ffmpeg version/i);
});
