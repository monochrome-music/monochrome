const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;
const PLAYBACK_FALLBACK_ERROR_MESSAGE = 'This track could not play in this browser or from the fallback source.';
const CODE_SPECIFIC_PLAYBACK_ERRORS = new Set(['UNSUPPORTED_PLAYBACK_CODEC', 'STRICT_QUALITY_UNAVAILABLE']);

export function isUnsupportedMediaError(error) {
    return (
        error?.name === 'NotSupportedError' ||
        error?.error?.code === MEDIA_ERR_SRC_NOT_SUPPORTED ||
        error?.target?.error?.code === MEDIA_ERR_SRC_NOT_SUPPORTED
    );
}

export function getPlaybackFailureNotificationMessage(error, { forceFallback = false } = {}) {
    if (CODE_SPECIFIC_PLAYBACK_ERRORS.has(error?.code)) {
        return error.message;
    }

    if (forceFallback || isUnsupportedMediaError(error)) {
        return PLAYBACK_FALLBACK_ERROR_MESSAGE;
    }

    return null;
}
