// Audio engine: queue, shuffle/repeat, lock-screen controls (Media Session).
// Audio is streamed — nothing is stored on the device.
import { streamUrl } from './api.js';
import { store } from './store.js';

const audio = new Audio();
audio.preload = 'auto';
audio.crossOrigin = null;

const listeners = new Set();
const emit = (type) => listeners.forEach((fn) => fn(type));

const state = {
  queue: [],      // list of items in original order
  order: [],      // indices into queue (play order; shuffled when shuffle on)
  pos: -1,        // position in order
  shuffle: store.get('shuffle', false),
  repeat: store.get('repeat', 'off'), // off | all | one
  loading: false,
  errorStreak: 0,
};

function current() {
  const i = state.order[state.pos];
  return i == null ? null : state.queue[i];
}

function buildOrder(startIndex) {
  const idx = state.queue.map((_, i) => i);
  if (state.shuffle) {
    const rest = idx.filter((i) => i !== startIndex);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    state.order = startIndex == null ? rest : [startIndex, ...rest];
    state.pos = 0;
  } else {
    state.order = idx;
    state.pos = startIndex == null ? 0 : startIndex;
  }
}

function persist() {
  store.set('session', {
    queue: state.queue.slice(0, 200),
    index: state.order[state.pos] ?? 0,
  });
}

function load(item, autoplay = true) {
  state.loading = true;
  delete audio.dataset.pending;
  audio.src = streamUrl(item);
  updateMediaSession(item);
  emit('track');
  persist();
  if (autoplay) {
    const p = audio.play();
    if (p && p.catch) p.catch((e) => { if (e.name !== 'AbortError') { state.loading = false; emit('state'); } });
    store.pushRecent(item);
  }
}

export const player = {
  audio,
  state,
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  get current() { return current(); },
  get playing() { return !audio.paused && !audio.ended; },

  playList(list, index = 0) {
    if (!list.length) return;
    state.queue = list.slice();
    state.errorStreak = 0;
    buildOrder(index);
    load(current());
    emit('queue');
  },

  playAt(orderPos) {
    if (orderPos < 0 || orderPos >= state.order.length) return;
    state.pos = orderPos;
    load(current());
    emit('queue');
  },

  toggle() {
    if (!current()) return;
    if (audio.dataset.pending) {
      // Restored session: load the stream only when the user presses play.
      load(current(), true);
      return;
    }
    if (audio.paused) {
      // Live radio: reconnect so we play "now", not a stale buffer.
      if (current().live) audio.src = streamUrl(current());
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  },

  next(auto = false) {
    if (!state.order.length) return;
    if (auto && state.repeat === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    if (state.pos < state.order.length - 1) state.pos++;
    else if (state.repeat === 'all' || !auto) state.pos = 0;
    else { emit('state'); return; } // end of queue
    load(current());
    emit('queue');
  },

  prev() {
    if (!state.order.length) return;
    if (audio.currentTime > 3 && !current().live) { audio.currentTime = 0; return; }
    state.pos = state.pos > 0 ? state.pos - 1 : state.order.length - 1;
    load(current());
    emit('queue');
  },

  seek(fraction) {
    if (!isFinite(audio.duration) || current()?.live) return;
    audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
  },

  toggleShuffle() {
    state.shuffle = !state.shuffle;
    store.set('shuffle', state.shuffle);
    if (state.queue.length) {
      const cur = state.order[state.pos];
      buildOrder(cur);
    }
    emit('queue');
    return state.shuffle;
  },

  cycleRepeat() {
    state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
    store.set('repeat', state.repeat);
    emit('state');
    return state.repeat;
  },

  addNext(item) {
    if (!state.queue.length) { this.playList([item], 0); return; }
    state.queue.push(item);
    state.order.splice(state.pos + 1, 0, state.queue.length - 1);
    persist();
    emit('queue');
  },

  restore() {
    const s = store.get('session', null);
    if (!s || !Array.isArray(s.queue) || !s.queue.length) return;
    state.queue = s.queue;
    buildOrder(Math.min(s.index || 0, s.queue.length - 1));
    const item = current();
    if (!item) return;
    state.loading = false;
    updateMediaSession(item);
    // Do not set src until user presses play (saves traffic).
    audio.dataset.pending = '1';
    emit('track');
    emit('queue');
  },
};

audio.addEventListener('playing', () => { state.loading = false; state.errorStreak = 0; emit('state'); });
audio.addEventListener('pause', () => emit('state'));
audio.addEventListener('waiting', () => { state.loading = true; emit('state'); });
audio.addEventListener('canplay', () => { state.loading = false; emit('state'); });
audio.addEventListener('timeupdate', () => emit('time'));
audio.addEventListener('durationchange', () => emit('time'));
audio.addEventListener('ended', () => player.next(true));
audio.addEventListener('error', () => {
  if (!audio.src || audio.dataset.pending) return;
  state.loading = false;
  state.errorStreak++;
  emit('error');
  const item = current();
  // Skip broken tracks automatically (but don't loop forever).
  if (item && !item.live && state.errorStreak < 5 && state.order.length > 1) {
    setTimeout(() => player.next(true), 800);
  } else {
    emit('state');
  }
});

/* ---------------------- Lock screen / headset controls ---------------------- */
function updateMediaSession(item) {
  if (!('mediaSession' in navigator) || !item) return;
  const artwork = [];
  if (item.artwork) artwork.push({ src: item.artwork, sizes: '480x480' });
  if (item.artworkLarge) artwork.push({ src: item.artworkLarge, sizes: '1000x1000' });
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: item.title,
      artist: item.artist,
      album: item.live ? 'Радио' : 'Volna',
      artwork,
    });
  } catch { /* ignore */ }
}

if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch { /* unsupported */ } };
  set('play', () => player.toggle());
  set('pause', () => audio.pause());
  set('nexttrack', () => player.next());
  set('previoustrack', () => player.prev());
  set('seekto', (d) => { if (d.seekTime != null && isFinite(audio.duration)) audio.currentTime = d.seekTime; });
  audio.addEventListener('timeupdate', () => {
    if (!ms.setPositionState || !isFinite(audio.duration) || current()?.live) return;
    try { ms.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: 1 }); } catch { /* ignore */ }
  });
  audio.addEventListener('play', () => { ms.playbackState = 'playing'; });
  audio.addEventListener('pause', () => { ms.playbackState = 'paused'; });
}
