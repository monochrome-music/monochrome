export class FfmpegProgress implements MonochromeProgress {
    constructor(
        public readonly stage: 'loading' | 'parsing' | 'encoding' | 'finalizing' | 'stdout',
        public readonly progress: number,
        public readonly message?: string
    ) {}
}
