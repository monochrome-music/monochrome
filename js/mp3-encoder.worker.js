import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

let ffmpeg = null;
let isLoaded = false;

async function loadFFmpeg() {
    if (isLoaded) return;
    
    ffmpeg = new FFmpeg();
    
    ffmpeg.on('log', ({ message }) => {
        self.postMessage({ type: 'log', message });
    });
    
    ffmpeg.on('progress', ({ progress, time }) => {
        self.postMessage({ 
            type: 'progress', 
            stage: 'encoding', 
            progress: progress * 100,
            time 
        });
    });
    
    self.postMessage({ type: 'progress', stage: 'loading', message: 'Loading FFmpeg...' });
    
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
    await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm')
    });
    
    isLoaded = true;
}

self.onmessage = async (e) => {
    const { audioData } = e.data;
    
    try {
        await loadFFmpeg();
        
        self.postMessage({ type: 'progress', stage: 'encoding', message: 'Encoding to MP3 320kbps...' });
        
        // Write input file to FFmpeg virtual filesystem
        await ffmpeg.writeFile('input', new Uint8Array(audioData));
        
        // Encode to MP3 with 320kbps CBR (FFmpeg auto-detects input format)
        await ffmpeg.exec([
            '-i', 'input',
            '-c:a', 'libmp3lame',
            '-b:a', '320k',
            '-ar', '44100',
            'output.mp3'
        ]);
        
        self.postMessage({ type: 'progress', stage: 'finalizing', message: 'Finalizing MP3...' });
        
        // Read output file
        const data = await ffmpeg.readFile('output.mp3');
        const mp3Blob = new Blob([data.buffer], { type: 'audio/mpeg' });
        
        // Cleanup
        await ffmpeg.deleteFile('input');
        await ffmpeg.deleteFile('output.mp3');
        
        self.postMessage({ type: 'complete', blob: mp3Blob });
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message });
    }
};
