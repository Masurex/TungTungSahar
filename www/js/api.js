// Music sources.
//  * Audius — open, free music streaming network with a public API (no key needed).
//    Tracks are streamed directly, nothing is saved to the device.
//  * Radio Browser — open directory of ~50k internet radio stations worldwide.
import { store } from './store.js';

export const APP_NAME = 'SaharMusic';
const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

async function getJSON(url, { timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------- Audius -------------------------------- */

const AUDIUS_GATEWAY = 'https://api.audius.co';
let audiusHost = store.get('audiusHost', null);

async function pickAudiusHosts() {
  const hosts = [];
  if (audiusHost) hosts.push(audiusHost);
  hosts.push(AUDIUS_GATEWAY);
  try {
    const list = await getJSON(AUDIUS_GATEWAY, { timeout: 6000 });
    const extra = (list && list.data) || [];
    // Shuffle so load is spread across discovery nodes.
    extra.sort(() => Math.random() - 0.5).forEach((h) => { if (!hosts.includes(h)) hosts.push(h); });
  } catch { /* gateway list unavailable; try what we have */ }
  return hosts;
}

async function audius(path, params = {}) {
  const qs = new URLSearchParams({ ...params, app_name: APP_NAME }).toString();
  const tried = new Set();
  let lastErr;
  // First attempt with cached/default host, then fall back to the node list.
  const candidates = [audiusHost || AUDIUS_GATEWAY];
  for (let round = 0; round < 2; round++) {
    for (const host of candidates) {
      if (tried.has(host)) continue;
      tried.add(host);
      try {
        const json = await getJSON(`${host}/v1${path}?${qs}`);
        if (host !== audiusHost) { audiusHost = host; store.set('audiusHost', host); }
        return json.data;
      } catch (e) {
        lastErr = e;
      }
    }
    if (round === 0) candidates.push(...(await pickAudiusHosts()));
  }
  audiusHost = null;
  store.set('audiusHost', null);
  throw lastErr || new Error('Audius недоступен');
}

function art(obj, size = '480x480') {
  if (!obj) return '';
  return obj[size] || obj['480x480'] || obj['1000x1000'] || obj['150x150'] || '';
}

export function audiusTrack(t) {
  return {
    key: `a:${t.id}`,
    source: 'audius',
    id: t.id,
    title: t.title || 'Без названия',
    artist: (t.user && t.user.name) || '',
    artistId: t.user && t.user.id,
    artwork: art(t.artwork),
    artworkLarge: art(t.artwork, '1000x1000'),
    duration: t.duration || 0,
    genre: t.genre || '',
    plays: t.play_count || 0,
  };
}

function audiusPlaylist(p) {
  return {
    id: p.id,
    name: p.playlist_name || 'Плейлист',
    owner: (p.user && p.user.name) || '',
    artwork: art(p.artwork),
    count: p.track_count || 0,
    isAlbum: !!p.is_album,
  };
}

function audiusUser(u) {
  return {
    id: u.id,
    name: u.name || u.handle || '',
    handle: u.handle || '',
    avatar: art(u.profile_picture, '480x480'),
    cover: (u.cover_photo && (u.cover_photo['2000x'] || u.cover_photo['640x'])) || '',
    followers: u.follower_count || 0,
    tracks: u.track_count || 0,
    bio: u.bio || '',
  };
}

const playable = (t) => t && t.is_streamable !== false && !t.is_delete;

export function streamUrl(item) {
  if (item.source === 'radio') return item.stream;
  const host = audiusHost || AUDIUS_GATEWAY;
  return `${host}/v1/tracks/${encodeURIComponent(item.id)}/stream?app_name=${APP_NAME}`;
}

export const GENRES = [
  { id: '', name: 'Все жанры' },
  { id: 'Electronic', name: 'Электроника' },
  { id: 'Hip-Hop/Rap', name: 'Хип-хоп' },
  { id: 'Pop', name: 'Поп' },
  { id: 'Rock', name: 'Рок' },
  { id: 'Alternative', name: 'Альтернатива' },
  { id: 'R&B/Soul', name: 'R&B' },
  { id: 'Lo-Fi', name: 'Lo-Fi' },
  { id: 'House', name: 'Хаус' },
  { id: 'Techno', name: 'Техно' },
  { id: 'Ambient', name: 'Эмбиент' },
  { id: 'Jazz', name: 'Джаз' },
  { id: 'Classical', name: 'Классика' },
  { id: 'Metal', name: 'Метал' },
  { id: 'Latin', name: 'Латина' },
  { id: 'Soundtrack', name: 'Саундтреки' },
];

export const api = {
  async trending({ genre = '', time = 'week', limit = 30 } = {}) {
    const params = { time, limit };
    if (genre) params.genre = genre;
    const data = await audius('/tracks/trending', params);
    return (data || []).filter(playable).map(audiusTrack);
  },
  async trendingPlaylists({ time = 'week', limit = 12 } = {}) {
    const data = await audius('/playlists/trending', { time, limit });
    return (data || []).map(audiusPlaylist);
  },
  async searchTracks(q, limit = 30) {
    const data = await audius('/tracks/search', { query: q, limit });
    return (data || []).filter(playable).map(audiusTrack);
  },
  async searchUsers(q, limit = 10) {
    const data = await audius('/users/search', { query: q, limit });
    return (data || []).map(audiusUser);
  },
  async searchPlaylists(q, limit = 10) {
    const data = await audius('/playlists/search', { query: q, limit });
    return (data || []).map(audiusPlaylist);
  },
  async playlist(id) {
    const [meta, tracks] = await Promise.all([
      audius(`/playlists/${encodeURIComponent(id)}`),
      audius(`/playlists/${encodeURIComponent(id)}/tracks`),
    ]);
    const m = Array.isArray(meta) ? meta[0] : meta;
    return { ...audiusPlaylist(m || {}), id, tracks: (tracks || []).filter(playable).map(audiusTrack) };
  },
  async artist(id) {
    const [user, tracks] = await Promise.all([
      audius(`/users/${encodeURIComponent(id)}`),
      audius(`/users/${encodeURIComponent(id)}/tracks`, { limit: 50, sort: 'plays' }),
    ]);
    return { ...audiusUser(user || {}), tracks: (tracks || []).filter(playable).map(audiusTrack) };
  },

  /* ----------------------------- Radio ------------------------------ */
  radio: {
    async top(limit = 40) { return radio(`/json/stations/topclick/${limit}`); },
    async byCountry(code, limit = 40) {
      return radio(`/json/stations/bycountrycodeexact/${encodeURIComponent(code)}`, { order: 'clickcount', reverse: 'true', limit });
    },
    async byTag(tag, limit = 40) {
      return radio('/json/stations/search', { tag, order: 'clickcount', reverse: 'true', limit });
    },
    async search(name, limit = 40) {
      return radio('/json/stations/search', { name, order: 'clickcount', reverse: 'true', limit });
    },
  },
};

/* ---------------------------- Radio Browser ----------------------------- */

const RADIO_HOSTS = [
  'https://de1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];
let radioHost = null;

async function radio(path, params = {}) {
  const qs = new URLSearchParams({ hidebroken: 'true', ...params }).toString();
  const hosts = radioHost ? [radioHost, ...RADIO_HOSTS.filter((h) => h !== radioHost)] : RADIO_HOSTS;
  let lastErr;
  for (const host of hosts) {
    try {
      const data = await getJSON(`${host}${path}?${qs}`);
      radioHost = host;
      return normalizeStations(data);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Радио недоступно');
}

function normalizeStations(list) {
  const seen = new Set();
  const out = [];
  for (const s of list || []) {
    const url = s.url_resolved || s.url;
    if (!url) continue;
    // A page served over https can't play plain-http streams in the browser;
    // the native app allows them.
    if (!isNative && location.protocol === 'https:' && url.startsWith('http:')) continue;
    const nameKey = (s.name || '').trim().toLowerCase();
    if (seen.has(nameKey)) continue;
    seen.add(nameKey);
    const tags = (s.tags || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 3);
    out.push({
      key: `r:${s.stationuuid}`,
      source: 'radio',
      id: s.stationuuid,
      title: (s.name || 'Радио').trim(),
      artist: [s.country, tags.join(', ')].filter(Boolean).join(' · '),
      artwork: s.favicon && s.favicon.startsWith('https:') ? s.favicon : '',
      stream: url,
      live: true,
      bitrate: s.bitrate || 0,
      codec: s.codec || '',
    });
  }
  return out;
}

export const RADIO_TAGS = [
  { id: 'pop', name: 'Поп' },
  { id: 'rock', name: 'Рок' },
  { id: 'hip hop', name: 'Хип-хоп' },
  { id: 'dance', name: 'Танцевальная' },
  { id: 'electronic', name: 'Электроника' },
  { id: 'chillout', name: 'Чилаут' },
  { id: 'jazz', name: 'Джаз' },
  { id: 'classical', name: 'Классика' },
  { id: '80s', name: '80-е' },
  { id: '90s', name: '90-е' },
  { id: 'lofi', name: 'Lo-Fi' },
  { id: 'metal', name: 'Метал' },
];

export const RADIO_COUNTRIES = [
  { id: 'RU', name: 'Россия' },
  { id: 'UA', name: 'Украина' },
  { id: 'BY', name: 'Беларусь' },
  { id: 'KZ', name: 'Казахстан' },
  { id: 'US', name: 'США' },
  { id: 'GB', name: 'Великобритания' },
  { id: 'DE', name: 'Германия' },
  { id: 'FR', name: 'Франция' },
];
