// js/autoeq-importer.js
// Headphone Database Browser - Fetches from AutoEq GitHub repository
// Provides access to 4000+ headphone measurement profiles

import { parseRawData } from './autoeq-data.js';

const CACHE_KEY = 'monochrome_autoeq_index_v2';
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// Static fallback list in case GitHub API fails
const FALLBACK_INDEX = [
    { name: 'Sennheiser HD 600 (crinacle)', type: 'over-ear', path: 'crinacle/gras_43ag-7_harman_over-ear_2018/Sennheiser HD 600', fileName: 'Sennheiser HD 600.csv' },
    { name: 'Sennheiser HD 650 (crinacle)', type: 'over-ear', path: 'crinacle/gras_43ag-7_harman_over-ear_2018/Sennheiser HD 650', fileName: 'Sennheiser HD 650.csv' },
    { name: 'Sennheiser HD 800 S (crinacle)', type: 'over-ear', path: 'crinacle/gras_43ag-7_harman_over-ear_2018/Sennheiser HD 800 S', fileName: 'Sennheiser HD 800 S.csv' },
    { name: 'Beyerdynamic DT 770 Pro 80 Ohm (oratory1990)', type: 'over-ear', path: 'oratory1990/harman_over-ear_2018/Beyerdynamic DT 770 Pro 80 Ohm', fileName: 'Beyerdynamic DT 770 Pro 80 Ohm.csv' },
    { name: 'Moondrop Blessing 2 Dusk (crinacle)', type: 'in-ear', path: 'crinacle/harman_in-ear_2019v2/Moondrop Blessing 2 Dusk', fileName: 'Moondrop Blessing 2 Dusk.csv' },
    { name: 'Apple AirPods Pro 2 (crinacle)', type: 'in-ear', path: 'crinacle/harman_in-ear_2019v2/Apple AirPods Pro 2', fileName: 'Apple AirPods Pro 2.csv' },
    { name: 'Sony WH-1000XM5 (crinacle)', type: 'over-ear', path: 'crinacle/gras_43ag-7_harman_over-ear_2018/Sony WH-1000XM5', fileName: 'Sony WH-1000XM5.csv' },
    { name: 'HiFiMAN Sundara (oratory1990)', type: 'over-ear', path: 'oratory1990/harman_over-ear_2018/HiFiMAN Sundara', fileName: 'HiFiMAN Sundara.csv' },
];

/**
 * Fetch the full AutoEq headphone index from GitHub
 * Uses GitHub API to get the repository tree, then parses it for measurement files
 * Caches results in localStorage for 24 hours
 * @returns {Promise<Array<{name: string, type: string, path: string, fileName: string}>>}
 */
async function fetchAutoEqIndex() {
    // 1. Try loading from cache
    try {
        const cachedRaw = localStorage.getItem(CACHE_KEY);
        if (cachedRaw) {
            const { timestamp, data } = JSON.parse(cachedRaw);
            if (Date.now() - timestamp < CACHE_EXPIRY) {
                console.log('[AutoEQ] Loaded index from cache');
                return data;
            }
        }
    } catch (e) {
        console.warn('[AutoEQ] Failed to read cache:', e);
    }

    // 2. Fetch from GitHub API
    try {
        console.log('[AutoEQ] Fetching index from GitHub...');
        const response = await fetch('https://api.github.com/repos/jaakkopasanen/AutoEq/git/trees/master?recursive=1');

        if (!response.ok) {
            const cachedRaw = localStorage.getItem(CACHE_KEY);
            if (cachedRaw) {
                console.warn('[AutoEQ] GitHub API limit reached. Using stale cache.');
                return JSON.parse(cachedRaw).data;
            }
            console.warn('[AutoEQ] GitHub API error. Using fallback.');
            return FALLBACK_INDEX;
        }

        const data = await response.json();
        const entries = [];

        for (const item of data.tree) {
            if (item.path.startsWith('results/') && (item.path.endsWith('.csv') || item.path.endsWith('.txt'))) {
                const parts = item.path.split('/');
                if (parts.length >= 4) {
                    const fileName = parts.pop();
                    const headphoneName = parts[parts.length - 1];
                    const folderPath = parts.slice(1).join('/');
                    const source = parts[1];

                    let type = 'over-ear';
                    const lowerPath = item.path.toLowerCase();
                    if (lowerPath.includes('in-ear') || lowerPath.includes('iem')) {
                        type = 'in-ear';
                    } else if (lowerPath.includes('earbud')) {
                        type = 'in-ear';
                    }

                    entries.push({
                        name: `${headphoneName} (${source})`,
                        type,
                        path: folderPath,
                        fileName,
                    });
                }
            }
        }

        if (entries.length === 0) return FALLBACK_INDEX;

        const sortedEntries = entries.sort((a, b) => a.name.localeCompare(b.name));

        // 3. Save to cache
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                data: sortedEntries,
            }));
            console.log(`[AutoEQ] Cached ${sortedEntries.length} entries`);
        } catch (e) {
            console.warn('[AutoEQ] Failed to save cache (storage full?)', e);
        }

        return sortedEntries;
    } catch (err) {
        console.error('[AutoEQ] Failed to fetch index:', err);
        return FALLBACK_INDEX;
    }
}

/**
 * Fetch the frequency response measurement data for a specific headphone
 * Tries raw GitHub first, falls back to jsDelivr CDN
 * @param {object} entry - AutoEq entry {name, type, path, fileName}
 * @returns {Promise<Array<{freq: number, gain: number}>>}
 */
async function fetchHeadphoneData(entry) {
    const encodedPath = entry.path.split('/').map(encodeURIComponent).join('/');
    const encodedFileName = encodeURIComponent(entry.fileName);

    const urls = [
        `https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/${encodedPath}/${encodedFileName}`,
        `https://cdn.jsdelivr.net/gh/jaakkopasanen/AutoEq@master/results/${encodedPath}/${encodedFileName}`,
    ];

    for (const url of urls) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;

            const text = await response.text();
            // Validate it's not an HTML error page
            if (text.trim().startsWith('<!') || text.trim().startsWith('<html')) continue;

            const points = parseRawData(text);
            if (points.length > 0) return points;
        } catch (e) {
            console.warn(`[AutoEQ] Fetch failed for ${url}:`, e);
        }
    }

    throw new Error(`Failed to fetch data for ${entry.name}`);
}

/**
 * Search/filter headphone entries by query and optional type filter
 * @param {string} query - Search query
 * @param {Array} entries - Full list of entries
 * @param {string} typeFilter - Optional type filter ('all', 'over-ear', 'in-ear')
 * @param {number} limit - Maximum results to return
 * @returns {Array}
 */
function searchHeadphones(query, entries, typeFilter = 'all', limit = 100) {
    let filtered = entries;

    if (typeFilter !== 'all') {
        filtered = filtered.filter(e => e.type === typeFilter);
    }

    if (query && query.trim()) {
        const lower = query.toLowerCase().trim();
        filtered = filtered.filter(e => e.name.toLowerCase().includes(lower));
    }

    return filtered.slice(0, limit);
}

export { fetchAutoEqIndex, fetchHeadphoneData, searchHeadphones };
