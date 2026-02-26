class MP3EncodingError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MP3EncodingError';
        this.code = 'MP3_ENCODING_FAILED';
    }
}

async function encodeToMp3Worker(audioBlob, onProgress = null, signal = null) {
    const audioData = await audioBlob.arrayBuffer();
    
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./mp3-encoder.worker.js', import.meta.url), { type: 'module' });
        
        // Handle abort signal
        const abortHandler = () => {
            worker.terminate();
            reject(new MP3EncodingError('MP3 encoding aborted'));
        };
        
        if (signal) {
            if (signal.aborted) {
                abortHandler();
                return;
            }
            signal.addEventListener('abort', abortHandler);
        }
        
        worker.onmessage = (e) => {
            const { type, blob, message, stage, progress } = e.data;
            
            if (type === 'complete') {
                if (signal) signal.removeEventListener('abort', abortHandler);
                worker.terminate();
                resolve(blob);
            } else if (type === 'error') {
                if (signal) signal.removeEventListener('abort', abortHandler);
                worker.terminate();
                reject(new MP3EncodingError(message));
            } else if (type === 'progress' && onProgress) {
                onProgress({ stage, message, progress });
            } else if (type === 'log') {
                console.log('[FFmpeg]', message);
            }
        };
        
        worker.onerror = (error) => {
            if (signal) signal.removeEventListener('abort', abortHandler);
            worker.terminate();
            reject(new MP3EncodingError('Worker failed: ' + error.message));
        };
        
        // Transfer audio data to worker
        worker.postMessage({
            audioData
        }, [audioData]);
    });
}

export async function encodeToMp3(audioBlob, onProgress = null, signal = null) {
    try {
        // Use Web Worker for non-blocking FFmpeg encoding
        if (typeof Worker !== 'undefined') {
            return await encodeToMp3Worker(audioBlob, onProgress, signal);
        }
        
        throw new MP3EncodingError('Web Workers are required for MP3 encoding');
    } catch (error) {
        console.error('MP3 encoding failed:', error);
        throw error;
    }
}

export { MP3EncodingError };
