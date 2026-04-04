import { AbortError } from './errorTypes';
import { SegmentedDownloadProgress } from './progressEvents';

export interface DashDownloadOptions {
    onProgress?: MonochromeProgressListener<SegmentedDownloadProgress>;
    signal?: AbortSignal;
    calculateDashBytes?: boolean;
}

interface DashSegment {
    number: number;
    time: number;
}

interface DashManifest {
    baseUrl: string;
    initialization: string | null;
    media: string | null;
    segments: DashSegment[];
    repId: string | null;
    mimeType: string | null;
}

export class DashDownloader {
    constructor() {}

    async getTotalSize(urls: string[], signal?: AbortSignal): Promise<number | undefined> {
        try {
            let totalSize = 0;

            await Promise.all(
                urls.map(async (url) => {
                    const result = await fetch(url, { method: 'HEAD', signal });

                    if (result.ok) {
                        const contentLength = result.headers.get('Content-Length');
                        if (contentLength) totalSize += parseInt(contentLength, 10);
                    } else {
                        throw new Error(`Failed to fetch segment HEAD: ${result.status}`);
                    }
                })
            );

            return totalSize;
        } catch {
            return undefined;
        }
    }

    async downloadDashStream(manifestBlobUrl: string, options: DashDownloadOptions = {}): Promise<Blob> {
        const { onProgress, signal, calculateDashBytes = true } = options;

        // 1. Fetch and Parse Manifest
        const response = await fetch(manifestBlobUrl);
        const manifestText = await response.text();

        const manifest = this.parseManifest(manifestText);
        if (!manifest) {
            throw new Error('Failed to parse DASH manifest');
        }

        // 2. Generate URLs
        const urls = this.generateSegmentUrls(manifest);
        const mimeType = manifest.mimeType || 'audio/mp4';

        // 3. Download Segments
        const chunks: ArrayBuffer[] = [];
        let downloadedBytes = 0;

        const totalSegments = urls.length;
        const totalSize = calculateDashBytes ? await this.getTotalSize(urls, signal) : undefined;

        for (let i = 0; i < urls.length; i++) {
            if (signal?.aborted) throw new AbortError();

            onProgress?.(new SegmentedDownloadProgress(downloadedBytes, totalSize ?? undefined, i, totalSegments));

            const url = urls[i];
            const segmentResponse = await fetch(url, { signal });

            if (!segmentResponse.ok) {
                console.warn(`Failed to fetch segment ${i}, retrying...`);
                await new Promise((r) => setTimeout(r, 1000));

                const retryResponse = await fetch(url, { signal });

                if (!retryResponse.ok) {
                    throw new Error(`Failed to fetch segment ${i}: ${retryResponse.status}`);
                }

                const chunk = await retryResponse.arrayBuffer();
                chunks.push(chunk);
                downloadedBytes += chunk.byteLength;
            } else {
                const chunk = await segmentResponse.arrayBuffer();
                chunks.push(chunk);
                downloadedBytes += chunk.byteLength;
            }

            onProgress?.(new SegmentedDownloadProgress(downloadedBytes, totalSize ?? undefined, i + 1, totalSegments));
        }

        // 4. Concatenate
        return new Blob(chunks, { type: mimeType });
    }

