self.__AMAZON_SW_DECRYPTER_VERSION__ = '2026-06-23-flac-hls-v8';
console.log(`[SW Decrypter] Loaded ${self.__AMAZON_SW_DECRYPTER_VERSION__}`);

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.pathname === '/api/decrypt-stream') {
        event.stopImmediatePropagation();

        const streamUrl = url.searchParams.get('url');
        const keyHex = url.searchParams.get('key');
        const targetCodec = url.searchParams.get('codec') || 'flac';
        
        if (!streamUrl || !keyHex) {
            event.respondWith(new Response('Missing url or key', { status: 400 }));
            return;
        }

        if (targetCodec === 'flac-hls') {
            event.respondWith(handleHlsPlaylist(url, streamUrl, keyHex));
        } else if (targetCodec === 'flac-hls-init') {
            event.respondWith(handleHlsInit(url, streamUrl, keyHex));
        } else if (targetCodec === 'flac-hls-segment') {
            event.respondWith(handleHlsSegment(url, streamUrl, keyHex));
        } else {
            event.respondWith(handleDecryptStream(event.request, streamUrl, keyHex, targetCodec));
        }
    }
});

async function handleDecryptStream(request, streamUrl, keyHex, targetCodec = 'flac') {
    try {
        const headers = new Headers();
        // Do not forward Range header so we get the whole file from the beginning

        const response = await fetch(streamUrl, { headers, mode: 'cors', credentials: 'omit' });
        if (!response.ok) {
            return response;
        }

        console.log(`[SW Decrypter] Intercepted stream request. Codec: ${targetCodec}, Target: ${streamUrl.substring(0, 50)}...`);

        const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-CTR', false, ['decrypt']);

        const transformStream = new TransformStream(new Mp4DecryptTransformer(cryptoKey, targetCodec));

        const newHeaders = new Headers(response.headers);
        const rawFlacMode = targetCodec === 'flac-raw';
        
        newHeaders.set('Accept-Ranges', 'none');
        newHeaders.set('Content-Type', getDecryptedContentType(targetCodec));
        newHeaders.set('Cache-Control', 'no-store');
        newHeaders.delete('Content-Encoding');
        newHeaders.delete('Content-Disposition');
        newHeaders.delete('Content-Range');

        if (rawFlacMode || targetCodec === 'flac') {
            newHeaders.delete('Content-Length');
        }

        return new Response(response.body.pipeThrough(transformStream), {
            status: 200,
            statusText: 'OK',
            headers: newHeaders
        });
    } catch (error) {
        console.error('Decryption stream failed:', error);
        return new Response('Internal Server Error', { status: 500 });
    }
}

function getDecryptedContentType(targetCodec) {
    if (targetCodec === 'flac-raw') return 'audio/flac';
    if (targetCodec === 'mp4a') return 'audio/mp4; codecs="mp4a.40.2"';
    return 'audio/mp4';
}

async function handleHlsPlaylist(requestUrl, streamUrl, keyHex) {
    try {
        const metadata = await getFragmentedMp4Metadata(streamUrl);
        const initUri = buildDecryptStreamUrl({
            url: streamUrl,
            key: keyHex,
            codec: 'flac-hls-init',
            end: metadata.moovEnd - 1,
        });
        const targetDuration = Math.max(1, Math.ceil(Math.max(...metadata.segments.map((segment) => segment.duration))));
        const lines = [
            '#EXTM3U',
            '#EXT-X-VERSION:7',
            '#EXT-X-PLAYLIST-TYPE:VOD',
            '#EXT-X-INDEPENDENT-SEGMENTS',
            `#EXT-X-TARGETDURATION:${targetDuration}`,
            '#EXT-X-MEDIA-SEQUENCE:0',
            `#EXT-X-MAP:URI="${initUri}"`,
        ];

        metadata.segments.forEach((segment, index) => {
            const segmentUri = buildDecryptStreamUrl({
                url: streamUrl,
                key: keyHex,
                codec: 'flac-hls-segment',
                segment: index,
                start: segment.start,
                end: segment.end,
            });
            lines.push(`#EXTINF:${segment.duration.toFixed(6)},`);
            lines.push(segmentUri);
        });

        lines.push('#EXT-X-ENDLIST', '');
        console.log('[SW Decrypter] Generated HLS playlist.', {
            segments: metadata.segments.length,
            targetDuration,
            streamUrl: streamUrl.substring(0, 50),
        });

        return new Response(lines.join('\n'), {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.apple.mpegurl',
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            },
        });
    } catch (error) {
        console.error('[SW Decrypter] Failed to generate HLS playlist:', error);
        return new Response('Failed to generate HLS playlist', { status: 500 });
    }
}

