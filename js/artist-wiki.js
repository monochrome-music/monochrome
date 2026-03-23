// js/artist-wiki.js
// Fetch and display artist biography, credits, and song info
// Uses MusicBrainz and Wikipedia APIs (free, no API key required)

const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2';
const WIKIPEDIA_BASE = 'https://en.wikipedia.org/api/rest_v1';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export class ArtistWiki {
  constructor() {
    this.cache = new Map();
  }

  async getArtistInfo(artistName) {
    const cacheKey = `artist:${artistName.toLowerCase()}`;
    const cached = this._getCache(cacheKey);
    if (cached) return cached;

    try {
      const mbData = await this._searchMusicBrainz(artistName);
      const wikiData = mbData?.wikiUrl
        ? await this._fetchWikipediaSummary(mbData.wikiUrl)
        : null;

      const result = {
        name: mbData?.name || artistName,
        mbid: mbData?.id || null,
        type: mbData?.type || 'Unknown',
        country: mbData?.country || null,
        beginDate: mbData?.beginDate || null,
        endDate: mbData?.endDate || null,
        genres: mbData?.genres || [],
        bio: wikiData?.extract || null,
        bioHtml: wikiData?.extractHtml || null,
        thumbnail: wikiData?.thumbnail || null,
        wikiUrl: wikiData?.pageUrl || null,
      };

      this._setCache(cacheKey, result);
      return result;
    } catch (e) {
      console.warn('[ArtistWiki] Failed to fetch info for:', artistName, e);
      return { name: artistName, bio: null, error: e.message };
    }
  }

  async getTrackCredits(trackTitle, artistName) {
    const cacheKey = `track:${trackTitle}:${artistName}`.toLowerCase();
    const cached = this._getCache(cacheKey);
    if (cached) return cached;

    try {
      const query = encodeURIComponent(`recording:"${trackTitle}" AND artist:"${artistName}"`);
      const resp = await fetch(
        `${MUSICBRAINZ_BASE}/recording/?query=${query}&limit=1&fmt=json`,
        { headers: { 'User-Agent': 'AetherMusicPlayer/1.0' } }
      );
      const data = await resp.json();
      const recording = data.recordings?.[0];
      if (!recording) return null;

      const result = {
        title: recording.title,
        length: recording.length,
        artistCredit: recording['artist-credit']?.map(ac => ({
          name: ac.artist?.name,
          joinphrase: ac.joinphrase || '',
        })) || [],
        releases: recording.releases?.map(r => ({
          title: r.title,
          date: r.date,
          country: r.country,
        })) || [],
        tags: recording.tags?.map(t => t.name) || [],
        isrcs: recording.isrcs || [],
      };

      this._setCache(cacheKey, result);
      return result;
    } catch (e) {
      console.warn('[ArtistWiki] Track credits fetch failed:', e);
      return null;
    }
  }

  async _searchMusicBrainz(artistName) {
    const query = encodeURIComponent(`artist:"${artistName}"`);
    const resp = await fetch(
      `${MUSICBRAINZ_BASE}/artist/?query=${query}&limit=1&fmt=json`,
      { headers: { 'User-Agent': 'AetherMusicPlayer/1.0' } }
    );
    const data = await resp.json();
    const artist = data.artists?.[0];
    if (!artist) return null;

    const wikiRel = artist.relations?.find(
      r => r.type === 'wikipedia' || r.type === 'wikidata'
    );

    // Fetch with relations to get Wikipedia link
    const detailResp = await fetch(
      `${MUSICBRAINZ_BASE}/artist/${artist.id}?inc=url-rels+genres&fmt=json`,
      { headers: { 'User-Agent': 'AetherMusicPlayer/1.0' } }
    );
    const detail = await detailResp.json();
    const wikiUrl = detail.relations?.find(
      r => r.type === 'wikipedia'
    )?.url?.resource;

    return {
      id: artist.id,
      name: artist.name,
      type: artist.type,
      country: artist.country,
      beginDate: artist['life-span']?.begin,
      endDate: artist['life-span']?.end,
      genres: detail.genres?.map(g => g.name) || [],
      wikiUrl: wikiUrl || null,
    };
  }

  async _fetchWikipediaSummary(wikiUrl) {
    try {
      const title = wikiUrl.split('/wiki/').pop();
      if (!title) return null;
      const resp = await fetch(`${WIKIPEDIA_BASE}/page/summary/${title}`);
      const data = await resp.json();
      return {
        extract: data.extract || null,
        extractHtml: data.extract_html || null,
        thumbnail: data.thumbnail?.source || null,
        pageUrl: data.content_urls?.desktop?.page || wikiUrl,
      };
    } catch {
      return null;
    }
  }

  _getCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  _setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clearCache() {
    this.cache.clear();
  }
}
