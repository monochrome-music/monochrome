// js/autoeq-importer.js
// Headphone Database Browser - Fetches from AutoEq GitHub repository
// Provides access to 4000+ headphone measurement profiles

import { parseRawData } from './autoeq-data.js';
import { db } from './db.js';

const CACHE_KEY = 'autoeq_index_v4';
const OLD_LS_CACHE_KEY = 'monochrome_autoeq_index_v4';
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

// 5 most popular headphones - pre-loaded as defaults and shown in the headphone select
// All measured on Rtings B&K 5128 rig for consistency
const POPULAR_HEADPHONES = [
    {
        name: 'Sony WH-1000XM5 (Rtings)',
        type: 'over-ear',
        path: 'Rtings/Bruel & Kjaer 5128 over-ear/Sony WH-1000XM5',
        fileName: 'Sony WH-1000XM5.csv',
    },
    {
        name: 'Apple AirPods Pro2 (Rtings)',
        type: 'in-ear',
        path: 'Rtings/Bruel & Kjaer 5128 in-ear/Apple AirPods Pro2',
        fileName: 'Apple AirPods Pro2.csv',
    },
    {
        name: 'Sony WF-1000XM5 (Rtings)',
        type: 'in-ear',
        path: 'Rtings/Bruel & Kjaer 5128 in-ear/Sony WF-1000XM5',
        fileName: 'Sony WF-1000XM5.csv',
    },
    {
        name: 'Samsung Galaxy Buds3 Pro (Rtings)',
        type: 'in-ear',
        path: 'Rtings/Bruel & Kjaer 5128 in-ear/Samsung Galaxy Buds3 Pro',
        fileName: 'Samsung Galaxy Buds3 Pro.csv',
    },
    {
        name: 'Sennheiser HD 600 (Rtings)',
        type: 'over-ear',
        path: 'Rtings/Bruel & Kjaer 5128 over-ear/Sennheiser HD 600',
        fileName: 'Sennheiser HD 600.csv',
    },
];

// Static fallback list in case GitHub API fails - popular picks + additional well-known models
const FALLBACK_INDEX = [
    ...POPULAR_HEADPHONES,
    {
        name: 'Sennheiser HD 600 (Filk)',
        type: 'over-ear',
        path: 'Filk/over-ear/Sennheiser HD 600',
        fileName: 'Sennheiser HD 600.csv',
    },
    {
        name: 'Sennheiser HD 600 (Innerfidelity)',
        type: 'over-ear',
        path: 'Innerfidelity/over-ear/Sennheiser HD 600',
        fileName: 'Sennheiser HD 600.csv',
    },
    {
        name: 'Samsung Galaxy Buds2 Pro (Rtings)',
        type: 'in-ear',
        path: 'Rtings/Bruel & Kjaer 5128 in-ear/Samsung Galaxy Buds2 Pro',
        fileName: 'Samsung Galaxy Buds2 Pro.csv',
    },
    {
        name: 'Sony WF-1000XM5 (Kazi)',
        type: 'in-ear',
        path: 'Kazi/in-ear/Sony WF-1000XM5',
        fileName: 'Sony WF-1000XM5.csv',
    },
    {
        name: 'Samsung Galaxy Buds3 Pro (DHRME)',
        type: 'in-ear',
        path: 'DHRME/in-ear/Samsung Galaxy Buds3 Pro',
        fileName: 'Samsung Galaxy Buds3 Pro.csv',
    },
    {
        name: 'Apple AirPods Pro (Super Review)',
        type: 'in-ear',
        path: 'Super Review/in-ear/Apple AirPods Pro',
        fileName: 'Apple AirPods Pro.csv',
    },
    {
        name: 'Sennheiser HD 600 (2020) (Kuulokenurkka)',
        type: 'over-ear',
        path: 'Kuulokenurkka/over-ear/Sennheiser HD 600 (2020)',
        fileName: 'Sennheiser HD 600 (2020).csv',
    },
];

