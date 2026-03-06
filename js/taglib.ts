import { TagLib } from 'taglib-wasm';
import { fetchBlobURL } from './utils';
import _TagLibWasm from '!/taglib-wasm/dist/taglib-web.wasm?url';

let tagLib: Promise<TagLib> | null = null;

export async function initTagLib(): Promise<TagLib> {
    if (tagLib) return await tagLib;

    const TagLibWasm = await fetchBlobURL(_TagLibWasm);

    tagLib = TagLib.initialize({
        wasmUrl: TagLibWasm,
    });

    console.log('TagLib initialized', { tagLib: await tagLib, TagLibWasm });

    return await tagLib;
}
