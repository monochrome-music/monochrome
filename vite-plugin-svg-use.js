import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

/**
 * vite-plugin-svg-use
 * Handles ?svg&icon imports - transforms SVG files into functions that return
 * SVG strings with optional size parameter: (size?: number) => string
 */
export default function svgUsePlugin() {
  return {
    name: 'vite-plugin-svg-use',
    enforce: 'pre',
    load(id) {
      if (!id.includes('?svg&icon')) return;
      const filePath = id.split('?')[0];
      try {
        const svgContent = readFileSync(filePath, 'utf-8');
        // Extract the SVG inner content and attributes
        const sizeAttrRegex = /\s*(width|height)="[^"]*"/g;
        const cleanedSvg = svgContent
          .replace(sizeAttrRegex, '')
          .replace(/<svg/, '<svg class="svg-icon"');
        // Return a function that injects width/height
        const code = `
const svgStr = ${JSON.stringify(cleanedSvg)};
export default function(size) {
  if (!size) return svgStr;
  return svgStr.replace('<svg ', '<svg width="' + size + '" height="' + size + '" ');
};
`;
        return { code, map: null };
      } catch (e) {
        // If file cannot be read, return empty function
        return {
          code: 'export default function(size) { return \'\'; };',
          map: null
        };
      }
    },
    resolveId(id, importer) {
      if (!id.includes('?svg&icon')) return;
      const [filePath] = id.split('?');
      // Resolve relative to importer
      if (importer && !filePath.startsWith('/')) {
        const importerDir = dirname(fileURLToPath(importer.startsWith('file://') ? importer : 'file://' + importer));
        const resolved = resolve(importerDir, filePath);
        return resolved + '?svg&icon';
      }
      return id;
    }
  };
}
