// js/waveform.js

export class WaveformGenerator {
    constructor() {
        // AudioContext is reused across decodeAudioData calls — OfflineAudioContext
        // becomes closed after rendering and cannot be reused for decoding.
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.cache = new Map();
    }

    async getWaveform(url, trackId) {
        if (this.cache.has(trackId)) {
            return this.cache.get(trackId);
        }

        if (url.includes('.mpd') || url.includes('.m3u8')) {
            console.warn(`[Waveform] Skipping manifest URL (DASH/HLS not supported for waveform): ${url}`);
            return null;
        }

        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errorMsg = `Failed to fetch audio: ${response.status} ${response.statusText}`;
                console.warn(`[Waveform] ${errorMsg} for ${url}`);
                throw new Error(errorMsg);
            }

            const contentType = response.headers.get('content-type') || '';
            const contentLength = response.headers.get('content-length');
            
            if (contentType.includes('text/html') || contentType.includes('application/dash+xml') || contentType.includes('application/vnd.apple.mpegurl')) {
                console.warn(`[Waveform] Skipping non-audio content type: ${contentType}`);
                return null;
            }

            const arrayBuffer = await response.arrayBuffer();
            
            console.log(`[Waveform] Downloaded ${arrayBuffer.byteLength} bytes, Type: ${contentType}`);

            // Check if buffer is suspiciously small (e.g., < 20KB is probably an error message)
            if (arrayBuffer.byteLength < 20000) {
                 console.warn(`[Waveform] Data too small (${arrayBuffer.byteLength} bytes), skipping.`);
                 return null;
            }

            try {
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                const peaks = this.extractPeaks(audioBuffer);
                const result = { peaks, duration: audioBuffer.duration };
                this.cache.set(trackId, result);
                return result;
            } catch (decodeError) {
                console.error(`[Waveform] decodeAudioData failed for ${contentType} (${arrayBuffer.byteLength} bytes):`, decodeError);
                return null;
            }
        } catch (error) {
            console.error('[Waveform] Generation error:', error);
            return null;
        }
    }

    extractPeaks(audioBuffer) {
        const { length, duration } = audioBuffer;
        const numPeaks = Math.min(Math.floor(4 * duration), 1000);
        const peaks = new Float32Array(numPeaks);
        const chanData = audioBuffer.getChannelData(0); // Use first channel
        const step = Math.floor(length / numPeaks);
        const stride = 8; // Check every 8th sample for speed

        for (let i = 0; i < numPeaks; i++) {
            let max = 0;
            const start = i * step;
            const end = start + step;
            for (let j = start; j < end; j += stride) {
                const datum = chanData[j];
                if (datum > max) {
                    max = datum;
                } else if (-datum > max) {
                    max = -datum;
                }
            }
            peaks[i] = max;
        }

        // Normalize peaks so the highest peak is 1.0
        let maxPeak = 0;
        for (let i = 0; i < numPeaks; i++) {
            if (peaks[i] > maxPeak) maxPeak = peaks[i];
        }
        if (maxPeak > 0) {
            for (let i = 0; i < numPeaks; i++) {
                peaks[i] /= maxPeak;
            }
        }

        return peaks;
    }

    drawWaveform(canvas, peaks) {
        if (!canvas || !peaks) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        const step = width / peaks.length;
        const centerY = height / 2;

        ctx.fillStyle = '#000'; // Mask color (opaque part)
        ctx.beginPath();

        // Draw top half
        ctx.moveTo(0, centerY);
        for (let i = 0; i < peaks.length; i++) {
            const peak = peaks[i];
            const barHeight = Math.max(1.5, peak * height * 0.9);
            ctx.lineTo(i * step, centerY - barHeight / 2);
        }

        // Draw bottom half (backwards)
        for (let i = peaks.length - 1; i >= 0; i--) {
            const peak = peaks[i];
            const barHeight = Math.max(1.5, peak * height * 0.9);
            ctx.lineTo(i * step, centerY + barHeight / 2);
        }

        ctx.closePath();
        ctx.fill();
    }

    // Removed drawRoundedRect as it's no longer used for continuous paths
}

export const waveformGenerator = new WaveformGenerator();
