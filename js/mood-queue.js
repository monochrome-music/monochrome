// js/mood-queue.js
// AI Mood-Based Queue Generator
// Queries fokus pada lagu trending/viral lintas generasi: TikTok, Spotify, Indonesia & Internasional
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
          'happy hits tiktok viral 2026',
          'feel good pop 2026',
          'summer hits viral',
          'lagu happy viral indonesia 2026',
          'Coldplay A Sky Full of Stars',
          'Ed Sheeran Shape of You',
          'Earth Wind & Fire September',
          'Queen Don\'t Stop Me Now',
          'The Jacksons Blame It on the Boogie',
          'ABBA Dancing Queen',
          'Beyoncé Cuff It',
          'Justin Timberlake Can\'t Stop the Feeling',
          'NewJeans OMG',
          'IVE Love Dive',
          'Tulus Hati-Hati di Jalan',
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
          'sad tiktok viral 2026',
          'sad songs heartbreak 2026',
          'lagu galau viral indonesia 2026',
          'Noah band mungkin nanti',
          'Sheila On 7 Dan',
          'Radiohead Creep',
          'Joy Division Love Will Tear Us Apart',
          'The Smiths I Know It\'s Over',
          'Nadin Amizah Bertaut',
          'Glee Cast Landslide',
          'James Arthur Say You Won\'t Let Go',
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
          'energy tiktok viral 2026',
          'hype playlist 2026',
          'pump up songs viral',
          'rap viral tiktok indonesia',
          'Rich Brian',
          'Kanye West Stronger',
          'Daft Punk One More Time',
          'Skrillex Bangarang',
          'Avicii Levels',
          'The Prodigy Firestarter',
          'Metallica Master of Puppets',
          'A7X Dear God',
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
          'chill tiktok viral 2026',
          'lofi hip hop viral',
          'aesthetic playlist 2026',
          'indie pop chill 2026',
          'lagu santai viral indonesia',
          'Between Friends',
          'TV Girl',
          'Men I Trust Show Me How',
          'Mac DeMarco Chamber of Reflection',
          'Boy Pablo Everytime',
          'Phum Viphurit Lover Boy',
          'Reality Club Anything You Want',
          'Adhitia Sofyan Adelaide Sky',
        ]
      },
      focus: {
        queries: [
          'lofi hip hop study beats',
          'Hans Zimmer Interstellar',
          'Ludovico Einaudi Experience',
          'Max Richter On The Nature of Daylight',
          'Nujabes Feather',
          'study playlist tiktok 2026',
          'instrumental focus music viral',
          'productivity playlist 2026',
          'lo-fi beats for studying',
          'ambient study music',
          'Jon Hopkins Open Eye Signal',
          'bonobo kong',
          'Nils Frahm Says',
          'Brian Eno Music for Airports',
          'Aphex Twin Avril 14th',
          'Joe Hisaishi One Summer\'s Day',
          'Erik Satie Gymnopédie No. 1',
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
          'romantic tiktok viral 2026',
          'love songs 2026 viral',
          'lagu romantis viral indonesia 2026',
          'Conan Gray Heather',
          'Lauv I Like Me Better',
          'Troye Sivan Rush',
          'Elvis Presley Can\'t Help Falling in Love',
          'Frank Sinatra Fly Me to the Moon',
          'Cigarettes After Sex Apocalypse',
          'Arctic Monkeys I Wanna Be Yours',
          'NIKI Every Summertime',
          'Sal Priadi Dari Planet Lain',
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
          'Metal viral tiktok 2026',
          'pop punk viral 2026',
          'rage playlist hits',
          'Halsey Without Me',
          'Alanis Morissette You Oughta Know',
          'Evanescence Bring Me To Life',
          'My Chemical Romance Welcome to the Black Parade',
          'Rage Against The Machine Killing In The Name',
          'Slipknot Duality',
          'Nirvana Breed',
          'System of a Down Chop Suey!',
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
          'throwback hits viral',
          'nostalgia playlist 80s 90s 2000s 2010s',
          'lagu lawas viral tiktok indonesia',
          'Backstreet Boys I Want It That Way',
          'Nirvana Smells Like Teen Spirit',
          'Britney Spears ...Baby One More Time',
          'Spice Girls Wannabe',
          'Radiohead No Surprises',
          'Chrisye Kala Sang Surya Tenggelam',
          'Naif Mobil Balap',
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
          'workout playlist tiktok viral 2026',
          'gym hits 2026',
          'running music motivation',
          'Ecko Show Tabola Bale',
          'Ecko Show Orang Baru Lebe Gacor',
          'fitness motivation hits',
          'hip hop workout 2026',
          'EDM workout mix viral',
          'Survivor Eye of the Tiger',
          'Fort Minor Remember the Name',
          'The White Stripes Seven Nation Army',
        ]
      },
      sleep: {
        queries: [
          'sleep music tiktok viral',
          'Peaceful Piano playlist',
          'Weightless Marconi Union',
          'Nils Frahm All Melody',
          'sleep playlist 2026',
          'ambient sleep music',
          'soft chill acoustic sleep',
          'lullaby chill acoustic 2026',
          'Ben&Ben Maybe the Night',
          'Honne Gone Are the Days',
          'Norah Jones Don\'t Know Why',
          'Sleeping At Last Turning Page',
          'Cigarettes After Sex Sweet',
        ]
      },
    };
    this._currentMood = null;
    this._moodHistory = JSON.parse(localStorage.getItem('mood-queue-history') || '[]');
  }
  _extractTracks(result) {
    if (!result) return [];
    if (Array.isArray(result.items)) return result.items;
    if (Array.isArray(result.data)) return result.data;
    if (Array.isArray(result)) return result;
    if (result.tracks && Array.isArray(result.tracks.items)) return result.tracks.items;
    if (result.tracks && Array.isArray(result.tracks)) return result.tracks;
    return [];
  }
  async generateQueue(mood, count = 1000, energyLevel = 50) {
    this._currentMood = mood;
    const moodConfig = this._moods[mood];
    if (!moodConfig) return [];
    this._moodHistory.unshift({ mood, timestamp: Date.now() });
    this._moodHistory = this._moodHistory.slice(0, 50);
    localStorage.setItem('mood-queue-history', JSON.stringify(this._moodHistory));
    const allTracks = [];
    const seen = new Set();
    const queries = moodConfig.queries;
    for (const query of queries) {
      try {
        const result = await this._musicAPI.searchTracks(query, { limit: 50 });
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
      if (allTracks.length >= count * 1.2) break;
    }
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
