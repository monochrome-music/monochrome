import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

/**
 * vite-plugin-blob
 * Handles ?blob imports - transforms asset files into base64 data URLs.
 * Useful for embedding assets inline (e.g. for Neutralino desktop app).
 */
export default function blobAssetPlugin() {
  return {
    name: 'vite-plugin-blob',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!id.includes('?blob')) return;
      const [filePath] = id.split('?');
      if (importer && !filePath.startsWith('/')) {
        const importerPath = importer.startsWith('file://')
          ? fileURLToPath(importer)
          : importer;
        const importerDir = dirname(importerPath);
        const resolved = resolve(importerDir, filePath);
        return resolved + '?blob';
      }
      return id;
    },
    load(id) {
      if (!id.includes('?blob')) return;
      const filePath = id.split('?')[0];
      try {
        const content = readFileSync(filePath);
        const base64 = content.toString('base64');
        const ext = filePath.split('.').pop().toLowerCase();
        const mimeMap = {
          mp3: 'audio/mpeg',
          ogg: 'audio/ogg',
          wav: 'audio/wav',
          flac: 'audio/flac',
          mp4: 'video/mp4',
          webm: 'video/webm',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          svg: 'image/svg+xml',
          webp: 'image/webp',
          woff: 'font/woff',
          woff2: 'font/woff2',
          ttf: 'font/ttf',
          eot: 'application/vnd.ms-fontobject',
        };
        const mime = mimeMap[ext] || 'application/octet-stream';
        const dataUrl = 'data:' + mime + ';base64,' + base64;
        return { code: 'export default ' + JSON.stringify(dataUrl) + ';', map: null };
      } catch (e) {
        return { code: "export default '';", map: null };
      }
    },
  };
}
