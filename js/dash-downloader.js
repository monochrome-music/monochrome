export class DashDownloader {
    constructor() {}

    async downloadDashStream(manifestBlobUrl, options = {}) {
        const { onProgress, signal } = options;

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
        const chunks = [];
        let downloadedBytes = 0;
        // Estimate total size? Hard to know exactly without Content-Length of each.
        // We can just track progress by segment count.
        const totalSegments = urls.length;

        for (let i = 0; i < urls.length; i++) {
            if (signal?.aborted) throw new Error('AbortError');

            const url = urls[i];
            const segmentResponse = await fetch(url, { signal });

            if (!segmentResponse.ok) {
                // Retry once?
                console.warn(`Failed to fetch segment ${i}, retrying...`);
                await new Promise((r) => setTimeout(r, 1000));
                const retryResponse = await fetch(url, { signal });
                if (!retryResponse.ok) throw new Error(`Failed to fetch segment ${i}: ${retryResponse.status}`);
                const chunk = await retryResponse.arrayBuffer();
                chunks.push(chunk);
                downloadedBytes += chunk.byteLength;
            } else {
                const chunk = await segmentResponse.arrayBuffer();
                chunks.push(chunk);
                downloadedBytes += chunk.byteLength;
            }

            if (onProgress) {
                onProgress({
                    stage: 'downloading',
                    receivedBytes: downloadedBytes, // accurate byte count
                    totalBytes: undefined, // Unknown total
                    currentSegment: i + 1,
                    totalSegments: totalSegments,
                });
            }
        }

        // 4. Concatenate
        return new Blob(chunks, { type: mimeType });
    }

    parseManifest(manifestText) {
        const parser = new DOMParser();
        const xml = parser.parseFromString(manifestText, 'text/xml');

        const mpd = xml.querySelector('MPD');
        if (!mpd) throw new Error('Invalid DASH manifest: No MPD tag');

        const period = mpd.querySelector('Period');
        if (!period) throw new Error('Invalid DASH manifest: No Period tag');

        // Prefer highest bandwidth audio adaptation set
        const adaptationSets = Array.from(period.querySelectorAll('AdaptationSet'));

        adaptationSets.sort((a, b) => {
            const getMaxBandwidth = (set) => {
                const reps = Array.from(set.querySelectorAll('Representation'));
                return reps.length ? Math.max(...reps.map((r) => parseInt(r.getAttribute('bandwidth') || '0', 10))) : 0;
            };
            return getMaxBandwidth(b) - getMaxBandwidth(a);
        });

        let audioSet = adaptationSets.find((as) => as.getAttribute('mimeType')?.startsWith('audio'));

        // Fallback: look for any adaptation set if mimeType is missing (rare)
        if (!audioSet && adaptationSets.length > 0) audioSet = adaptationSets[0];
        if (!audioSet) throw new Error('No AdaptationSet found');

        // Find Representation
        // Get all representations and sort by bandwidth descending
        const representations = Array.from(audioSet.querySelectorAll('Representation')).sort((a, b) => {
            const bwA = parseInt(a.getAttribute('bandwidth') || '0');
            const bwB = parseInt(b.getAttribute('bandwidth') || '0');
            return bwB - bwA;
        });

        if (representations.length === 0) throw new Error('No Representation found');
        const rep = representations[0];
        const repId = rep.getAttribute('id');

        // Find SegmentTemplate
        // Can be in Representation or AdaptationSet
        const segmentTemplate = rep.querySelector('SegmentTemplate') || audioSet.querySelector('SegmentTemplate');
        if (!segmentTemplate) throw new Error('No SegmentTemplate found');

        const initialization = segmentTemplate.getAttribute('initialization');
        const media = segmentTemplate.getAttribute('media');
        const startNumber = parseInt(segmentTemplate.getAttribute('startNumber') || '1', 10);

        // BaseURL
        // Can be at MPD, Period, AdaptationSet, or Representation level.
        // We strictly need to find the "deepest" one or combine them?
        // Usually simpler manifests have it at one level.
        // Let's resolve closest BaseURL.
        const baseUrlTag =
            rep.querySelector('BaseURL') ||
            audioSet.querySelector('BaseURL') ||
            period.querySelector('BaseURL') ||
            mpd.querySelector('BaseURL');
        const baseUrl = baseUrlTag ? baseUrlTag.textContent.trim() : '';

        // SegmentTimeline
        const segmentTimeline = segmentTemplate.querySelector('SegmentTimeline');
        const segments = [];

        if (segmentTimeline) {
            const sElements = segmentTimeline.querySelectorAll('S');
            let currentTime = 0;
            let currentNumber = startNumber;

            sElements.forEach((s) => {
                // t is optional, defaults to previous end
                const tAttr = s.getAttribute('t');
                if (tAttr) currentTime = parseInt(tAttr, 10);

                const d = parseInt(s.getAttribute('d'), 10);
                const r = parseInt(s.getAttribute('r') || '0', 10);

                // Initial segment
                segments.push({ number: currentNumber, time: currentTime });
                currentTime += d;
                currentNumber++;

                // Repeats
                // r is the number of REPEATS (so total occurrences = 1 + r)
                // If r is negative, it refers to open-ended? (Usually not in static manifests)
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

    generateSegmentUrls(manifest) {
        const { baseUrl, initialization, media, segments, repId } = manifest;
        const urls = [];

        // Helper to resolve template strings
        const resolveTemplate = (template, number, time) => {
            return template
                .replace(/\$RepresentationID\$/g, repId)
                .replace(/\$Number(?:%0([0-9]+)d)?\$/g, (match, width) => {
                    if (width) {
                        return number.toString().padStart(parseInt(width), '0');
                    }
                    return number;
                })
                .replace(/\$Time(?:%0([0-9]+)d)?\$/g, (match, width) => {
                    if (width) {
                        return time.toString().padStart(parseInt(width), '0');
                    }
                    return time;
                });
        };

        // Helper to join paths handling slashes
        const joinPath = (base, part) => {
            if (!base) return part;
            if (part.startsWith('http')) return part; // Absolute path
            return base.endsWith('/') ? base + part : base + '/' + part;
        };

        // 1. Initialization Segment
        if (initialization) {
            const initPath = resolveTemplate(initialization, 0, 0); // Init often doesn't use Number/Time but just in case
            urls.push(joinPath(baseUrl, initPath));
        }

        // 2. Media Segments
        if (segments && segments.length > 0) {
            segments.forEach((seg) => {
                const path = resolveTemplate(media, seg.number, seg.time);
                urls.push(joinPath(baseUrl, path));
            });
        }

        return urls;
    }
}
