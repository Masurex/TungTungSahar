// Tiny persistent store on top of localStorage. Every access is guarded,
// so the app keeps working in private mode / when storage is blocked.
const PREFIX = 'volna:';
const listeners = new Set();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* ignore */ }
  listeners.forEach((fn) => fn(key));
}

export const store = {
  get: read,
  set: write,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // Liked tracks / stations: stored as normalized item objects (metadata only, no audio).
  likes() { return read('likes', []); },
  isLiked(item) { return this.likes().some((t) => t.key === item.key); },
  toggleLike(item) {
    const list = this.likes();
    const i = list.findIndex((t) => t.key === item.key);
    if (i >= 0) list.splice(i, 1);
    else list.unshift(item);
    write('likes', list);
    return i < 0;
  },

  // Saved playlists (only references).
  playlists() { return read('playlists', []); },
  isPlaylistSaved(id) { return this.playlists().some((p) => p.id === id); },
  togglePlaylist(pl) {
    const list = this.playlists();
    const i = list.findIndex((p) => p.id === pl.id);
    if (i >= 0) list.splice(i, 1);
    else list.unshift(pl);
    write('playlists', list);
    return i < 0;
  },

  // Recently played.
  recent() { return read('recent', []); },
  pushRecent(item) {
    const list = this.recent().filter((t) => t.key !== item.key);
    list.unshift(item);
    write('recent', list.slice(0, 30));
  },
  clearRecent() { write('recent', []); },
};
