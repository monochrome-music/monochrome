import { expect, test, describe } from 'vitest';
import { LyricsManager } from '../lyrics.js';

const manager = new LyricsManager(null);
const track = { id: 't1', title: 'Duet Song', artist: { name: 'Singer' }, album: { title: 'Album' } };

describe('generateTTMLContent', () => {
    test('returns null without synced subtitles', () => {
        expect(manager.generateTTMLContent(null, track)).toBeNull();
        expect(manager.generateTTMLContent({}, track)).toBeNull();
        expect(manager.generateTTMLContent({ subtitles: '' }, track)).toBeNull();
    });

    test('emits ttm:agent attributes for V1:/V2: prefixes and declares them', () => {
        const subtitles = '[00:01.00] V1: Hello\n[00:05.00] V2: World\n[00:09.00] Both together';
        const ttml = manager.generateTTMLContent({ subtitles }, track);
        expect(ttml).toContain('xmlns="http://www.w3.org/ns/ttml"');
        expect(ttml).toContain('xmlns:ttm="http://www.w3.org/ns/ttml#metadata"');
        expect(ttml).toContain('<ttm:agent type="person" xml:id="v1"/>');
        expect(ttml).toContain('<ttm:agent type="person" xml:id="v2"/>');
        expect(ttml).toContain('<p begin="00:00:01.000" end="00:00:05.000" ttm:agent="v1">Hello</p>');
        expect(ttml).toContain('<p begin="00:00:05.000" end="00:00:09.000" ttm:agent="v2">World</p>');
        expect(ttml).toContain('>Both together</p>');
        expect(ttml).not.toContain('V1:');
    });

    test('escapes XML special chars', () => {
        const subtitles = '[00:01.00] Rock & Roll <forever>';
        const ttml = manager.generateTTMLContent({ subtitles }, track);
        expect(ttml).toContain('Rock &amp; Roll &lt;forever&gt;');
    });
});

describe('formatTTMLTime', () => {
    test('formats clock times', () => {
        expect(manager.formatTTMLTime(0)).toBe('00:00:00.000');
        expect(manager.formatTTMLTime(61.5)).toBe('00:01:01.500');
        expect(manager.formatTTMLTime(3723.25)).toBe('01:02:03.250');
    });
});

describe('getTTML', () => {
    test('returns a .ttml File', () => {
        const subtitles = '[00:01.00] V1: Hello';
        const file = manager.getTTML({ subtitles }, track);
        expect(file).toBeInstanceOf(File);
        expect(file.name.endsWith('.ttml')).toBe(true);
    });

    test('returns undefined without subtitles', () => {
        expect(manager.getTTML(null, track)).toBeUndefined();
    });
});
