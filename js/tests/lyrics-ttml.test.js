import { expect, test, describe } from 'vitest';
import { LyricsManager } from '../lyrics.js';
import { nativeTTML, lyricsTrack as track } from './ttml-fixture.js';

const manager = new LyricsManager(null);

describe('native TTML export', () => {
    test('never fabricates TTML from LRC lines', () => {
        expect(manager.generateTTMLContent(null, track)).toBeNull();
        expect(manager.generateTTMLContent({ subtitles: '[00:01.00] V1: Hello' }, track)).toBeNull();
        expect(manager.getTTML({ subtitles: '[00:01.00] Hello' }, track)).toBeUndefined();
    });
    test('preserves word times, agents, language, entities and whitespace verbatim', async () => {
        expect(manager.generateTTMLContent({ originalTTML: nativeTTML }, track)).toBe(nativeTTML);
        const file = manager.getTTML({ originalTTML: nativeTTML }, track);
        expect(file).toBeInstanceOf(File);
        expect(file.name.endsWith('.ttml')).toBe(true);
        expect(await file.text()).toBe(nativeTTML);
    });
    test('rejects malformed XML, DTDs and non-TTML documents', () => {
        for (const xml of [
            '<tt>',
            '<html>lyrics</html>',
            '<!DOCTYPE tt>' + nativeTTML,
            '<tt xmlns="wrong"><body/></tt>',
        ]) {
            expect(manager.generateTTMLContent({ originalTTML: xml }, track)).toBeNull();
        }
    });
    test('retains existing LRC export', async () => {
        const lyrics = { subtitles: '[00:01.00] Hello', lyricsProvider: 'LRCLIB' };
        const file = manager.getLRC(lyrics, track);
        expect(file.name.endsWith('.lrc')).toBe(true);
        expect(await file.text()).toContain('[by:LRCLIB]\n\n[00:01.00] Hello');
    });
});
