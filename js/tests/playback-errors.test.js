import { describe, expect, test } from 'vitest';
import { getPlaybackFailureNotificationMessage, isUnsupportedMediaError } from '../playback-errors.js';

describe('playback error classification', () => {
    test('recognizes a rejected play promise for an unsupported source', () => {
        expect(isUnsupportedMediaError(new DOMException('unsupported', 'NotSupportedError'))).toBe(true);
    });

    test('recognizes a native media element error event', () => {
        expect(isUnsupportedMediaError({ target: { error: { code: 4 } } })).toBe(true);
    });

    test('leaves autoplay, abort and unrelated media errors alone', () => {
        expect(isUnsupportedMediaError(new DOMException('blocked', 'NotAllowedError'))).toBe(false);
        expect(isUnsupportedMediaError(new DOMException('aborted', 'AbortError'))).toBe(false);
        expect(isUnsupportedMediaError({ target: { error: { code: 3 } } })).toBe(false);
    });

    test('notifies when a forced fallback resolution fails with a plain error', () => {
        expect(
            getPlaybackFailureNotificationMessage(new Error('Could not resolve stream URL'), {
                forceFallback: true,
            })
        ).toBe('This track could not play in this browser or from the fallback source.');
    });

    test('keeps notifications scoped to fallback and code-specific failures', () => {
        expect(getPlaybackFailureNotificationMessage(new Error('Network failure'))).toBeNull();
        expect(
            getPlaybackFailureNotificationMessage({
                code: 'UNSUPPORTED_PLAYBACK_CODEC',
                message: 'This track uses an unsupported codec.',
            })
        ).toBe('This track uses an unsupported codec.');
    });
});