async function handleHlsInit(requestUrl, streamUrl, keyHex) {
    try {
        const end = Number(requestUrl.searchParams.get('end'));
        const metadata = Number.isFinite(end) ? null : await getFragmentedMp4Metadata(streamUrl);
        const initEnd = Number.isFinite(end) ? end : metadata.moovEnd - 1;
        const initBytes = await fetchRangeBytes(streamUrl, 0, initEnd);
        const transformedBytes = await transformMp4Bytes(initBytes, keyHex, 'flac');
        console.log('[SW Decrypter] Served HLS init segment.', { bytes: transformedBytes.length });

        return new Response(transformedBytes, {
            status: 200,
            headers: {
                'Content-Type': 'audio/mp4',
                'Content-Length': String(transformedBytes.length),
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            },
        });
    } catch (error) {
        console.error('[SW Decrypter] Failed to serve HLS init segment:', error);
        return new Response('Failed to serve HLS init segment', { status: 500 });
    }
}

async function handleHlsSegment(requestUrl, streamUrl, keyHex) {
    try {
        let start = Number(requestUrl.searchParams.get('start'));
        let end = Number(requestUrl.searchParams.get('end'));

        if (!Number.isFinite(start) || !Number.isFinite(end)) {
            const metadata = await getFragmentedMp4Metadata(streamUrl);
            const segmentIndex = Number(requestUrl.searchParams.get('segment') || '0');
            const segment = metadata.segments[segmentIndex];
            if (!segment) return new Response('Segment not found', { status: 404 });
            start = segment.start;
            end = segment.end;
        }

        const segmentBytes = await fetchRangeBytes(streamUrl, start, end);
        const transformedBytes = await transformMp4Bytes(segmentBytes, keyHex, 'flac');
        console.log('[SW Decrypter] Served HLS media segment.', {
            start,
            end,
            bytes: transformedBytes.length,
        });

        return new Response(transformedBytes, {
            status: 200,
            headers: {
                'Content-Type': 'audio/mp4',
                'Content-Length': String(transformedBytes.length),
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            },
        });
    } catch (error) {
        console.error('[SW Decrypter] Failed to serve HLS media segment:', error);
        return new Response('Failed to serve HLS media segment', { status: 500 });
    }
}

function buildDecryptStreamUrl(params) {
    const url = new URL('/api/decrypt-stream', location.origin);
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
    }
    return url.href;
}

async function getFragmentedMp4Metadata(streamUrl) {
    const headerBytes = await fetchRangeBytes(streamUrl, 0, 2 * 1024 * 1024 - 1);
    const topLevelBoxes = parseTopLevelBoxes(headerBytes);
    const moovBox = topLevelBoxes.find((box) => box.type === 'moov');
    const sidxBox = topLevelBoxes.find((box) => box.type === 'sidx');

    if (!moovBox || !sidxBox) {
        throw new Error('Missing moov or sidx box for HLS wrapping');
    }

    const sidx = parseSidx(headerBytes, sidxBox);
    let segmentStart = sidxBox.start + sidxBox.size + sidx.firstOffset;
    const segments = sidx.references.map((reference) => {
        const start = segmentStart;
        const end = start + reference.size - 1;
        segmentStart = end + 1;
        return {
            start,
            end,
            duration: reference.duration / sidx.timescale,
        };
    });

    return {
        moovEnd: moovBox.start + moovBox.size,
        sidx,
        segments,
    };
}

function parseTopLevelBoxes(bytes) {
    const boxes = [];
    let offset = 0;

    while (offset + 8 <= bytes.length) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
        let size = view.getUint32(0);
        const type = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));
        let headerSize = 8;

        if (size === 1) {
            if (offset + 16 > bytes.length) break;
            const high = view.getUint32(8);
            const low = view.getUint32(12);
            size = high * 2 ** 32 + low;
            headerSize = 16;
        } else if (size === 0) {
            size = bytes.length - offset;
        }

        if (size < headerSize || offset + size > bytes.length) break;
        boxes.push({ type, start: offset, size, headerSize });
        offset += size;
    }

    return boxes;
}