/**
 * Fetch the full AutoEq headphone index from GitHub
 * Uses GitHub API to get the repository tree, then parses it for measurement files
 * Caches results in localStorage for 24 hours
 * @returns {Promise<Array<{name: string, type: string, path: string, fileName: string}>>}
 */
async function fetchAutoEqIndex() {
    // Migrate: remove old localStorage cache to free quota
    try {
        localStorage.removeItem(OLD_LS_CACHE_KEY);
    } catch {
        /* ignore */
    }

    // 1. Try loading from IndexedDB cache
    try {
        const cached = await db.getSetting(CACHE_KEY);
        if (cached && cached.timestamp && cached.data) {
            if (Date.now() - cached.timestamp < CACHE_EXPIRY) {
                console.log('[AutoEQ] Loaded index from cache');
                return cached.data;
            }
        }
    } catch (e) {
        console.warn('[AutoEQ] Failed to read cache:', e);
    }

    // 2. Fetch from GitHub API
    try {
        console.log('[AutoEQ] Fetching index from GitHub...');
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        let response;
        try {
            response = await fetch('https://api.github.com/repos/jaakkopasanen/AutoEq/git/trees/master?recursive=1', {
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timeoutId);
        }

        if (!response.ok) {
            try {
                const cached = await db.getSetting(CACHE_KEY);
                if (cached?.data) {
                    console.warn('[AutoEQ] GitHub API limit reached. Using stale cache.');
                    return cached.data;
                }
            } catch {
                /* ignore */
            }
            console.warn('[AutoEQ] GitHub API error. Using fallback.');
            return FALLBACK_INDEX;
        }

        const data = await response.json();
        const entries = [];

        for (const item of data.tree) {
            if (!item.path.startsWith('results/')) continue;
            if (!item.path.endsWith('.csv') && !item.path.endsWith('.txt')) continue;

            const parts = item.path.split('/');
            if (parts.length < 4) continue;

            const fileName = parts.pop();
            const fileNameLower = fileName.toLowerCase();

            // Skip non-measurement files (EQ presets, not raw frequency response)
            if (
                fileNameLower.includes('parametriceq') ||
                fileNameLower.includes('fixedbandeq') ||
                fileNameLower.includes('graphiceq') ||
                fileNameLower.includes('convolution') ||
                fileNameLower.includes('fixed band eq') ||
                fileNameLower.includes('parametric eq') ||
                fileNameLower.includes('graphic eq')
            ) {
                continue;
            }

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

        if (entries.length === 0) return FALLBACK_INDEX;

        const sortedEntries = entries.sort((a, b) => a.name.localeCompare(b.name));

        // 3. Save to IndexedDB cache
        try {
            await db.saveSetting(CACHE_KEY, {
                timestamp: Date.now(),
                data: sortedEntries,
            });
            console.log(`[AutoEQ] Cached ${sortedEntries.length} entries`);
        } catch (e) {
            console.warn('[AutoEQ] Failed to save cache:', e);
        }

        return sortedEntries;
    } catch (err) {
        if (err.name === 'AbortError') {
            console.warn('[AutoEQ] GitHub API request timed out. Falling back to cache or fallback index.');
        } else {
            console.error('[AutoEQ] Failed to fetch index:', err);
        }
        try {
            const cached = await db.getSetting(CACHE_KEY);
            if (cached?.data) return cached.data;
        } catch {
            /* ignore */
        }
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
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            let response;
            try {
                response = await fetch(url, { signal: controller.signal });
            } finally {
                clearTimeout(timeoutId);
            }
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
        filtered = filtered.filter((e) => e.type === typeFilter);
    }

    if (query && query.trim()) {
        const lower = query.toLowerCase().trim();
        filtered = filtered.filter((e) => e.name.toLowerCase().includes(lower));
    }

    return filtered.slice(0, limit);
}

export { fetchAutoEqIndex, fetchHeadphoneData, searchHeadphones, POPULAR_HEADPHONES };
