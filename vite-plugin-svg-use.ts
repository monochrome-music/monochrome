import { normalizePath, type Plugin, type ResolvedConfig } from 'vite';
import path from 'path';
import fs from 'fs';
import { optimize } from 'svgo';

const virtualModuleId = 'svg-merge-attributes';

/**
 * Regex for matching attributes inside a tag
 */
const ATTR_REGEX = /([a-z0-9_-]+)="([^"]*)"/gim;

/**
 * Regex for matching <use svg="file.svg" ... />
 */
const SVG_USE_REGEX = /<use\s+([^>]*?)svg="([^"]+\.svg)"([^>]*)\/?>/gim;

/**
 * Parse attribute string to object
 */
function parseAttrs(str: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [, name, value] of str.matchAll(ATTR_REGEX)) {
        out[name] = value;
    }
    return out;
}

/**
 * Merge attributes into root <svg>
 */
function mergeSvgAttributes(svg: string, attrs: Record<string, string>) {
    return svg.replace(/<svg([^>]*)>/i, (_match, existingAttrs: string | undefined) => {
        // Size is shorthand for setting both width and height to the same value
        if (attrs['size']) {
            attrs['width'] = attrs['size'];
            attrs['height'] = attrs['size'];
            delete attrs['size'];
        }

        const map = new Map<string, string>();

        for (const [, name, value] of (existingAttrs ?? '').matchAll(ATTR_REGEX)) {
            map.set(name, value);
        }

        for (const [k, v] of Object.entries(attrs)) {
            // optional: merge class and style
            if (k === 'class' && map.has('class')) {
                map.set('class', map.get('class') + ' ' + v);
            } else if (k === 'style' && map.has('style')) {
                map.set('style', map.get('style') + ';' + v);
            } else {
                map.set(k, v);
            }
        }

        const merged = [...map.entries()].map(([k, v]) => `${k}="${v}"`).join(' ');
        return `<svg ${merged}>`;
    });
}

function getResizer(base: string, params: string) {
    const cache: Record<string, string> = {};

    return function getIcon(size: number, attrs: Record<string, string> = {}) {
        const attributes = {
            ...getParams(params),
            ...attrs,
            height: size.toString(),
            width: size.toString(),
        };
        return (cache[JSON.stringify(attributes)] ??= mergeSvgAttributes(base, attributes));
    };
}

function getParams(str: string): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(str).entries());
}

/**
 * Load SVG content from disk
 */
function loadSvg<S extends boolean = true, T = S extends true ? string : Promise<string>>(
    filePath: string,
    sync: S = true as S
): T {
    if (sync) {
        return fs.readFileSync(filePath, 'utf-8') as T;
    }

    return new Promise<string>((resolve, reject) => {
        fs.readFile(filePath, { encoding: 'utf-8' }, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    }) as T;
}

/**
 * Main plugin
 */
export default function viteSvgUsePlugin(): Plugin {
    let config: ResolvedConfig;
    const watched = new Set<string>();

    /**
     * Resolve path
     */
    function resolveSvg(root: string, importer: string, src: string) {
        // Handle Vite aliases
        if (src.startsWith('.')) {
            return normalizePath(path.resolve(path.dirname(importer), src));
        }
        // Check for alias
        if (config && config.resolve && config.resolve.alias) {
            for (const [_, { find, replacement }] of config.resolve.alias.entries()) {
                if (typeof find === 'string' ? src.startsWith(find) : find.test(src)) {
                    // Remove alias prefix and resolve
                    const aliasedPath = src.replace(find, replacement);
                    return normalizePath(path.resolve(root, aliasedPath.replace(/^\//, '')));
                }
            }
        }
        return normalizePath(path.resolve(root, src.replace(/^\//, '')));
    }

    return {
        name: 'vite-svg-use-plugin',
        enforce: 'pre',

        configResolved(resolvedConfig) {
            config = resolvedConfig;
        },

        /**
         * HTML transform
         */
        transformIndexHtml: {
            order: 'pre',
            async handler(html, ctx) {
                return html.replace(
                    SVG_USE_REGEX,
                    (_full, before: string | undefined, src: string | undefined, after: string | undefined) => {
                        const attrs = {
                            ...parseAttrs(before || ''),
                            ...parseAttrs(after || ''),
                        };

                        delete attrs['use'];

                        const filePath = resolveSvg(config.root, ctx.filename || '', src);

                        watched.add(filePath);

                        let svg = loadSvg(filePath);
                        svg = mergeSvgAttributes(optimize(svg).data, attrs);

                        return svg;
                    }
                );
            },
        },

        /** Resolve virtual modules */
        resolveId(id) {
            if (id == virtualModuleId) {
                return id;
            }

            return null;
        },

        /** Load virtual modules */
        async load(id) {
            if (id === virtualModuleId) {
                return [
                    `const ATTR_REGEX = ${ATTR_REGEX};`,
                    `export ${getParams.toString()}`,
                    `export ${mergeSvgAttributes.toString()}`,
                    `export ${getResizer.toString()}`,
                ].join('\n');
            }

            if (id.includes('?svg')) {
                const [file, queryString] = id.split('?');
                const params = new URLSearchParams(queryString);
                const absPath = path.resolve(file);

                // Derived module: import base and merge attributes
                params.delete('svg');

                if (params.size === 0) {
                    // No attributes to merge, just return raw content
                    watched.add(absPath);

                    // Read and return the SVG content directly as a string export
                    const svgContent = optimize(await loadSvg(absPath, false)).data;
                    return `export default ${JSON.stringify(svgContent)};`;
                }

                const baseImport = file + '?svg';

                if (params.has('icon')) {
                    params.delete('icon');
                    return [
                        `import base from ${JSON.stringify(baseImport)};`,
                        `import { getResizer } from ${JSON.stringify(virtualModuleId)};`,
                        `export default getResizer(base, ${JSON.stringify(params.toString())});`,
                    ].join('\n');
                }

                return [
                    `import base from ${JSON.stringify(baseImport)};`,
                    `import { getParams, mergeSvgAttributes } from ${JSON.stringify(virtualModuleId)};`,
                    `export default mergeSvgAttributes(base, getParams(${JSON.stringify(params.toString())}));`,
                ].join('\n');
            }
        },

        /**
         * HMR support
         */
        handleHotUpdate({ file, server }) {
            if (watched.has(normalizePath(file))) {
                server.ws.send({
                    type: 'full-reload',
                });
            }
        },
    };
}
