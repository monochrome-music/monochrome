// js/mood-queue.js
// AI Mood-Based Queue Generator - generates queues based on user mood/context
// Fixed: properly uses MusicAPI.searchTracks which returns { items: [...] }

export class MoodQueue {
  constructor(player, musicAPI) {
    this._player = player;
    this._musicAPI = musicAPI;
    this._moods = {
      happy:     { genres: ['pop', 'dance', 'funk', 'disco'],         queries: ['happy pop hits', 'feel good songs', 'upbeat pop', 'summer hits'] },
      sad:       { genres: ['indie', 'acoustic', 'ballad'],           queries: ['sad songs', 'emotional ballad', 'heartbreak indie', 'melancholy acoustic'] },
      energetic: { genres: ['edm', 'rock', 'hip-hop'],               queries: ['energetic edm', 'hype music', 'pump up songs', 'high energy rock'] },
      chill:     { genres: ['lo-fi', 'ambient', 'jazz'],             queries: ['chill lo-fi', 'relaxing music', 'calm jazz', 'ambient chill'] },
      focus:     { genres: ['classical', 'ambient', 'instrumental'], queries: ['focus music', 'study instrumental', 'concentration classical', 'work ambient'] },
      romantic:  { genres: ['r&b', 'soul', 'jazz'],                  queries: ['romantic songs', 'love songs r&b', 'soul love', 'romantic jazz'] },
      angry:     { genres: ['metal', 'punk', 'rock'],                queries: ['angry metal', 'aggressive rock', 'punk rock', 'heavy metal'] },
      nostalgic: { genres: ['80s', '90s', 'classic rock'],           queries: ['80s hits', '90s nostalgia', 'classic rock', 'retro pop'] },
      workout:   { genres: ['edm', 'hip-hop', 'rock'],               queries: ['workout music', 'gym hits', 'running music', 'fitness beats'] },
      sleep:     { genres: ['ambient', 'classical', 'nature'],       queries: ['sleep music', 'relaxing ambient', 'soft classical', 'sleep sounds'] },
    };
    this._currentMood = null;
    this._moodHistory = JSON.parse(localStorage.getItem('mood-queue-history') || '[]');
  }

  /**
   * Extract track items from various API response formats
   */
  _extractTracks(result) {
    if (!result) return [];
    // Format: { items: [...] }
    if (Array.isArray(result.items)) return result.items;
    // Format: { data: [...] }
    if (Array.isArray(result.data)) return result.data;
    // Format: direct array
    if (Array.isArray(result)) return result;
    // Format: { tracks: { items: [...] } }
    if (result.tracks && Array.isArray(result.tracks.items)) return result.tracks.items;
    if (result.tracks && Array.isArray(result.tracks)) return result.tracks;
    return [];
  }

  /**
   * Generate a playlist queue for the given mood
   * @param {string} mood - mood key
   * @param {number} count - number of tracks
   * @param {number} energyLevel - 0-100 energy level
   * @returns {Promise<Array>} array of track objects
   */
  async generateQueue(mood, count = 30, energyLevel = 50) {
    this._currentMood = mood;
    const moodConfig = this._moods[mood];
    if (!moodConfig) return [];

    // Save history
    this._moodHistory.unshift({ mood, timestamp: Date.now() });
    this._moodHistory = this._moodHistory.slice(0, 50);
    localStorage.setItem('mood-queue-history', JSON.stringify(this._moodHistory));

    const allTracks = [];
    const seen = new Set();

    // Use the search queries defined per mood
    const queries = moodConfig.queries;

    for (const query of queries) {
      try {
        const result = await this._musicAPI.searchTracks(query, { limit: 20 });
        const tracks = this._extractTracks(result);
        for (const track of tracks) {
          const id = track.id || track.trackId;
          if (id && !seen.has(id)) {
            seen.add(id);
            allTracks.push(track);
          }
        }
      } catch (e) {
        console.warn('[MoodQueue] Search failed for:', query, e);
      }
      // Stop early if we have enough tracks
      if (allTracks.length >= count * 2) break;
    }

    // If still not enough, try genre-based searches
    if (allTracks.length < count) {
      for (const genre of moodConfig.genres) {
        try {
          const result = await this._musicAPI.searchTracks(genre, { limit: 15 });
          const tracks = this._extractTracks(result);
          for (const track of tracks) {
            const id = track.id || track.trackId;
            if (id && !seen.has(id)) {
              seen.add(id);
              allTracks.push(track);
            }
          }
        } catch (e) {
          console.warn('[MoodQueue] Genre search failed for:', genre, e);
        }
        if (allTracks.length >= count * 2) break;
      }
    }

    // Shuffle
    for (let i = allTracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]];
    }

    const queue = allTracks.slice(0, count);

    if (queue.length > 0 && this._player) {
      this._player.setQueue(queue, 0);
      await this._player.playTrackFromQueue();
    }

    return queue;
  }

  getMoodHistory() {
    return this._moodHistory;
  }

  getCurrentMood() {
    return this._currentMood;
  }
}
