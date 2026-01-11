// js/waveform.js

export class WaveformGenerator {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.cache = new Map();
    }

    async getWaveform(url, trackId) {
        if (this.cache.has(trackId)) {
            return this.cache.get(trackId);
        }

        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            const peaks = this.extractPeaks(audioBuffer);
            const result = { peaks, duration: audioBuffer.duration };
            this.cache.set(trackId, result);
            return result;
        } catch (error) {
            console.error('Waveform generation failed:', error);
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
