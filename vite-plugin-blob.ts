import fs from 'fs/promises';
import path from 'path';
import { gzipSync, constants as zlibConstants } from 'zlib';
import type { Plugin, ResolvedConfig } from 'vite';
import mime from 'mime';
import { createHash } from 'crypto';

function hashString(input: string, algorithm = 'sha256'): string {
    return createHash(algorithm)
        .update(input, 'utf8') // specify string encoding
        .digest('hex'); // return as hex
}

/**
 * Vite plugin enabling `?blob-url` imports.
 *
 * Example:
 *   import getBlobUrl from "./file.bin?blob-url";
 *   const blobUrl = await getBlobUrl();
 *
 * Behavior:
 *  - Compresses the asset using max gzip compression
 *  - Build: emits compressed asset
 *  - Dev: serves compressed asset from middleware
 *  - Runtime fetches + decompresses it and returns an object URL
 */
export default function blobAssetPlugin(): Plugin {
    const devAssets = new Map<string, Buffer>();
    let resolvedConfig: ResolvedConfig | null = null;

    return {
        name: 'vite-blob-asset',

        async configResolved(config: ResolvedConfig) {
            resolvedConfig = config;
        },
        async load(id) {
            if (!id.includes('?blob-url')) return;

            const [filepath] = id.split('?');
            const absPath = path.resolve(filepath);

            const input = await fs.readFile(absPath);

            /** gzip with maximum compression */
            const compressed = gzipSync(input, {
                level: zlibConstants.Z_BEST_COMPRESSION,
            });

            let assetUrl: string;

            if (resolvedConfig?.command === 'serve') {
                /** dev server path */
                assetUrl = `/@blob/${hashString(absPath)}/${path.basename(filepath)}.gz`;
                devAssets.set(assetUrl, compressed);
            } else {
                /** build asset */
                const refId = this.emitFile({
                    type: 'asset',
                    name: path.basename(filepath) + '.gz',
                    source: compressed,
                });

                assetUrl = `__BLOB_ASSET_${refId}__`;
            }

            return `
/**
 * Decompress gzip data using browser DecompressionStream
 */
async function decompress(buffer) {
  const ds = new DecompressionStream("gzip");
  const stream = new Response(buffer).body.pipeThrough(ds);
  return new Response(stream).arrayBuffer();
}

let blobPromise = null;

export default function getBlobUrl() {
  if (blobPromise) return blobPromise;
  
  return blobPromise = (async () => {
    try {
        const res = await fetch(${JSON.stringify(assetUrl)});
        const compressed = await res.arrayBuffer();

        const decompressed = await decompress(compressed);

        const blob = new Blob([decompressed], ${JSON.stringify({
            type: mime.getType(filepath),
        })});
        return URL.createObjectURL(blob);
    } catch (err) {
        console.error("Error loading blob asset:", err);
        blobPromise = null;
        throw err;
    }
  })()
}
`;
        },

        resolveFileUrl({ referenceId }) {
            return `"${this.getFileName(referenceId)}"`;
        },

        generateBundle(_, bundle) {
            for (const chunk of Object.values(bundle)) {
                if (chunk.type !== 'chunk') continue;

                chunk.code = chunk.code.replace(
                    /"__BLOB_ASSET_(.*?)__"/g,
                    (_, refId: string) => `"${this.getFileName(refId)}"`
                );
            }
        },

        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (!req.url?.startsWith('/@blob/')) return next();

                const data = devAssets.get(req.url);
                if (!data) return next();

                res.setHeader('Content-Type', 'application/gzip');
                res.end(data);
            });
        },
    };
}
