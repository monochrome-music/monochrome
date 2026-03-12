declare module '*?url' {
    const content: string;
    export default content;
}

declare module '*?blob-url' {
    const urlPromise: () => Promise<string>;
    export default urlPromise;
}

declare module 'https://cdn.jsdelivr.net/npm/client-zip@2.4.5/+esm' {
    /** Creates a ZIP stream from an async iterable of file entries. */
    export function downloadZip(files: AsyncIterable<object>): Response;
}
