import { TagLib as _TagLib } from 'taglib-wasm';

/**
 * @type {typeof import('taglib-wasm').TagLib}
 */
export const TagLib = _TagLib;
import TagLibWasm from '!/taglib-wasm/dist/taglib-web.wasm?url';

export { TagLibWasm };

let tagLib = null;
const wasmBinary = fetch(TagLibWasm).then((r) => r.arrayBuffer());

/**
 *
 * @returns {ReturnType<typeof TagLib.initialize>}
 */
export async function initTagLib() {
    if (tagLib) return await tagLib;

    tagLib = TagLib.initialize({
        wasmBinary: await wasmBinary,
        legacyMode: true,
    });

    console.log('TagLib initialized', { tagLib: await tagLib, TagLibWasm });

    return await tagLib;
}
