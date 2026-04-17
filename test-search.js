import { HiFiClient } from './js/HiFi.ts';
import { LosslessAPI } from './js/api.js';

// mock out modules to make LosslessAPI load in bun
import { mock } from 'bun:test';
mock.module('./js/icons.ts', () => ({}));
mock.module('./js/settings.js', () => ({ devModeSettings: { isEnabled: () => false }, syncManager: {}, musicProviderSettings: {}, audioSettings: {}, apiSettings: {} }));

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { matchMedia: () => ({ matches: false }) };

async function test() {
    await HiFiClient.initialize();
    const api = new LosslessAPI({ getInstances: () => [] });

    // mock cache
    api.cache = { get: () => null, set: () => {} };

    api.fetchWithRetry = async function(relativePath, options) {
        console.log("fetchWithRetry called:", relativePath);
        return HiFiClient.instance.query(relativePath);
    };

    const res = await api.search('coldplay');
    console.log("Returned tracks:", res.tracks?.items?.length);
}
test().catch(console.error);
