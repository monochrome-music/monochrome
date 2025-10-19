export class MetadataEmbedder {
    constructor() {
        this.ffmpegLoaded = false;
        this.ffmpeg = null;
        this.fetchFile = null;
    }

    async loadFFmpeg() {
        if (this.ffmpegLoaded) return;

        try {
            console.log('[FFmpeg] Loading FFmpeg...');
            
            if (typeof FFmpegWASM === 'undefined' || typeof FFmpegUtil === 'undefined') {
                throw new Error('FFmpeg libraries not loaded. Please check your internet connection.');
            }

            const { FFmpeg } = FFmpegWASM;
            const { fetchFile } = FFmpegUtil;

            this.ffmpeg = new FFmpeg();
            this.fetchFile = fetchFile;
            
            this.ffmpeg.on('log', ({ message }) => {
                console.log('[FFmpeg]', message);
            });

            const baseURL = window.location.origin + '/ffmpeg';
            
            await this.ffmpeg.load({
                coreURL: `${baseURL}/ffmpeg-core.js`,
                wasmURL: `${baseURL}/ffmpeg-core.wasm`
            });

            this.ffmpegLoaded = true;
            console.log('[FFmpeg] Loaded successfully');
        } catch (error) {
            console.error('[FFmpeg] Failed to load:', error);
            throw error;
        }
    }

    async embedMetadata(audioBlob, track, coverImageUrl, onProgress) {
        console.log('[Metadata] Starting embedding for:', track.title);
        
        if (!this.ffmpegLoaded) {
            try {
                await this.loadFFmpeg();
            } catch (error) {
                console.error('[Metadata] Cannot load FFmpeg, skipping metadata:', error);
                return audioBlob;
            }
        }

        if (!this.ffmpeg || !this.fetchFile) {
            console.error('[Metadata] FFmpeg not properly initialized');
            return audioBlob;
        }

        const inputName = 'input.flac';
        const coverName = 'cover.jpg';
        const outputName = 'output.flac';

        try {
            const arrayBuffer = await audioBlob.arrayBuffer();
            await this.ffmpeg.writeFile(inputName, new Uint8Array(arrayBuffer));
            console.log('[Metadata] Wrote input file:', inputName, 'size:', arrayBuffer.byteLength);

            let hasCover = false;
            if (coverImageUrl) {
                try {
                    console.log('[Metadata] Fetching cover from:', coverImageUrl);
                    const coverData = await this.fetchFile(coverImageUrl);
                    await this.ffmpeg.writeFile(coverName, coverData);
                    hasCover = true;
                    console.log('[Metadata] Cover image written successfully, size:', coverData.length);
                } catch (coverError) {
                    console.warn('[Metadata] Failed to fetch cover image:', coverError);
                }
            }

            const metadata = this.buildMetadataArgs(track);
            console.log('[Metadata] Building metadata with', metadata.length / 2, 'fields');
            
            let args;
            if (hasCover) {
                args = [
                    '-i', inputName,
                    '-i', coverName,
                    '-map', '0:a',
                    '-map', '1',
                    '-c:a', 'copy',
                    '-c:v', 'copy',
                    ...metadata,
                    '-metadata:s:v', 'title=Album cover',
                    '-metadata:s:v', 'comment=Cover (front)',
                    '-disposition:v', 'attached_pic',
                    outputName
                ];
            } else {
                args = [
                    '-i', inputName,
                    ...metadata,
                    '-c:a', 'copy',
                    outputName
                ];
            }

            console.log('[Metadata] Executing FFmpeg...');

            if (onProgress) {
                this.ffmpeg.on('progress', ({ progress }) => {
                    onProgress(progress);
                });
            }

            await this.ffmpeg.exec(args);
            console.log('[Metadata] FFmpeg exec completed successfully');

            const outputData = await this.ffmpeg.readFile(outputName);
            const outputBlob = new Blob([outputData], { type: 'audio/flac' });
            console.log('[Metadata] ✓ Success! Input:', arrayBuffer.byteLength, 'bytes → Output:', outputBlob.size, 'bytes');

            await this.ffmpeg.deleteFile(inputName);
            await this.ffmpeg.deleteFile(outputName);
            if (hasCover) {
                await this.ffmpeg.deleteFile(coverName);
            }
            console.log('[Metadata] Cleanup complete');

            return outputBlob;
        } catch (error) {
            console.error('[Metadata] ✗ Embedding failed:', error);
            console.error('[Metadata] Error details:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            return audioBlob;
        }
    }

    buildMetadataArgs(track) {
        const args = [];
        
        if (track.title) {
            args.push('-metadata', `title=${this.escapeMetadata(track.title)}`);
        }
        
        if (track.artist?.name) {
            args.push('-metadata', `artist=${this.escapeMetadata(track.artist.name)}`);
        }
        
        if (track.album?.title) {
            args.push('-metadata', `album=${this.escapeMetadata(track.album.title)}`);
        }
        
        if (track.album?.artist?.name) {
            args.push('-metadata', `album_artist=${this.escapeMetadata(track.album.artist.name)}`);
        }
        
        if (track.trackNumber) {
            const trackNum = Number(track.trackNumber);
            if (Number.isFinite(trackNum) && trackNum > 0) {
                const totalTracks = track.album?.numberOfTracks;
                if (totalTracks && Number.isFinite(totalTracks) && totalTracks > 0) {
                    args.push('-metadata', `track=${trackNum}/${totalTracks}`);
                } else {
                    args.push('-metadata', `track=${trackNum}`);
                }
            }
        }
        
        if (track.volumeNumber) {
            const discNum = Number(track.volumeNumber);
            if (Number.isFinite(discNum) && discNum > 0) {
                const totalDiscs = track.album?.numberOfVolumes;
                if (totalDiscs && Number.isFinite(totalDiscs) && totalDiscs > 0) {
                    args.push('-metadata', `disc=${discNum}/${totalDiscs}`);
                } else {
                    args.push('-metadata', `disc=${discNum}`);
                }
            }
        }
        
        if (track.album?.releaseDate) {
            const year = new Date(track.album.releaseDate).getFullYear();
            if (!isNaN(year)) {
                args.push('-metadata', `date=${year}`);
                args.push('-metadata', `year=${year}`);
            }
        }

        if (track.album?.upc) {
            args.push('-metadata', `barcode=${track.album.upc}`);
        }

        if (track.isrc) {
            args.push('-metadata', `isrc=${track.isrc}`);
        }

        args.push('-metadata', 'comment=https://monochrome.tf/');

        return args;
    }

    escapeMetadata(value) {
        return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }
}