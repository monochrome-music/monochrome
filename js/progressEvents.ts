declare global {
    type MonochromeProgress<T = object> = {
        stage: string;
    } & T;

    type MonochromeProgressMessage<_T = MonochromeProgress> = {
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

export class SegmentedDownloadProgress extends DownloadProgress {
    public readonly stage = 'downloading';

    constructor(
        public readonly receivedBytes: number,
        public readonly totalBytes: number | undefined,
        public readonly currentSegment: number,
        public readonly totalSegments: number
    ) {
        super(receivedBytes, totalBytes);
    }
}

export class ProgressMessage implements MonochromeProgressMessage {
    constructor(public readonly message: string) {}
}

export class DownloadProgressMessage extends ProgressMessage {
    constructor(message: string) {
        super(message);
    }
}
