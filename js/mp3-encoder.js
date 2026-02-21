import * as lamejs from '@breezystack/lamejs';

const SAMPLE_RATE = 44100;
const BITRATE = 320;

function clampFloatSample(value) {
    return Math.max(-1.0, Math.min(1.0, value));
}

async function decodeAudioData(audioBlob) {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        return audioBuffer;
    } finally {
        await audioContext.close();
    }
}

function resampleBuffer(audioBuffer, targetSampleRate) {
    if (audioBuffer.sampleRate === targetSampleRate) {
        return audioBuffer;
    }

    const offlineContext = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        Math.ceil(audioBuffer.duration * targetSampleRate),
        targetSampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start(0);

    return offlineContext.startRendering();
}

export async function encodeToMp3(audioBlob, onProgress = null) {
    try {
        if (onProgress) {
            onProgress({ stage: 'decoding', message: 'Decoding audio...' });
        }

        let audioBuffer = await decodeAudioData(audioBlob);

        if (audioBuffer.sampleRate !== SAMPLE_RATE) {
            if (onProgress) {
                onProgress({ stage: 'resampling', message: 'Resampling to 44.1kHz...' });
            }
            audioBuffer = await resampleBuffer(audioBuffer, SAMPLE_RATE);
        }

        if (onProgress) {
            onProgress({ stage: 'encoding', message: 'Encoding to MP3 320kbps...' });
        }

        const channels = audioBuffer.numberOfChannels;
        
        if (channels > 2) {
            console.warn(`MP3 encoder: Input has ${channels} channels, truncating to stereo (keeping channels 0 and 1)`);
        }
        
        const mp3encoder = new lamejs.Mp3Encoder(Math.min(channels, 2), SAMPLE_RATE, BITRATE);
        const mp3Data = [];

        const sampleBlockSize = 1152;

        if (channels === 1) {
            const samples = audioBuffer.getChannelData(0);
            const totalSamples = samples.length;

            for (let i = 0; i < totalSamples; i += sampleBlockSize) {
                const chunkSize = Math.min(sampleBlockSize, totalSamples - i);
                const sampleChunk = new Int16Array(chunkSize);
                
                for (let j = 0; j < chunkSize; j++) {
                    const clamped = clampFloatSample(samples[i + j]);
                    sampleChunk[j] = clamped < 0 ? clamped * 32768 : clamped * 32767;
                }
                
                const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
                if (mp3buf.length > 0) {
                    mp3Data.push(mp3buf);
                }

                if (onProgress && i % (sampleBlockSize * 100) === 0) {
                    const progress = (i / totalSamples) * 100;
                    onProgress({ stage: 'encoding', progress });
                }
            }
        } else {
            const left = audioBuffer.getChannelData(0);
            const right = audioBuffer.getChannelData(1);
            const totalSamples = left.length;

            for (let i = 0; i < totalSamples; i += sampleBlockSize) {
                const chunkSize = Math.min(sampleBlockSize, totalSamples - i);
                const leftChunk = new Int16Array(chunkSize);
                const rightChunk = new Int16Array(chunkSize);
                
                for (let j = 0; j < chunkSize; j++) {
                    const clampedLeft = clampFloatSample(left[i + j]);
                    const clampedRight = clampFloatSample(right[i + j]);
                    leftChunk[j] = clampedLeft < 0 ? clampedLeft * 32768 : clampedLeft * 32767;
                    rightChunk[j] = clampedRight < 0 ? clampedRight * 32768 : clampedRight * 32767;
                }
                
                const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
                if (mp3buf.length > 0) {
                    mp3Data.push(mp3buf);
                }

                if (onProgress && i % (sampleBlockSize * 100) === 0) {
                    const progress = (i / totalSamples) * 100;
                    onProgress({ stage: 'encoding', progress });
                }
            }
        }

        const mp3buf = mp3encoder.flush();
        if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
        }

        if (onProgress) {
            onProgress({ stage: 'finalizing', message: 'Finalizing MP3...' });
        }

        const mp3Blob = new Blob(mp3Data, { type: 'audio/mpeg' });
        return mp3Blob;
    } catch (error) {
        console.error('MP3 encoding failed:', error);
        throw new Error('Failed to encode MP3: ' + error.message);
    }
}
