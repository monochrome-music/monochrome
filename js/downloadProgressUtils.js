/**
 * Helpers for download progress. Extracted for testability (fixes #278).
 * Resolve total byte count from GET and optional HEAD Content-Length.
 */

/**
 * @param {string | null} contentLengthFromGet - Content-Length header from GET response
 * @param {number | null} headContentLength - Content-Length from prior HEAD request
 * @returns {number}
 */
export function resolveDownloadTotalBytes(contentLengthFromGet, headContentLength) {
    const fromGet = contentLengthFromGet ? parseInt(contentLengthFromGet, 10) : null;
    return fromGet ?? headContentLength ?? 0;
}
