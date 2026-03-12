import { SegmentedDownloadProgress } from './progressEvents';

export class HlsDownloader {
    constructor() {}

    async downloadHlsStream(masterUrl, options = {}) {
        const { onProgress, signal } = options;

        const response = await fetch(masterUrl, { signal });
        const masterText = await response.text();

        const variantUrl = this.getBestVariantUrl(masterUrl, masterText);

        const mediaResponse = await fetch(variantUrl, { signal });
        const mediaText = await mediaResponse.text();

        const segments = this.parseMediaPlaylist(variantUrl, mediaText);
        if (segments.length === 0) {
            throw new Error('No segments found in HLS playlist');
        }

        const chunks = [];
        let downloadedBytes = 0;
        const totalSegments = segments.length;

        for (let i = 0; i < totalSegments; i++) {
            if (signal?.aborted) throw new Error('AbortError');

            onProgress?.(new SegmentedDownloadProgress(downloadedBytes, undefined, i, totalSegments));

            const segmentUrl = segments[i];
            const segmentResponse = await fetch(segmentUrl, { signal });

            if (!segmentResponse.ok) {
                throw new Error(`Failed to fetch segment ${i}: ${segmentResponse.status}`);
            }

            const chunk = await segmentResponse.arrayBuffer();
            chunks.push(chunk);
            downloadedBytes += chunk.byteLength;

            onProgress?.(new SegmentedDownloadProgress(downloadedBytes, undefined, i + 1, totalSegments));
        }

        const mimeType = segments[0].endsWith('.m4s') || segments[0].includes('mp4') ? 'video/mp4' : 'video/mp2t';
        return new Blob(chunks, { type: mimeType });
    }

    getBestVariantUrl(masterUrl, masterText) {
        if (!masterText.includes('#EXT-X-STREAM-INF')) {
            return masterUrl;
        }

        const lines = masterText.split('\n');
        const variants = [];
        let currentVariant = null;

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
                const bandwidthMatch = trimmed.match(/BANDWIDTH=(\d+)/);
                const resolutionMatch = trimmed.match(/RESOLUTION=(\d+x\d+)/);
                currentVariant = {
                    bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0,
                    resolution: resolutionMatch ? resolutionMatch[1] : 'unknown',
                };
            } else if (trimmed && !trimmed.startsWith('#')) {
                if (currentVariant) {
                    currentVariant.url = this.resolveUrl(masterUrl, trimmed);
                    variants.push(currentVariant);
                    currentVariant = null;
                }
            }
        }

        if (variants.length === 0) return masterUrl;

        variants.sort((a, b) => b.bandwidth - a.bandwidth);
        return variants[0].url;
    }

    parseMediaPlaylist(mediaUrl, mediaText) {
        const lines = mediaText.split('\n');
        const segments = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                segments.push(this.resolveUrl(mediaUrl, trimmed));
            }
        }

        return segments;
    }

    resolveUrl(baseUrl, relativeUrl) {
        try {
            return new URL(relativeUrl, baseUrl).href;
        } catch {
            return relativeUrl;
        }
    }
}
