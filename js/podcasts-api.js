// js/podcasts-api.js
// PodcastIndex.org API integration for Monochrome Music

const PODCASTINDEX_API_BASE = 'https://api.podcastindex.org/api/1.0';

const PODCAST_API_KEY = 'YU5HMSDYBQQVYDF6QN4P';
const PODCAST_API_SECRET = '8hCvpjSL7T$S7^5ftnf5MhqQwYUYVjM^fmUL3Ld$';

export class PodcastsAPI {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 1000 * 60 * 5;
    }

    async getAuthHeaders() {
        const apiHeaderTime = Math.floor(Date.now() / 1000).toString();
        const combined = PODCAST_API_KEY + PODCAST_API_SECRET + apiHeaderTime;
        const authHeader = await this.sha1(combined);
        return {
            'User-Agent': 'MonochromeMusic/1.0',
            'X-Auth-Key': PODCAST_API_KEY,
            'X-Auth-Date': apiHeaderTime,
            Authorization: authHeader,
        };
    }

    async sha1(str) {
        const encoder = new TextEncoder();
        const data = encoder.encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-1', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    async fetchWithRetry(endpoint, options = {}) {
        const url = `${PODCASTINDEX_API_BASE}${endpoint}`;
        const cacheKey = url;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }

        try {
            const headers = await this.getAuthHeaders();
            const response = await fetch(url, {
                method: 'GET',
                headers: headers,
                signal: options.signal,
            });

            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }

            const data = await response.json();
            this.cache.set(cacheKey, { data, timestamp: Date.now() });
            return data;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('PodcastIndex API request failed:', error);
            throw error;
        }
    }

    async searchPodcasts(query, options = {}) {
        try {
            const max = options.max || 20;
            const clean = options.clean ? '&clean' : '';
            const data = await this.fetchWithRetry(
                `/search/byterm?q=${encodeURIComponent(query)}&max=${max}${clean}&pretty`,
                options
            );

            if (data.status !== 'true' || !data.feeds) {
                return { items: [], total: 0 };
            }

            const podcasts = data.feeds.map((feed) => this.transformPodcast(feed));
            return {
                items: podcasts,
                total: data.count || podcasts.length,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Podcast search failed:', error);
            return { items: [], total: 0 };
        }
    }

    async searchPodcastsByTitle(query, options = {}) {
        try {
            const max = options.max || 20;
            const clean = options.clean ? '&clean' : '';
            const data = await this.fetchWithRetry(
                `/search/bytitle?q=${encodeURIComponent(query)}&max=${max}${clean}&pretty`,
                options
            );

            if (data.status !== 'true' || !data.feeds) {
                return { items: [], total: 0 };
            }

            const podcasts = data.feeds.map((feed) => this.transformPodcast(feed));
            return {
                items: podcasts,
                total: data.count || podcasts.length,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Podcast search by title failed:', error);
            return { items: [], total: 0 };
        }
    }

    async getPodcastById(id, options = {}) {
        try {
            const data = await this.fetchWithRetry(`/podcasts/byfeedid?id=${id}&pretty`, options);

            if (data.status !== 'true' || !data.feed) {
                return null;
            }

            return this.transformPodcastFull(data.feed);
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Get podcast by ID failed:', error);
            return null;
        }
    }

    async getPodcastEpisodes(id, options = {}) {
        try {
            const max = options.max || 50;
            const offset = options.offset || 0;
            const data = await this.fetchWithRetry(
                `/episodes/byfeedid?id=${id}&max=${max}&offset=${offset}&pretty`,
                options
            );

            if (data.status !== 'true' || !data.items) {
                return { items: [], total: 0, hasMore: false };
            }

            const episodes = data.items.map((item) => this.transformEpisode(item));
            return {
                items: episodes,
                total: data.count || episodes.length,
                hasMore: episodes.length === max,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Get podcast episodes failed:', error);
            return { items: [], total: 0, hasMore: false };
        }
    }

    async getTrendingPodcasts(options = {}) {
        try {
            const max = options.max || 20;
            const lang = options.lang || '';
            const cat = options.cat || '';
            const since = options.since || '';
            const params = new URLSearchParams({ max, pretty: '' });
            if (lang) params.append('lang', lang);
            if (cat) params.append('cat', cat);
            if (since) params.append('since', since);
            const queryString = params.toString().replace(/&pretty=$/, '');
            const data = await this.fetchWithRetry(`/podcasts/trending?${queryString}`, options);

            if (data.status !== 'true' || !data.feeds) {
                return { items: [], total: 0 };
            }

            const podcasts = data.feeds.map((feed) => this.transformPodcast(feed));
            return {
                items: podcasts,
                total: data.count || podcasts.length,
            };
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Get trending podcasts failed:', error);
            return { items: [], total: 0 };
        }
    }

    async testAuth() {
        console.log('Testing PodcastIndex auth...');
        try {
            const response = await fetch(`${PODCASTINDEX_API_BASE}/hub/pubnotify?id=75075&pretty`, {
                headers: await this.getAuthHeaders(),
            });
            const data = await response.json();
            console.log('Test response:', data);
            return data;
        } catch (error) {
            console.error('Auth test failed:', error);
        }
    }

    transformPodcast(feed) {
        return {
            id: feed.id?.toString() || '',
            podcastGuid: feed.podcastGuid || '',
            title: feed.title || 'Unknown Podcast',
            author: feed.author || feed.ownerName || '',
            description: feed.description || '',
            image: feed.image || feed.artwork || '',
            link: feed.link || '',
            feedUrl: feed.url || '',
            language: feed.language || '',
            categories: feed.categories || {},
            explicit: feed.explicit || false,
            episodeCount: feed.episodeCount || 0,
            newestItemPublishTime: feed.newestItemPubdate || feed.newestItemPublishTime || null,
        };
    }

    transformPodcastFull(feed) {
        const podcast = this.transformPodcast(feed);
        podcast.generator = feed.generator || '';
        podcast.locked = feed.locked || 0;
        podcast.medium = feed.medium || '';
        podcast.dead = feed.dead || 0;
        podcast.value = feed.value || null;
        podcast.funding = feed.funding || null;
        return podcast;
    }

    transformEpisode(item) {
        return {
            id: item.id?.toString() || '',
            title: item.title || 'Unknown Episode',
            description: item.description || '',
            link: item.link || '',
            guid: item.guid || '',
            datePublished: item.datePublished || 0,
            datePublishedPretty: item.datePublishedPretty || '',
            enclosureUrl: item.enclosureUrl || '',
            enclosureType: item.enclosureType || '',
            enclosureLength: item.enclosureLength || 0,
            duration: item.duration || null,
            explicit: item.explicit || 0,
            episode: item.episode || null,
            episodeType: item.episodeType || 'full',
            season: item.season || null,
            image: item.image || '',
            feedId: item.feedId || null,
            feedTitle: item.feedTitle || '',
            feedImage: item.feedImage || '',
        };
    }
}

export const podcastsAPI = new PodcastsAPI();