function parseSidx(bytes, box) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + box.start, box.size);
    const version = view.getUint8(8);
    const timescale = view.getUint32(16);
    let offset;
    let firstOffset;

    if (version === 0) {
        firstOffset = view.getUint32(24);
        offset = 32;
    } else {
        const firstOffsetHigh = view.getUint32(28);
        const firstOffsetLow = view.getUint32(32);
        firstOffset = firstOffsetHigh * 2 ** 32 + firstOffsetLow;
        offset = 40;
    }

    const referenceCount = view.getUint16(offset - 2);
    const references = [];

    for (let i = 0; i < referenceCount; i++) {
        const referenceInfo = view.getUint32(offset);
        const referenceType = referenceInfo >>> 31;
        const size = referenceInfo & 0x7fffffff;
        const duration = view.getUint32(offset + 4);
        if (referenceType === 0) {
            references.push({ size, duration });
        }
        offset += 12;
    }

    return { timescale, firstOffset, references };
}

async function fetchRangeBytes(url, start, end) {
    const response = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        mode: 'cors',
        credentials: 'omit',
    });

    if (!response.ok && response.status !== 206) {
        throw new Error(`Range request failed: ${response.status}`);
    }

    return readAllBytes(response.body);
}

async function transformMp4Bytes(bytes, keyHex, targetCodec) {
    const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-CTR', false, ['decrypt']);
    const transformStream = new TransformStream(new Mp4DecryptTransformer(cryptoKey, targetCodec));
    return readAllBytes(new Response(bytes).body.pipeThrough(transformStream));
}

async function readAllBytes(stream) {
    const reader = stream.getReader();
    const chunks = [];
    let totalLength = 0;

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalLength += value.length;
    }

    const bytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
    }

    return bytes;
}

class Mp4DecryptTransformer {
    constructor(cryptoKey, targetCodec = 'flac') {
        this.cryptoKey = cryptoKey;
        this.targetCodec = targetCodec;
        this.rawFlacMode = targetCodec === 'flac-raw';
        this.flacHeaderEmitted = false;
        this.flacMetadataBlocks = null;
        this.buffer = new Uint8Array(0);
        this.state = 'READ_HEADER';
        this.currentBoxSize = 0;
        this.currentBoxType = '';
        this.currentBoxDataRead = 0;

        // Context state
        this.sampleSizes = [];
        this.sampleIVs = [];
        this.currentSampleIndex = 0;
        this.currentSampleBytesRead = 0;
        this.isEncrypted = true;
    }

    async transform(chunk, controller) {
        this.buffer = this.concatUint8(this.buffer, chunk);
        await this.processBuffer(controller);
    }

    async flush(controller) {
        if (this.buffer.length > 0) {
            // In native FLAC mode the output must contain only the FLAC stream,
            // never trailing MP4 box bytes that Safari may reject immediately.
            if (!this.rawFlacMode) {
                controller.enqueue(this.buffer);
            }
            this.buffer = new Uint8Array(0);
        }
    }

    async processBuffer(controller) {
        while (true) {
            if (this.state === 'READ_HEADER') {
                if (this.buffer.length < 8) return;

                const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 8);
                this.currentBoxSize = view.getUint32(0);
                this.currentBoxType = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));
                
                let headerSize = 8;
                if (this.currentBoxSize === 1) {
                    if (this.buffer.length < 16) return;
                    // 64-bit size
                    const view16 = new DataView(this.buffer.buffer, this.buffer.byteOffset, 16);
                    const high = view16.getUint32(8);
                    const low = view16.getUint32(12);
                    this.currentBoxSize = (high * Math.pow(2, 32)) + low;
                    headerSize = 16;
                }

                if (this.currentBoxSize === 0) {
                    // Box extends to end of file
                    this.currentBoxSize = Infinity;
                }

