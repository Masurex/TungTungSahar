// "Миксы дня": personal mixes that refresh once a day.
// Built from what the user likes / listens to (genres, artists); without
// history they are based on time of day and today's trending tracks.
import { api, MOODS, GENRES } from './api.js';
import { store } from './store.js';

const MIX_COUNT = 6;
const MIX_LEN = 40;

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// Deterministic RNG so a mix stays the same all day and changes tomorrow.
function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function shuffled(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const genreName = (g) => (GENRES.find((x) => x.id === g) || { name: g }).name;

function timeMood() {
  const h = new Date().getHours();
  if (h < 5) return { id: 'night', title: 'Ночной микс' };
  if (h < 11) return { id: 'chill', title: 'Утренний микс' };
  if (h < 17) return { id: 'focus', title: 'Дневной микс' };
  if (h < 22) return { id: 'party', title: 'Вечерний микс' };
  return { id: 'sleep', title: 'Микс перед сном' };
}

function topBy(items, keyFn, n) {
  const count = new Map();
  items.forEach((t) => {
    const k = keyFn(t);
    if (k) count.set(k, (count.get(k) || 0) + 1);
  });
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

// Mix descriptions (cheap, synchronous). Tracks are loaded on demand.
export function dailyMixes() {
  const day = today();
  const rand = rng(day);
  // Likes count double: they are a stronger signal than plays.
  const likes = store.likes().filter((t) => t.source === 'audius');
  const hist = [...likes, ...likes, ...store.recent().filter((t) => t.source === 'audius')];
  const mixes = [];
  let n = 1;

  for (const genre of topBy(hist, (t) => t.genre, 3)) {
    const inGenre = hist.filter((t) => t.genre === genre);
    const artists = topBy(inGenre, (t) => t.artistId, 3);
    const names = [...new Set(inGenre.map((t) => t.artist))].slice(0, 3);
    mixes.push({
      id: `g:${genre}`, kind: 'genre', genre, artists,
      title: `Микс дня ${n++}`,
      sub: names.length ? `${names.join(', ')} и другие` : genreName(genre),
      cover: inGenre[0] && inGenre[0].artwork,
    });
  }

  for (const artistId of topBy(hist, (t) => t.artistId, 4)) {
    if (mixes.length >= 4) break;
    if (mixes.some((m) => m.artists && m.artists[0] === artistId)) continue;
    const t = hist.find((x) => x.artistId === artistId);
    mixes.push({
      id: `a:${artistId}`, kind: 'artist', artists: [artistId], genre: t.genre,
      title: `Микс: ${t.artist}`, sub: `${t.artist} и похожие`, cover: t.artwork,
    });
  }

  const tm = timeMood();
  const mood = MOODS.find((m) => m.id === tm.id);
  mixes.push({ id: `m:${mood.id}`, kind: 'mood', mood: mood.id, title: tm.title, sub: mood.name + ' · ' + mood.sub });
  mixes.push({ id: 'discover', kind: 'discover', title: 'Открытия дня', sub: 'Новое и популярное сегодня' });

  // Fill the rest with today's random moods.
  for (const m of shuffled(MOODS, rand)) {
    if (mixes.length >= MIX_COUNT) break;
    if (mixes.some((x) => x.mood === m.id)) continue;
    mixes.push({ id: `m:${m.id}`, kind: 'mood', mood: m.id, title: `${m.name} на сегодня`, sub: m.sub });
  }
  return mixes.slice(0, MIX_COUNT).map((m, i) => ({ ...m, color: i }));
}

export function findMix(id) {
  return dailyMixes().find((m) => m.id === id) || null;
}

// Tracks of a mix, cached for the whole day.
export async function mixTracks(mix) {
  const day = today();
  const cache = store.get('dailyMixes', null);
  const data = cache && cache.day === day ? cache : { day, tracks: {} };
  if (data.tracks[mix.id] && data.tracks[mix.id].length) return data.tracks[mix.id];

  const heard = new Set([...store.likes(), ...store.recent()].map((t) => t.key));
  const liked = store.likes();
  let pools = [];

  if (mix.kind === 'genre' || mix.kind === 'artist') {
    const artistTracks = mix.artists.map((id) => api.artist(id).then((a) => a.tracks).catch(() => []));
    const genreTracks = mix.genre ? api.trending({ genre: mix.genre, time: 'month', limit: 60 }).catch(() => []) : Promise.resolve([]);
    pools = await Promise.all([...artistTracks, genreTracks]);
    // A few of your own liked tracks in this genre, like Daily Mix does.
    pools.push(liked.filter((t) => t.source === 'audius' && (t.genre === mix.genre || mix.artists.includes(t.artistId))));
  } else if (mix.kind === 'mood') {
    const m = MOODS.find((x) => x.id === mix.mood);
    pools = [await api.moodTracks(m.q)];
  } else {
    const [week, month] = await Promise.all([
      api.trending({ time: 'week', limit: 60 }).catch(() => []),
      api.trending({ time: 'month', limit: 60 }).catch(() => []),
    ]);
    pools = [week.filter((t) => !heard.has(t.key)), month.filter((t) => !heard.has(t.key))];
  }

  const rand = rng(day + mix.id);
  const seen = new Set();
  const out = [];
  // Round-robin over shuffled pools so artists/genres are mixed together.
  const shuffledPools = pools.map((p) => shuffled(p, rand));
  for (let i = 0; out.length < MIX_LEN && shuffledPools.some((p) => p[i]); i++) {
    for (const p of shuffledPools) {
      const t = p[i];
      if (t && !seen.has(t.key)) { seen.add(t.key); out.push(t); }
    }
  }
  const tracks = out.slice(0, MIX_LEN);
  if (tracks.length) {
    data.tracks[mix.id] = tracks;
    store.set('dailyMixes', data);
  }
  return tracks;
}
