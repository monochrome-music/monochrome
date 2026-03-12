declare global {
    type MonochromeProgress<T = {}> = {
        stage: string;
    } & T;

    type MonochromeProgressMessage<T = MonochromeProgress> = {
        message: string;
    };

    type MonochromeProgressListener<T = MonochromeProgress> = (progress: T) => void;
}

export class DownloadProgress implements MonochromeProgress {
    public readonly stage = 'downloading';

    constructor(
        public readonly receivedBytes: number,
        public readonly totalBytes: number | undefined
    ) {}
}
