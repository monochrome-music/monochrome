// js/mood-queue.js
// AI Mood-Based Queue Generator
// Queries fokus pada lagu trending/viral Gen-Z: TikTok, Spotify, Indonesia & Internasional

export class MoodQueue {
  constructor(player, musicAPI) {
    this._player = player;
    this._musicAPI = musicAPI;
    this._moods = {
      happy: {
        queries: [
          'Bruno Mars',
          'Harry Styles',
          'Dua Lipa levitating',
          'Pharrell Williams Happy',
          'Mark Ronson Uptown Funk',
          'Lizzo juice',
          'Katy Perry roar',
          'Meghan Trainor all about that bass',
          'Rizky Febian',
          'Tiara Andini',
          'Mahalini',
          'happy hits tiktok viral 2024',
          'feel good pop 2024',
          'summer hits viral',
          'lagu happy viral indonesia 2024',
          'Coldplay A Sky Full of Stars',
          'Ed Sheeran Shape of You',
        ]
      },
      sad: {
        queries: [
          'Alec Benjamin let me down slowly',
          'Eminem Stan',
          'Billie Eilish when the party is over',
          'Lewis Capaldi someone you loved',
          'Olivia Rodrigo drivers license',
          'Taylor Swift All Too Well',
          'Adele Someone Like You',
          'The Weeknd Call Out My Name',
          'Lana Del Rey Young and Beautiful',
          'Sufjan Stevens Death With Dignity',
          'For Revenge serana',
          'Ardhito Pramono Fine And Fine',
          'Sal Priadi dan Nadin Amizah Amin paling serius',
          'Bernadya Satu Bulan',
          'Hindia Belum Tidur',
          'Pamungkas To The Bone',
          'sad tiktok viral 2024',
          'sad songs heartbreak 2024',
          'lagu galau viral indonesia 2024',
          'Noah band mungkin nanti',
          'Sheila On 7 Dan',
        ]
      },
      energetic: {
        queries: [
          'Sabrina Carpenter Espresso',
          'Doja Cat Say So',
          'Cardi B WAP',
          'Travis Scott SICKO MODE',
          'Drake God Plan',
          'Kendrick Lamar HUMBLE',
          'Post Malone Rockstar',
          'Juice WRLD Lucid Dreams',
          'Ecko Show',
          'Young Lex',
          'Lil Nas X Old Town Road',
          'Imagine Dragons Believer',
          'Twenty One Pilots Stressed Out',
          'energy tiktok viral 2024',
          'hype playlist 2024',
          'pump up songs viral',
          'rap viral tiktok indonesia',
          'Rich Brian',
        ]
      },
      chill: {
        queries: [
          'Jordy Chandra',
          'The Marias',
          'Rex Orange County',
          'Clairo Pretty Girl',
          'Beabadoobee Coffee',
          'Surfaces Sunday Best',
          'Omar Apollo Evergreen',
          'Still Woozy Goodie Bag',
          'Tulus',
          'Danilla Riyadi',
          'Mocca',
          'chill tiktok viral 2024',
          'lofi hip hop viral',
          'aesthetic playlist 2024',
          'indie pop chill 2024',
          'lagu santai viral indonesia',
          'Between Friends',
          'TV Girl',
        ]
      },
      focus: {
        queries: [
          'lofi hip hop study beats',
          'Hans Zimmer Interstellar',
          'Ludovico Einaudi Experience',
          'Max Richter On The Nature of Daylight',
          'Nujabes Feather',
          'study playlist tiktok 2024',
          'instrumental focus music viral',
          'productivity playlist 2024',
          'lo-fi beats for studying',
          'ambient study music',
          'Jon Hopkins Open Eye Signal',
          'bonobo kong',
          'Nils Frahm Says',
        ]
      },
      romantic: {
        queries: [
          'Bruno Mars Just The Way You Are',
          'Ed Sheeran Perfect',
          'Charlie Puth We Dont Talk Anymore',
          'Shawn Mendes Stitches',
          'Ariana Grande thank u next',
          'Harry Styles Watermelon Sugar',
          'The Weeknd Starboy',
          'Rizky Febian Kesempurnaan Cinta',
          'Raisa Jatuh Hati',
          'Isyana Sarasvati Tetap Dalam Jiwa',
          'romantic tiktok viral 2024',
          'love songs 2024 viral',
          'lagu romantis viral indonesia 2024',
          'Conan Gray Heather',
          'Lauv I Like Me Better',
          'Troye Sivan Rush',
        ]
      },
      angry: {
        queries: [
          'Billie Eilish bad guy',
          'Olivia Rodrigo good 4 u',
          'Paramore Misery Business',
          'Linkin Park In The End',
          'Twenty One Pilots Heathens',
          'Imagine Dragons Enemy',
          'Bring Me The Horizon Can You Feel My Heart',
          'Metal viral tiktok 2024',
          'pop punk viral 2024',
          'rage playlist hits',
          'Halsey Without Me',
          'Alanis Morissette You Oughta Know',
          'Evanescence Bring Me To Life',
          'My Chemical Romance Welcome to the Black Parade',
        ]
      },
      nostalgic: {
        queries: [
          'Michael Jackson Thriller',
          'Queen Bohemian Rhapsody',
          'The Beatles Hey Jude',
          'Oasis Wonderwall',
          'Linkin Park Numb',
          'Coldplay Yellow',
          'Sheila On 7',
          'Padi Tetap Menantimu',
          'Dewa 19',
          'Peterpan Mungkin Nanti',
          'Slank Ku Tak Bisa',
          '2000s throwback hits viral',
          'nostalgia playlist 90s 2000s',
          'lagu lawas viral tiktok indonesia',
          'Backstreet Boys I Want It That Way',
          'Nirvana Smells Like Teen Spirit',
        ]
      },
      workout: {
        queries: [
          'Eminem Till I Collapse',
          'Kanye West POWER',
          'Jay-Z Run This Town',
          'Kendrick Lamar m.A.A.d city',
          'Travis Scott Goosebumps',
          'Post Malone Motley Crew',
          'workout playlist tiktok viral 2024',
          'gym hits 2024',
          'running music motivation',
          'Ecko Show Tabola Bale',
          'Ecko Show Orang Baru Lebe Gacor',
          'fitness motivation hits',
          'hip hop workout 2024',
          'EDM workout mix viral',
        ]
      },
      sleep: {
        queries: [
          'sleep music tiktok viral',
          'Peaceful Piano playlist',
          'Weightless Marconi Union',
          'Nils Frahm All Melody',
          'sleep playlist 2024',
          'ambient sleep music',
          'soft chill acoustic sleep',
          'lullaby chill acoustic 2024',
          'Ben&Ben Maybe the Night',
          'Honne Gone Are the Days',
        ]
      },
    };
    this._currentMood = null;
    this._moodHistory = JSON.parse(localStorage.getItem('mood-queue-history') || '[]');
  }

  /**
   * Extract track items from various API response formats
   */
  _extractTracks(result) {
    if (!result) return [];
    if (Array.isArray(result.items)) return result.items;
    if (Array.isArray(result.data)) return result.data;
    if (Array.isArray(result)) return result;
    if (result.tracks && Array.isArray(result.tracks.items)) return result.tracks.items;
    if (result.tracks && Array.isArray(result.tracks)) return result.tracks;
    return [];
  }

  /**
   * Generate a playlist queue for the given mood
   * @param {string} mood - mood key
   * @param {number} count - number of tracks (max 100)
   * @param {number} energyLevel - 0-100 energy level
   * @returns {Promise} array of track objects
   */
  async generateQueue(mood, count = 100, energyLevel = 50) {
    this._currentMood = mood;
    const moodConfig = this._moods[mood];
    if (!moodConfig) return [];

    // Save history
    this._moodHistory.unshift({ mood, timestamp: Date.now() });
    this._moodHistory = this._moodHistory.slice(0, 50);
    localStorage.setItem('mood-queue-history', JSON.stringify(this._moodHistory));

    const allTracks = [];
    const seen = new Set();

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
      if (allTracks.length >= count * 1.5) break;
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
