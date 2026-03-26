export class FfmpegProgress implements MonochromeProgress {
    constructor(
        public readonly stage: 'loading' | 'encoding' | 'finalizing' | 'stdout',
        public readonly progress: number,
        public readonly message?: string
    ) {}
}
