import { doTimed, doTimedAsync } from './doTimed';
import type {
    AddMetadataMessage,
    TagLibFileResponse,
    TagLibMetadataResponse,
    TagLibReadMetadata,
    TagLibReadTypes,
    TagLibWriteTypes,
} from './taglib.types';
import TagLibWorker from './taglib.worker?worker';

export async function withTimeout<T>(callback: () => Promise<T>, timeout: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Operation timed out after ${timeout} ms`));
        }, timeout);

        callback()
            .then((result) => {
                clearTimeout(timer);
                resolve(result);
            })
            .catch((err) => {
                clearTimeout(timer);
                if (err instanceof Error) {
                    reject(err);
                } else {
                    reject(new Error(String(err)));
                }
            });
    });
}

function toUint8Array(audioData: ArrayBufferLike | Uint8Array) {
    if (audioData instanceof Uint8Array) {
        return audioData;
    }

    return doTimed(
        `Converting audio data (${(audioData as object)?.constructor?.name}) to Uint8Array`,
        () => new Uint8Array(audioData)
    );
}

async function convertInputToTaglib<R = TagLibReadTypes>(
    audioData: TagLibReadTypes | TagLibWriteTypes,
    direct: boolean = false
): Promise<R> {
    if ('FileSystemFileEntry' in globalThis && audioData instanceof FileSystemFileEntry) {
        audioData = await doTimedAsync('Getting File from FileSystemFileEntry', async () => {
            const file = await new Promise<File>((resolve) =>
                (audioData as FileSystemFileEntry).file((f) => resolve(f))
            );
            return toUint8Array(new Uint8Array(await file.arrayBuffer()));
        });
    }

    if ((audioData instanceof Blob || audioData instanceof File) && !direct) {
        return (await doTimedAsync(
            `Reading ${audioData instanceof File ? 'File' : 'Blob'} as Uint8Array`,
            async () => new Uint8Array(await audioData.arrayBuffer())
        )) as R;
    } else if ('FileSystemFileHandle' in globalThis && audioData instanceof FileSystemFileHandle && !direct) {
        return (await doTimedAsync('Reading File from FileSystemHandle as Uint8Array', async () => {
            const file = await audioData.getFile();
            const arrayBuffer = await file.arrayBuffer();
            return toUint8Array(arrayBuffer);
        })) as R;
    } else if (
        !(audioData instanceof Uint8Array) &&
        !(audioData instanceof Blob) &&
        !(audioData instanceof File) &&
        !('FileSystemFileEntry' in globalThis && audioData instanceof FileSystemFileEntry) &&
        !('FileSystemFileHandle' in globalThis && audioData instanceof FileSystemFileHandle)
    ) {
        return toUint8Array(audioData as unknown as ArrayBufferLike) as R;
    }

    return audioData as R;
}

const workerModule = import('./taglib.worker.js');

export async function addMetadataWithTagLib(
    audioData: TagLibWriteTypes,
    data: Omit<AddMetadataMessage, 'type' | 'audioData'>,
    filename?: string,
    direct: boolean = false,
    returnBlob: boolean = false,
    timeout: number = 10000
) {
    audioData = await convertInputToTaglib(audioData, direct);

    if (direct) {
        const { addMetadataToAudio } = await workerModule;

        return await doTimedAsync('Adding metadata with taglib-ts (direct)', () =>
            addMetadataToAudio({
                ...data,
                filename,
                audioData,
                returnType: returnBlob && direct ? 'blob' : 'uint8array',
            })
        );
    } else {
        const worker = new TagLibWorker();

        try {
            return await doTimedAsync(
                'Adding metadata with taglib-ts (worker)',
                async () =>
                    await withTimeout(
                        () =>
                            new Promise<Uint8Array>((resolve, reject) => {
                                worker.onmessage = (e: MessageEvent<TagLibFileResponse>) => {
                                    const { data, error } = e.data;

                                    if (error) {
                                        reject(new Error(error));
                                    } else {
                                        resolve(data);
                                    }
                                };
                                worker.onerror = reject;
                                worker.onmessageerror = reject;

                                const transferables: Transferable[] = [];
                                if ((audioData as Uint8Array)?.buffer instanceof ArrayBuffer) {
                                    transferables.push((audioData as Uint8Array).buffer);
                                }

                                if (data.cover?.data?.buffer instanceof ArrayBuffer) {
                                    transferables.push(data.cover.data.buffer);
                                }

                                worker.postMessage({ ...data, type: 'Add', audioData, filename }, transferables);
                            }),
                        timeout
                    )
            );
        } finally {
            worker.terminate();
        }
    }
}

export async function getMetadataWithTagLib(
    audioData: TagLibReadTypes,
    filename?: string,
    direct: boolean = false,
    timeout: number = 10000
) {
    audioData = await convertInputToTaglib<TagLibReadTypes>(audioData, direct);

    if (direct) {
        const { getMetadataFromAudio } = await workerModule;

        return await doTimedAsync('Getting metadata with taglib-ts (direct)', () =>
            getMetadataFromAudio({ filename, audioData })
        );
    } else {
        const worker = new TagLibWorker();

        try {
            return await doTimedAsync('Getting metadata with taglib-ts (worker)', () =>
                withTimeout(
                    () =>
                        new Promise<TagLibReadMetadata>((resolve, reject) => {
                            worker.onmessage = (e: MessageEvent<TagLibMetadataResponse>) => {
                                const { data, error } = e.data;

                                if (error) {
                                    reject(new Error(error));
                                } else {
                                    resolve(data);
                                }
                            };
                            worker.onerror = reject;
                            worker.onmessageerror = reject;

                            const transferables: Transferable[] = [];
                            if ((audioData as Uint8Array)?.buffer instanceof ArrayBuffer) {
                                transferables.push((audioData as Uint8Array).buffer);
                            }
                            worker.postMessage({ type: 'Get', audioData, filename }, transferables);
                        }),
                    timeout
                )
            );
        } finally {
            worker.terminate();
        }
    }
}
