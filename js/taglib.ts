import { TagLib } from 'taglib-wasm';
import { fetchBlobURL } from './utils';
import _TagLibWasm from '!/taglib-wasm/dist/taglib-web.wasm?url';
import type {
    TagLibWorkerMessageType,
    AddMetadataMessage,
    GetMetadataMessage,
    TagLibFileResponse,
    TagLibMetadataResponse,
    TagLibMetadata,
    TagLibReadMetadata,
} from './taglib.types';
import TagLibWorker from './taglib.worker?worker';

let tagLib: Promise<TagLib> | null = null;

async function fetchTagLib(): Promise<string> {
    return fetchTagLib.blobUrl || (fetchTagLib.blobUrl = await fetchBlobURL(_TagLibWasm));
}

namespace fetchTagLib {
    export let blobUrl = '';
}

export { fetchTagLib };

export async function addMetadataWithTagLib(
    audioData: Uint8Array,
    data: Omit<AddMetadataMessage, 'type' | 'wasmUrl' | 'audioData'>
) {
    if (!(audioData instanceof Uint8Array)) {
        audioData = new Uint8Array(audioData);
    }

    const worker = new TagLibWorker();
    const wasmUrl = await fetchTagLib();

    return new Promise<Uint8Array>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<TagLibFileResponse>) => {
            const { data, error } = e.data;

            if (error) {
                reject(new Error(error));
            } else {
                resolve(data!);
            }
        };
        worker.onerror = reject;
        worker.onmessageerror = reject;

        const transferables: Transferable[] = [audioData.buffer];
        if ((data as any).cover?.data?.buffer instanceof ArrayBuffer) {
            transferables.push((data as any).cover.data.buffer);
        }

        worker.postMessage({ ...data, type: 'Add', wasmUrl, audioData }, transferables);
    });
}

export async function getMetadataWithTagLib(audioData: Uint8Array) {
    if (!(audioData instanceof Uint8Array)) {
        audioData = new Uint8Array(audioData);
    }

    const worker = new Worker(new URL(TagLibWorker, import.meta.url), { type: 'module' });
    const wasmUrl = await fetchTagLib();

    return new Promise<TagLibReadMetadata>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<TagLibMetadataResponse>) => {
            const { data, error } = e.data;

            if (error) {
                reject(new Error(error));
            } else {
                resolve(data!);
            }
        };
        worker.onerror = reject;
        worker.onmessageerror = reject;
        worker.postMessage({ type: 'Get', wasmUrl, audioData }, [audioData.buffer]);
    });
}