                // If it's a container box we want to parse inside, we just enqueue the header and move to its children
                if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'moof', 'traf'].includes(this.currentBoxType)) {
                    if (!this.rawFlacMode) {
                        controller.enqueue(this.buffer.slice(0, headerSize));
                    }
                    this.buffer = this.buffer.slice(headerSize);
                    this.state = 'READ_HEADER';
                    continue;
                }

                // If it's mdat, we process it sample by sample
                if (this.currentBoxType === 'mdat') {
                    if (!this.rawFlacMode) {
                        controller.enqueue(this.buffer.slice(0, headerSize));
                    } else {
                        this.enqueueFlacHeader(controller);
                    }
                    this.buffer = this.buffer.slice(headerSize);
                    this.currentBoxDataRead = headerSize;
                    this.state = 'PROCESS_MDAT';
                    continue;
                }

                this.state = 'READ_BOX_DATA';
            }

            if (this.state === 'READ_BOX_DATA') {
                if (this.currentBoxSize === Infinity) {
                    if (!this.rawFlacMode) {
                        controller.enqueue(this.buffer);
                    }
                    this.buffer = new Uint8Array(0);
                    return;
                }

                if (this.buffer.length < this.currentBoxSize) return; // Wait for full box

                let boxData = this.buffer.slice(0, this.currentBoxSize);
                this.buffer = this.buffer.slice(this.currentBoxSize);

                boxData = this.modifyBox(this.currentBoxType, boxData);
                if (!this.rawFlacMode) {
                    controller.enqueue(boxData);
                }
                this.state = 'READ_HEADER';
            }

            if (this.state === 'PROCESS_MDAT') {
                // If we don't have sample sizes (e.g. not encrypted, or failed to parse trun), just flush
                if (this.sampleSizes.length === 0 || this.currentSampleIndex >= this.sampleSizes.length) {
                    const remainingMdat = this.currentBoxSize - this.currentBoxDataRead;
                    const chunkToEnqueue = Math.min(this.buffer.length, remainingMdat);
                    
                    if (chunkToEnqueue > 0) {
                        if (!this.rawFlacMode) {
                            controller.enqueue(this.buffer.slice(0, chunkToEnqueue));
                        }
                        this.buffer = this.buffer.slice(chunkToEnqueue);
                        this.currentBoxDataRead += chunkToEnqueue;
                    }

                    if (this.currentBoxDataRead >= this.currentBoxSize) {
                        this.state = 'READ_HEADER';
                        continue;
                    } else {
                        return;
                    }
                }

                const targetSampleSize = this.sampleSizes[this.currentSampleIndex];
                const neededBytes = targetSampleSize - this.currentSampleBytesRead;

                if (this.buffer.length < neededBytes) {
                    // Wait until we have the full sample to decrypt it properly with AES-CTR
                    // We could decrypt incrementally, but buffering per sample is simpler and FLAC samples are small
                    return; 
                }

                const sampleData = this.buffer.slice(0, neededBytes);
                this.buffer = this.buffer.slice(neededBytes);
                
                const decryptedData = await this.decryptSample(sampleData, this.sampleIVs[this.currentSampleIndex]);
                this.enqueueFlacHeader(controller);
                controller.enqueue(decryptedData);

                this.currentBoxDataRead += neededBytes;
                this.currentSampleIndex++;
                this.currentSampleBytesRead = 0;

                if (this.currentBoxDataRead >= this.currentBoxSize) {
                    this.state = 'READ_HEADER';
                }
            }
        }
    }

    modifyBox(type, boxData) {
        // Strip DRM by renaming encryption boxes to 'free' and fixing sample entry
        if (type === 'sinf' || type === 'senc' || type === 'sbgp' || type === 'sgpd' || type === 'pssh') {
            this.renameBoxToFree(boxData);
        }

        if (type === 'stsd') {
            const view = new DataView(boxData.buffer, boxData.byteOffset);
            const hasExistingDfLa = this.hasBoxType(boxData, 'dfLa');
            this.flacMetadataBlocks = this.extractDfLaMetadata(boxData) || this.flacMetadataBlocks;
            let isFlac = false;
            for (let i = 8; i < boxData.length - 4; i++) {
                if (boxData[i] === 0x65 && boxData[i+1] === 0x6e && boxData[i+2] === 0x63 && boxData[i+3] === 0x61) { // 'enca'
                    if (this.targetCodec === 'flac' || this.targetCodec === 'flac-raw') {
                        boxData[i] = 0x66; // f
                        boxData[i+1] = 0x4c; // L
                        boxData[i+2] = 0x61; // a
                        boxData[i+3] = 0x43; // C
                        isFlac = true;
                    } else if (this.targetCodec === 'mp4a') {
                        boxData[i] = 0x6d; // m
                        boxData[i+1] = 0x70; // p
                        boxData[i+2] = 0x34; // 4
                        boxData[i+3] = 0x61; // a
                    }
                }
                
                // If it's FLAC, synthesize dfLa box to replace sinf
                if (isFlac && boxData[i] === 0x73 && boxData[i+1] === 0x69 && boxData[i+2] === 0x6e && boxData[i+3] === 0x66) { // 'sinf'
                    const sinfSize = view.getUint32(i - 4);
                    if (hasExistingDfLa) {
                        this.renameNestedBoxToFree(boxData, i - 4, sinfSize);
                        console.log('[SW Decrypter] Preserved existing dfLa box and removed sinf.');
                        continue;
                    }

                    // The dfLa box with dummy STREAMINFO is 50 bytes.
                    if (sinfSize >= 50) {
                        const dfLa = new Uint8Array([
                            0x00, 0x00, 0x00, 0x32, // size = 50
                            0x64, 0x66, 0x4C, 0x61, // 'dfLa'
                            0x00, 0x00, 0x00, 0x00, // version/flags
                            0x80, 0x00, 0x00, 0x22, // metadata block header
                            0x10, 0x00, // min block
                            0x10, 0x00, // max block
                            0x00, 0x00, 0x00, // min frame size
                            0x00, 0x00, 0x00, // max frame size
                            0x0A, 0xC4, 0x42, 0xF0, // sr (44100), chan (2), bps (16), total samples high
                            0x00, 0x00, 0x00, 0x00, // total samples low
                            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 // MD5
                        ]);
                        boxData.set(dfLa, i - 4);
                        console.log('[SW Decrypter] Injected synthetic dfLa box successfully.');
                        
                        const remaining = sinfSize - 50;
                        if (remaining >= 8) {
                            view.setUint32(i - 4 + 50, remaining);
                            boxData[i - 4 + 54] = 0x66; // f
                            boxData[i - 4 + 55] = 0x72; // r
                            boxData[i - 4 + 56] = 0x65; // e
                            boxData[i - 4 + 57] = 0x65; // e
                            for (let j = i - 4 + 58; j < i - 4 + sinfSize; j++) {
                                boxData[j] = 0x00;
                            }
                        }
                    } else {
                        console.warn('[SW Decrypter] Cannot inject dfLa box! sinf size too small:', sinfSize);
                    }
                }
            }
        }

        if (type === 'tfhd') {
            this.parseTfhd(boxData);
        }

        if (type === 'trun') {
            this.parseTrun(boxData);
        }

        if (type === 'senc') {
            this.parseSenc(boxData);
        }

        return boxData;
    }

    renameBoxToFree(boxData) {
        boxData[4] = 0x66; // f
        boxData[5] = 0x72; // r
        boxData[6] = 0x65; // e
        boxData[7] = 0x65; // e
    }

    renameNestedBoxToFree(boxData, start, size) {
        if (start < 0 || size < 8 || start + size > boxData.length) return;
        boxData[start + 4] = 0x66; // f
        boxData[start + 5] = 0x72; // r
        boxData[start + 6] = 0x65; // e
        boxData[start + 7] = 0x65; // e
        for (let i = start + 8; i < start + size; i++) {
            boxData[i] = 0x00;
        }
    }

    hasBoxType(boxData, type) {
        const a = type.charCodeAt(0);
        const b = type.charCodeAt(1);
        const c = type.charCodeAt(2);
        const d = type.charCodeAt(3);
        for (let i = 4; i < boxData.length - 4; i++) {
            if (boxData[i] === a && boxData[i + 1] === b && boxData[i + 2] === c && boxData[i + 3] === d) {
                const size = new DataView(boxData.buffer, boxData.byteOffset).getUint32(i - 4);
                if (size >= 8 && i - 4 + size <= boxData.length) return true;
            }
        }
        return false;
    }

    extractDfLaMetadata(boxData) {
        for (let i = 4; i < boxData.length - 4; i++) {
            if (boxData[i] !== 0x64 || boxData[i + 1] !== 0x66 || boxData[i + 2] !== 0x4c || boxData[i + 3] !== 0x61) {
                continue;
            }

            const size = new DataView(boxData.buffer, boxData.byteOffset).getUint32(i - 4);
            const start = i - 4;
            if (size < 16 || start + size > boxData.length) continue;

            // dfLa is a FullBox: size/type + version/flags + native FLAC metadata blocks.
            return boxData.slice(start + 12, start + size);
        }

        return null;
    }

    enqueueFlacHeader(controller) {
        if (!this.rawFlacMode || this.flacHeaderEmitted) return;

        const signature = new Uint8Array([0x66, 0x4c, 0x61, 0x43]); // fLaC
        controller.enqueue(signature);
        controller.enqueue(this.flacMetadataBlocks || this.createFallbackStreamInfo());
        this.flacHeaderEmitted = true;
        console.log('[SW Decrypter] Emitted native FLAC stream header.');
    }

    createFallbackStreamInfo() {
        return new Uint8Array([
            0x80, 0x00, 0x00, 0x22,
            0x10, 0x00,
            0x10, 0x00,
            0x00, 0x00, 0x00,
            0x00, 0x00, 0x00,
            0x0a, 0xc4, 0x42, 0xf0,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00,
        ]);
    }

    parseTfhd(boxData) {
        const view = new DataView(boxData.buffer, boxData.byteOffset);
        const flags = view.getUint32(8) & 0xFFFFFF;
        
        let offset = 16; // 8 byte header + 4 byte version/flags + 4 byte track_ID
        if (flags & 0x000001) offset += 8; // base_data_offset
        if (flags & 0x000002) offset += 4; // sample_description_index
        if (flags & 0x000008) offset += 4; // default_sample_duration
        if (flags & 0x000010) {
            this.defaultSampleSize = view.getUint32(offset); // default_sample_size
        }
    }

    parseTrun(boxData) {
        const view = new DataView(boxData.buffer, boxData.byteOffset);
        const flags = view.getUint32(8) & 0xFFFFFF;
        const sampleCount = view.getUint32(12);
        
        const dataOffsetPresent = (flags & 0x000001) !== 0;
        const firstSampleFlagsPresent = (flags & 0x000004) !== 0;
        const sampleDurationPresent = (flags & 0x000100) !== 0;
        const sampleSizePresent = (flags & 0x000200) !== 0;
        const sampleFlagsPresent = (flags & 0x000400) !== 0;

        let offset = 16;
        if (dataOffsetPresent) offset += 4;
        if (firstSampleFlagsPresent) offset += 4;

        this.sampleSizes = [];
        this.currentSampleIndex = 0;
        this.currentSampleBytesRead = 0;

        for (let i = 0; i < sampleCount; i++) {
            if (sampleDurationPresent) offset += 4;
            if (sampleSizePresent) {
                this.sampleSizes.push(view.getUint32(offset));
                offset += 4;
            } else {
                this.sampleSizes.push(this.defaultSampleSize || 0);
            }
            if (sampleFlagsPresent) offset += 4;
            // sample_composition_time_offsets etc are usually absent in audio trun
        }
    }

    parseSenc(boxData) {
        const view = new DataView(boxData.buffer, boxData.byteOffset);
        const flags = view.getUint32(8) & 0xFFFFFF;
        const sampleCount = view.getUint32(12);

        const ivSize = 8; // Amazon Music usually uses 8-byte IVs for CENC
        
        let offset = 16;
        this.sampleIVs = [];

        for (let i = 0; i < sampleCount; i++) {
            const iv = new Uint8Array(16);
            for (let j = 0; j < ivSize; j++) {
                iv[j] = view.getUint8(offset + j);
            }
            this.sampleIVs.push(iv);
            offset += ivSize;

            if (flags & 0x000002) { // Subsample encryption present
                const subsampleCount = view.getUint16(offset);
                offset += 2 + (subsampleCount * 6);
            }
        }
    }

    async decryptSample(sampleData, iv) {
        if (!iv) return sampleData; // Fallback if missing
        
        try {
            const decryptedBuffer = await crypto.subtle.decrypt(
                { name: 'AES-CTR', counter: iv, length: 64 }, 
                this.cryptoKey, 
                sampleData
            );
            return new Uint8Array(decryptedBuffer);
        } catch (e) {
            console.error('Decryption failed for sample', e);
            return sampleData;
        }
    }

    concatUint8(a, b) {
        const c = new Uint8Array(a.length + b.length);
        c.set(a, 0);
        c.set(b, a.length);
        return c;
    }
}
