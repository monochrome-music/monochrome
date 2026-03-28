declare module '*?url' {
    const content: string;
    export default content;
}

declare module '*?blob-url' {
    const urlPromise: () => Promise<string>;
    export default urlPromise;
}

declare module '*?svg&icon' {
    const resize: (size: number, attrs?: Record<string, string>) => string;
    export default resize;
}

declare module '*?svg&icon&class=heart-icon' {
    const resize: (size: number, attrs?: Record<string, string>) => string;
    export default resize;
}

declare module '*?svg&icon&class=heart-icon+filled' {
    const resize: (size: number, attrs?: Record<string, string>) => string;
    export default resize;
}

declare module 'https://cdn.jsdelivr.net/npm/client-zip@2.4.5/+esm' {
    /** Creates a ZIP stream from an async iterable of file entries. */
    export function downloadZip(files: AsyncIterable<object>): Response;
}

type WithRequiredKeys<T> = {
    [K in keyof T]-?: T[K] | undefined;
};

declare global {
    const __COMMIT_HASH__: string | undefined;
}
