export class FfmpegProgress implements MonochromeProgress {
    constructor(
        public readonly stage: 'loading' | 'encoding' | 'finalizing',
        public readonly progress: number,
        public readonly message?: string
    ) {}
}
