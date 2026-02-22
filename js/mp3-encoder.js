async function encodeToMp3Worker(audioBlob, onProgress = null) {
    const audioData = await audioBlob.arrayBuffer();
    
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./mp3-encoder.worker.js', import.meta.url), { type: 'module' });
        
        worker.onmessage = (e) => {
            const { type, blob, message, stage, progress } = e.data;
            
            if (type === 'complete') {
                worker.terminate();
                resolve(blob);
            } else if (type === 'error') {
                worker.terminate();
                reject(new Error(message));
            } else if (type === 'progress' && onProgress) {
                onProgress({ stage, message, progress });
            } else if (type === 'log') {
                console.log('[FFmpeg]', message);
            }
        };
        
        worker.onerror = (error) => {
            worker.terminate();
            reject(new Error('Worker failed: ' + error.message));
        };
        
        // Transfer audio data to worker
        worker.postMessage({
            audioData
        }, [audioData]);
    });
}

export async function encodeToMp3(audioBlob, onProgress = null) {
    try {
        // Use Web Worker for non-blocking FFmpeg encoding
        if (typeof Worker !== 'undefined') {
            return await encodeToMp3Worker(audioBlob, onProgress);
        }
        
        throw new Error('Web Workers are required for MP3 encoding');
    } catch (error) {
        console.error('MP3 encoding failed:', error);
        throw new Error('Failed to encode MP3: ' + error.message);
    }
}