    parseManifest(manifestText: string): DashManifest {
        const parser = new DOMParser();
        const xml = parser.parseFromString(manifestText, 'text/xml');

        const mpd = xml.querySelector('MPD');
        if (!mpd) throw new Error('Invalid DASH manifest: No MPD tag');

        const period = mpd.querySelector('Period');
        if (!period) throw new Error('Invalid DASH manifest: No Period tag');

        const adaptationSets = Array.from(period.querySelectorAll('AdaptationSet'));

        adaptationSets.sort((a, b) => {
            const getMaxBandwidth = (set: Element) => {
                const reps = Array.from(set.querySelectorAll('Representation'));
                return reps.length ? Math.max(...reps.map((r) => parseInt(r.getAttribute('bandwidth') || '0', 10))) : 0;
            };

            return getMaxBandwidth(b) - getMaxBandwidth(a);
        });

        let audioSet = adaptationSets.find((as) => as.getAttribute('mimeType')?.startsWith('audio')) ?? null;

        if (!audioSet && adaptationSets.length > 0) audioSet = adaptationSets[0];
        if (!audioSet) throw new Error('No AdaptationSet found');

        const representations = Array.from(audioSet.querySelectorAll('Representation')).sort((a, b) => {
            const bwA = parseInt(a.getAttribute('bandwidth') || '0');
            const bwB = parseInt(b.getAttribute('bandwidth') || '0');
            return bwB - bwA;
        });

        if (representations.length === 0) throw new Error('No Representation found');

        const rep = representations[0];
        const repId = rep.getAttribute('id');

        const segmentTemplate = rep.querySelector('SegmentTemplate') || audioSet.querySelector('SegmentTemplate');

        if (!segmentTemplate) throw new Error('No SegmentTemplate found');

        const initialization = segmentTemplate.getAttribute('initialization');
        const media = segmentTemplate.getAttribute('media');
        const startNumber = parseInt(segmentTemplate.getAttribute('startNumber') || '1', 10);

        const baseUrlTag =
            rep.querySelector('BaseURL') ||
            audioSet.querySelector('BaseURL') ||
            period.querySelector('BaseURL') ||
            mpd.querySelector('BaseURL');

        const baseUrl = baseUrlTag?.textContent?.trim() || '';

        const segmentTimeline = segmentTemplate.querySelector('SegmentTimeline');
        const segments: DashSegment[] = [];

        if (segmentTimeline) {
            const sElements = segmentTimeline.querySelectorAll('S');

            let currentTime = 0;
            let currentNumber = startNumber;

            sElements.forEach((s) => {
                const tAttr = s.getAttribute('t');
                if (tAttr) currentTime = parseInt(tAttr, 10);

                const d = parseInt(s.getAttribute('d') || '0', 10);
                const r = parseInt(s.getAttribute('r') || '0', 10);

                segments.push({ number: currentNumber, time: currentTime });

                currentTime += d;
                currentNumber++;

                for (let i = 0; i < r; i++) {
                    segments.push({ number: currentNumber, time: currentTime });
                    currentTime += d;
                    currentNumber++;
                }
            });
        }

        return {
            baseUrl,
            initialization,
            media,
            segments,
            repId,
            mimeType: audioSet.getAttribute('mimeType'),
        };
    }

    generateSegmentUrls(manifest: DashManifest): string[] {
        const { baseUrl, initialization, media, segments, repId } = manifest;

        const urls: string[] = [];

        const resolveTemplate = (template: string, number: number, time: number): string => {
            return template
                .replace(/\$RepresentationID\$/g, repId ?? '')
                .replace(/\$Number(?:%0([0-9]+)d)?\$/g, (_, width: string) => {
                    if (width) {
                        return number.toString().padStart(parseInt(width), '0');
                    }
                    return number.toString();
                })
                .replace(/\$Time(?:%0([0-9]+)d)?\$/g, (_, width: string) => {
                    if (width) {
                        return time.toString().padStart(parseInt(width), '0');
                    }
                    return time.toString();
                });
        };

        const joinPath = (base: string, part: string): string => {
            if (!base) return part;
            if (part.startsWith('http')) return part;
            return base.endsWith('/') ? base + part : base + '/' + part;
        };

        if (initialization) {
            const initPath = resolveTemplate(initialization, 0, 0);
            urls.push(joinPath(baseUrl, initPath));
        }

        if (media && segments.length > 0) {
            segments.forEach((seg) => {
                const path = resolveTemplate(media, seg.number, seg.time);
                urls.push(joinPath(baseUrl, path));
            });
        }

        return urls;
    }
}
