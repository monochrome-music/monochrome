import * as lamejs from '@breezystack/lamejs';

const SAMPLE_RATE = 44100;
const BITRATE = 320;

function clampFloatSample(value) {
    return Math.max(-1.0, Math.min(1.0, value));
}

self.onmessage = async (e) => {
    const { channelData, numberOfChannels } = e.data;
    
    try {
        const channels = numberOfChannels > 2 ? 2 : numberOfChannels;
        
        if (numberOfChannels > 2) {
            self.postMessage({
                type: 'warning',
                message: `MP3 encoder: Input has ${numberOfChannels} channels, truncating to stereo (keeping channels 0 and 1)`
            });
        }
        
        self.postMessage({ type: 'progress', stage: 'encoding', message: 'Encoding to MP3 320kbps...' });
        
        const mp3encoder = new lamejs.Mp3Encoder(channels, SAMPLE_RATE, BITRATE);
        const mp3Data = [];
        const sampleBlockSize = 1152;
        
        if (channels === 1) {
            const samples = channelData[0];
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

                if (i % (sampleBlockSize * 100) === 0) {
                    const progress = (i / totalSamples) * 100;
                    self.postMessage({ type: 'progress', stage: 'encoding', progress });
                }
            }
        } else {
            const left = channelData[0];
            const right = channelData[1];
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

                if (i % (sampleBlockSize * 100) === 0) {
                    const progress = (i / totalSamples) * 100;
                    self.postMessage({ type: 'progress', stage: 'encoding', progress });
                }
            }
        }

        const mp3buf = mp3encoder.flush();
        if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
        }

        self.postMessage({ type: 'progress', stage: 'finalizing', message: 'Finalizing MP3...' });

        const mp3Blob = new Blob(mp3Data, { type: 'audio/mpeg' });
        self.postMessage({ type: 'complete', blob: mp3Blob });
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
    }
};
