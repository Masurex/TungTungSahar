import { api, GENRES, RADIO_TAGS, RADIO_COUNTRIES } from './api.js';
import { player } from './player.js';
import { store } from './store.js';
import { icon } from './icons.js';

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

/* ------------------------------- helpers ------------------------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (sec) => {
  if (!isFinite(sec) || sec < 0) return '0:00';
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const fmtNum = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + ' млн' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + ' тыс.' : String(n || 0));
const imgOr = (src, kind = 'music', cls = '') => src
  ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph ${cls}',innerHTML:this.dataset.ph}))" data-ph='${icon(kind)}'>`
  : `<span class="ph ${cls}">${icon(kind)}</span>`;

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// Lists rendered in the current view, so delegated clicks can find the items.
let lists = {};
let listSeq = 0;
function registerList(items) {
  const id = 'l' + (++listSeq);
  lists[id] = items;
  return id;
}

/* ---------------------------- render pieces ---------------------------- */
function trackRow(item, listId, i, { numbered = false } = {}) {
  const liked = store.isLiked(item);
  const cur = player.current && player.current.key === item.key;
  const sub = item.live ? item.artist : `${item.artist}${item.duration ? ' · ' + fmtTime(item.duration) : ''}`;
  return `
  <div class="row${cur ? ' current' : ''}" data-key="${esc(item.key)}">
    <button class="row-main" data-act="play" data-list="${listId}" data-i="${i}">
      ${numbered ? `<span class="row-num">${i + 1}</span>` : ''}
      ${imgOr(item.artwork, item.live ? 'radio' : 'music', 'row-art')}
      <span class="row-text">
        <span class="row-title">${esc(item.title)}</span>
        <span class="row-sub">${esc(sub)}</span>
      </span>
      <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>
    <button class="icon-btn sm like${liked ? ' on' : ''}" data-act="like" data-list="${listId}" data-i="${i}" aria-label="Нравится">${icon(liked ? 'heartFill' : 'heart', 20)}</button>
    ${item.live ? '' : `<button class="icon-btn sm" data-act="queue" data-list="${listId}" data-i="${i}" aria-label="Играть следующим">${icon('plus', 20)}</button>`}
  </div>`;
}

function trackList(items, opts) {
  if (!items.length) return empty('Здесь пока пусто');
  const id = registerList(items);
  return `<div class="list">${items.map((t, i) => trackRow(t, id, i, opts)).join('')}</div>`;
}

function card({ href, img, title, sub, round = false, kind = 'music' }) {
  return `<a class="card${round ? ' round' : ''}" href="${esc(href)}">
    ${imgOr(img, kind, 'card-art')}
    <span class="card-title">${esc(title)}</span>
    <span class="card-sub">${esc(sub)}</span>
  </a>`;
}

const playlistCard = (p) => card({ href: `#/playlist/${p.id}`, img: p.artwork, title: p.name, sub: p.owner || `${p.count} треков` });
const artistCard = (u) => card({ href: `#/artist/${u.id}`, img: u.avatar, title: u.name, sub: `${fmtNum(u.followers)} подписчиков`, round: true, kind: 'user' });

function recentCard(item, listId, i) {
  return `<button class="card" data-act="play" data-list="${listId}" data-i="${i}">
    ${imgOr(item.artwork, item.live ? 'radio' : 'music', 'card-art')}
    <span class="card-title">${esc(item.title)}</span>
    <span class="card-sub">${esc(item.artist)}</span>
  </button>`;
}

const section = (title, body, extra = '') => `<section class="sec"><div class="sec-head"><h2>${esc(title)}</h2>${extra}</div>${body}</section>`;
const shelf = (html) => `<div class="shelf">${html}</div>`;
const chips = (items, active, attr) => `<div class="chips">${items.map((g) => `<button class="chip${g.id === active ? ' on' : ''}" data-${attr}="${esc(g.id)}">${esc(g.name)}</button>`).join('')}</div>`;
const empty = (msg) => `<div class="empty">${icon('music', 40)}<p>${esc(msg)}</p></div>`;
const skeleton = (n = 6) => `<div class="list">${Array.from({ length: n }, () => '<div class="row sk"><span class="row-art"></span><span class="row-text"><span></span><span></span></span></div>').join('')}</div>`;
const errorBox = (msg) => `<div class="empty err">${icon('music', 40)}<p>${esc(msg)}</p><button class="btn" data-act="retry">Повторить</button></div>`;

function setTitle(title, back = false) {
  $('#pageTitle').textContent = title;
  $('#backBtn').hidden = !back;
  document.title = title === 'Sahar' ? 'Sahar Музыка' : `${title} · Sahar`;
}

/* -------------------------------- views -------------------------------- */
let renderToken = 0;
const isStale = (t) => t !== renderToken;

async function guarded(token, slot, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(e);
    if (!isStale(token) && slot && slot.isConnected) slot.innerHTML = errorBox('Не удалось загрузить. Проверьте интернет.');
  }
}

const views = {
  async home(_, token) {
    setTitle(greeting());
    const genre = store.get('homeGenre', '');
    const recent = store.recent().slice(0, 12);
    let html = '';
    if (recent.length) {
      const id = registerList(recent);
      html += section('Недавно слушали', shelf(recent.map((t, i) => recentCard(t, id, i)).join('')));
    }
    html += section('Популярные плейлисты', '<div id="plSlot">' + shelf('<div class="card sk"></div>'.repeat(4)) + '</div>');
    html += section('В тренде', `${chips(GENRES, genre, 'genre')}<div id="trSlot">${skeleton(8)}</div>`,
      `<button class="btn sm" data-act="playall" data-slot="trSlot">${icon('play', 16)} Слушать</button>`);
    view.innerHTML = html;

    const pl = $('#plSlot'), tr = $('#trSlot');
    guarded(token, pl, async () => {
      const lists = await api.trendingPlaylists();
      if (isStale(token)) return;
      pl.innerHTML = lists.length ? shelf(lists.map(playlistCard).join('')) : empty('Нет плейлистов');
    });
    loadTrending(token, genre);
  },

  async search(_, token) {
    setTitle('Поиск');
    const q = store.get('lastSearch', '');
    view.innerHTML = `
      <div class="search-box">${icon('search', 20)}<input id="q" type="search" placeholder="Треки, исполнители, плейлисты" value="${esc(q)}" autocomplete="off" enterkeyhint="search"></div>
      <div id="searchSlot"></div>`;
    const input = $('#q');
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => runSearch(input.value.trim(), token), 400);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(timer); runSearch(input.value.trim(), token); input.blur(); } });
    runSearch(q, token);
    if (!q) setTimeout(() => input.focus({ preventScroll: true }), 50);
  },

  async genre([id], token) {
    const g = GENRES.find((x) => x.id === id) || { name: id };
    setTitle(g.name, true);
    view.innerHTML = `<div class="actions">${playButtons('genreSlot')}</div><div id="genreSlot">${skeleton(10)}</div>`;
    const slot = $('#genreSlot');
    guarded(token, slot, async () => {
      const tracks = await api.trending({ genre: id, limit: 50 });
      if (isStale(token)) return;
      slot.innerHTML = trackList(tracks, { numbered: true });
    });
  },

  async playlist([id], token) {
    setTitle('Плейлист', true);
    view.innerHTML = `<div id="plHead" class="hero sk"></div><div id="plTracks">${skeleton(8)}</div>`;
    const slot = $('#plTracks');
    guarded(token, slot, async () => {
      const pl = await api.playlist(id);
      if (isStale(token)) return;
      const saved = store.isPlaylistSaved(id);
      setTitle(pl.isAlbum ? 'Альбом' : 'Плейлист', true);
      $('#plHead').outerHTML = `
        <div class="hero">
          ${imgOr(pl.artwork, 'music', 'hero-art')}
          <div class="hero-text">
            <h2>${esc(pl.name)}</h2>
            <p>${esc(pl.owner)} · ${pl.tracks.length} треков</p>
          </div>
        </div>
        <div class="actions">${playButtons('plTracks')}
          <button class="icon-btn like${saved ? ' on' : ''}" data-act="savepl" aria-label="Сохранить">${icon(saved ? 'heartFill' : 'heart')}</button>
        </div>`;
      currentPlaylist = { id, name: pl.name, owner: pl.owner, artwork: pl.artwork, count: pl.tracks.length };
      slot.innerHTML = trackList(pl.tracks, { numbered: true });
    });
  },

  async artist([id], token) {
    setTitle('Исполнитель', true);
    view.innerHTML = `<div id="arHead" class="hero sk"></div><div id="arTracks">${skeleton(8)}</div>`;
    const slot = $('#arTracks');
    guarded(token, slot, async () => {
      const a = await api.artist(id);
      if (isStale(token)) return;
      setTitle(a.name, true);
      $('#arHead').outerHTML = `
        <div class="hero artist"${a.cover ? ` style="--cover:url('${esc(a.cover)}')"` : ''}>
          ${imgOr(a.avatar, 'user', 'hero-art round')}
          <div class="hero-text">
            <h2>${esc(a.name)}</h2>
            <p>${fmtNum(a.followers)} подписчиков</p>
          </div>
        </div>
        <div class="actions">${playButtons('arTracks')}</div>
        <h3 class="sub-h">Популярные треки</h3>`;
      slot.innerHTML = trackList(a.tracks, { numbered: true });
    });
  },

  async radio(_, token) {
    setTitle('Радио');
    const mode = store.get('radioMode', { type: 'top', id: '' });
    view.innerHTML = `
      <div class="search-box">${icon('search', 20)}<input id="rq" type="search" placeholder="Найти радиостанцию" autocomplete="off" enterkeyhint="search"></div>
      <div class="chips-label">Жанры</div>
      <div class="chips"><button class="chip${mode.type === 'top' ? ' on' : ''}" data-rtop="1">Популярное</button>${RADIO_TAGS.map((t) => `<button class="chip${mode.type === 'tag' && mode.id === t.id ? ' on' : ''}" data-rtag="${esc(t.id)}">${esc(t.name)}</button>`).join('')}</div>
      <div class="chips-label">Страны</div>
      ${chips(RADIO_COUNTRIES, mode.type === 'country' ? mode.id : null, 'rcountry')}
      <div id="radioSlot">${skeleton(8)}</div>`;
    const input = $('#rq');
    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim();
      timer = setTimeout(() => q.length > 1 ? loadRadio({ type: 'search', id: q }, token) : loadRadio(store.get('radioMode', { type: 'top' }), token), 450);
    });
    loadRadio(mode, token);
  },

  async library(_, token) {
    setTitle('Медиатека');
    const tab = store.get('libTab', 'tracks');
    const tabs = [
      { id: 'tracks', name: 'Любимые треки' },
      { id: 'stations', name: 'Радио' },
      { id: 'playlists', name: 'Плейлисты' },
      { id: 'recent', name: 'Недавние' },
    ];
    const likes = store.likes();
    let body = '';
    if (tab === 'tracks') {
      const tracks = likes.filter((t) => !t.live);
      body = tracks.length ? `<div class="actions">${playButtons('libList')}</div><div id="libList">${trackList(tracks)}</div>` : empty('Нажимайте ♡ у треков — они появятся здесь');
    } else if (tab === 'stations') {
      const st = likes.filter((t) => t.live);
      body = st.length ? trackList(st) : empty('Добавляйте радиостанции в избранное через ♡');
    } else if (tab === 'playlists') {
      const pls = store.playlists();
      body = pls.length ? `<div class="grid">${pls.map(playlistCard).join('')}</div>` : empty('Сохраняйте плейлисты через ♡ на их странице');
    } else {
      const rec = store.recent();
      body = rec.length ? trackList(rec) + '<div class="center"><button class="btn ghost" data-act="clearrecent">Очистить историю</button></div>' : empty('Вы ещё ничего не слушали');
    }
    view.innerHTML = `${chips(tabs, tab, 'libtab')}${body}`;
  },
};

let currentPlaylist = null;

function playButtons(slotId) {
  return `<button class="btn primary" data-act="playall" data-slot="${slotId}">${icon('play', 18)} Слушать</button>
          <button class="btn" data-act="shuffleall" data-slot="${slotId}">${icon('shuffle', 18)} Вперемешку</button>`;
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

async function loadTrending(token, genre) {
  const slot = $('#trSlot');
  if (!slot) return;
  slot.innerHTML = skeleton(8);
  await guarded(token, slot, async () => {
    const tracks = await api.trending({ genre, limit: 30 });
    if (isStale(token) || !slot.isConnected) return;
    slot.innerHTML = trackList(tracks, { numbered: true });
  });
}

async function runSearch(q, token) {
  store.set('lastSearch', q);
  const slot = $('#searchSlot');
  if (!slot) return;
  if (!q) {
    slot.innerHTML = section('Жанры', `<div class="genres">${GENRES.filter((g) => g.id).map((g, i) => `<a class="genre g${i % 8}" href="#/genre/${encodeURIComponent(g.id)}">${esc(g.name)}</a>`).join('')}</div>`);
    return;
  }
  slot.innerHTML = skeleton(8);
  const myToken = ++searchSeq;
  await guarded(token, slot, async () => {
    const [tracks, users, pls] = await Promise.all([
      api.searchTracks(q),
      api.searchUsers(q).catch(() => []),
      api.searchPlaylists(q).catch(() => []),
    ]);
    if (isStale(token) || myToken !== searchSeq || !slot.isConnected) return;
    let html = '';
    if (users.length) html += section('Исполнители', shelf(users.map(artistCard).join('')));
    if (pls.length) html += section('Плейлисты и альбомы', shelf(pls.map(playlistCard).join('')));
    html += section('Треки', tracks.length ? trackList(tracks) : empty('Ничего не найдено'));
    slot.innerHTML = html;
  });
}
let searchSeq = 0;

async function loadRadio(mode, token) {
  const slot = $('#radioSlot');
  if (!slot) return;
  slot.innerHTML = skeleton(8);
  const myToken = ++radioSeq;
  await guarded(token, slot, async () => {
    let list;
    if (mode.type === 'tag') list = await api.radio.byTag(mode.id);
    else if (mode.type === 'country') list = await api.radio.byCountry(mode.id);
    else if (mode.type === 'search') list = await api.radio.search(mode.id);
    else list = await api.radio.top();
    if (isStale(token) || myToken !== radioSeq || !slot.isConnected) return;
    slot.innerHTML = trackList(list);
  });
}
let radioSeq = 0;

/* -------------------------------- router -------------------------------- */
function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'home';
  const [name, ...params] = hash.split('/').map(decodeURIComponent);
  const fn = views[name] || views.home;
  lists = {};
  const token = ++renderToken;
  const tab = ['home', 'search', 'radio', 'library'].includes(name) ? name : (name === 'genre' ? 'search' : null);
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  fn(params, token);
  view.scrollTop = 0;
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* --------------------------- delegated events --------------------------- */
function itemsFromSlot(slotId) {
  const slot = document.getElementById(slotId);
  const btn = slot && slot.querySelector('[data-list]');
  return btn ? lists[btn.dataset.list] || [] : [];
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act],[data-genre],[data-rtag],[data-rcountry],[data-rtop],[data-libtab]');
  if (!el) return;
  const d = el.dataset;
  const list = d.list ? lists[d.list] : null;
  const item = list ? list[+d.i] : null;

  if (d.genre !== undefined) {
    store.set('homeGenre', d.genre);
    el.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === el));
    loadTrending(renderToken, d.genre);
    return;
  }
  if (d.rtag || d.rcountry || d.rtop) {
    const mode = d.rtag ? { type: 'tag', id: d.rtag } : d.rcountry ? { type: 'country', id: d.rcountry } : { type: 'top', id: '' };
    store.set('radioMode', mode);
    document.querySelectorAll('[data-rtag],[data-rcountry],[data-rtop]').forEach((c) => c.classList.toggle('on', c === el));
    const rq = $('#rq'); if (rq) rq.value = '';
    loadRadio(mode, renderToken);
    return;
  }
  if (d.libtab) { store.set('libTab', d.libtab); route(); return; }

  switch (d.act) {
    case 'play':
      if (!list) return;
      if (player.current && player.current.key === item.key) { player.toggle(); openPlayer(); return; }
      // Radio stations: play just the station but keep the list for next/prev.
      player.playList(list, +d.i);
      break;
    case 'like': {
      const on = store.toggleLike(item);
      el.classList.toggle('on', on);
      el.innerHTML = icon(on ? 'heartFill' : 'heart', 20);
      toast(on ? 'Добавлено в медиатеку' : 'Удалено из медиатеки');
      syncLike();
      break;
    }
    case 'queue':
      player.addNext(item);
      toast('Будет играть следующим');
      break;
    case 'playall':
    case 'shuffleall': {
      const items = itemsFromSlot(d.slot);
      if (!items.length) return;
      const wantShuffle = d.act === 'shuffleall';
      if (player.state.shuffle !== wantShuffle) player.toggleShuffle();
      player.playList(items, wantShuffle ? Math.floor(Math.random() * items.length) : 0);
      break;
    }
    case 'savepl':
      if (!currentPlaylist) return;
      {
        const on = store.togglePlaylist(currentPlaylist);
        el.classList.toggle('on', on);
        el.innerHTML = icon(on ? 'heartFill' : 'heart');
        toast(on ? 'Плейлист сохранён' : 'Плейлист удалён');
      }
      break;
    case 'clearrecent':
      store.clearRecent();
      route();
      break;
    case 'retry':
      route();
      break;
    case 'qplay':
      player.playAt(+d.pos);
      break;
  }
});

/* --------------------------------- player UI --------------------------------- */
const ui = {
  mini: $('#mini'), miniArt: $('#miniArt'), miniTitle: $('#miniTitle'), miniArtist: $('#miniArtist'),
  miniPlay: $('#miniPlay'), miniLike: $('#miniLike'), miniProgress: $('#miniProgress'),
  player: $('#player'), art: $('#playerArt'), bg: $('#playerBg'), title: $('#playerTitle'), artist: $('#playerArtist'),
  like: $('#playerLike'), seek: $('#seek'), cur: $('#tCur'), dur: $('#tDur'), play: $('#playBtn'),
  shuffle: $('#shuffleBtn'), repeat: $('#repeatBtn'), live: $('#liveBadge'), seekWrap: $('#seekWrap'),
  src: $('#playerSrc'), queue: $('#queue'), queueList: $('#queueList'),
};

// Static icons.
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
$('#backBtn').innerHTML = icon('back');
$('#playerClose').innerHTML = icon('down', 28);
$('#queueBtn').innerHTML = icon('queue');
$('#queueClose').innerHTML = icon('close');
$('#prevBtn').innerHTML = icon('prev', 30);
$('#nextBtn').innerHTML = icon('next', 30);
ui.shuffle.innerHTML = icon('shuffle');

const FALLBACK_ART = 'icons/icon.svg';

function syncTrack() {
  const t = player.current;
  ui.mini.hidden = !t;
  document.body.classList.toggle('has-mini', !!t);
  if (!t) return;
  const artSrc = t.artwork || FALLBACK_ART;
  ui.miniArt.src = artSrc;
  ui.art.src = t.artworkLarge || artSrc;
  ui.bg.style.backgroundImage = `url("${(t.artwork || FALLBACK_ART).replace(/"/g, '%22')}")`;
  ui.miniTitle.textContent = t.title;
  ui.miniArtist.textContent = t.artist;
  ui.title.textContent = t.title;
  ui.artist.textContent = t.artist;
  ui.artist.disabled = !t.artistId;
  ui.src.textContent = t.live ? 'Радио' : 'Сейчас играет';
  ui.live.hidden = !t.live;
  ui.seekWrap.hidden = !!t.live;
  ui.player.classList.toggle('is-live', !!t.live);
  syncLike();
  syncTime();
  // Highlight current row everywhere.
  document.querySelectorAll('.row.current').forEach((r) => r.classList.remove('current'));
  document.querySelectorAll(`.row[data-key="${CSS.escape(t.key)}"]`).forEach((r) => r.classList.add('current'));
}

function syncLike() {
  const t = player.current;
  if (!t) return;
  const on = store.isLiked(t);
  ui.like.innerHTML = icon(on ? 'heartFill' : 'heart');
  ui.miniLike.innerHTML = icon(on ? 'heartFill' : 'heart', 22);
  ui.like.classList.toggle('on', on);
  ui.miniLike.classList.toggle('on', on);
}

function syncState() {
  const playing = player.playing;
  const loading = player.state.loading && !player.audio.paused;
  ui.play.innerHTML = icon(playing ? 'pause' : 'play', 30);
  ui.miniPlay.innerHTML = icon(playing ? 'pause' : 'play', 26);
  ui.play.classList.toggle('loading', loading);
  ui.miniPlay.classList.toggle('loading', loading);
  document.body.classList.toggle('is-playing', playing);
  ui.shuffle.classList.toggle('on', player.state.shuffle);
  ui.repeat.innerHTML = icon(player.state.repeat === 'one' ? 'repeatOne' : 'repeat');
  ui.repeat.classList.toggle('on', player.state.repeat !== 'off');
}

let seeking = false;
function syncTime() {
  const a = player.audio;
  const t = player.current;
  const dur = isFinite(a.duration) ? a.duration : (t && t.duration) || 0;
  const frac = dur ? a.currentTime / dur : 0;
  ui.miniProgress.style.width = t && t.live ? '100%' : `${frac * 100}%`;
  if (!seeking) {
    ui.seek.value = Math.round(frac * 1000);
    ui.cur.textContent = fmtTime(a.currentTime);
  }
  ui.dur.textContent = fmtTime(dur);
  ui.seek.style.setProperty('--p', `${(seeking ? ui.seek.value / 10 : frac * 100)}%`);
}

function renderQueue() {
  if (ui.queue.hidden) return;
  const { order, queue, pos } = player.state;
  const upcoming = order.map((qi, p) => ({ item: queue[qi], p })).slice(Math.max(0, pos));
  ui.queueList.innerHTML = upcoming.map(({ item, p }) => `
    <button class="row q${p === pos ? ' current' : ''}" data-act="qplay" data-pos="${p}">
      ${imgOr(item.artwork, item.live ? 'radio' : 'music', 'row-art')}
      <span class="row-text"><span class="row-title">${esc(item.title)}</span><span class="row-sub">${esc(item.artist)}</span></span>
      <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>`).join('') || empty('Очередь пуста');
}

function openPlayer() {
  ui.player.classList.add('open');
  ui.player.setAttribute('aria-hidden', 'false');
  if (history.state?.player !== true) history.pushState({ player: true }, '');
}
function closePlayer(fromPop = false) {
  if (!ui.player.classList.contains('open')) return;
  ui.player.classList.remove('open');
  ui.player.setAttribute('aria-hidden', 'true');
  ui.queue.hidden = true;
  if (!fromPop && history.state?.player) history.back();
}
window.addEventListener('popstate', () => { if (ui.player.classList.contains('open')) closePlayer(true); });

player.on((type) => {
  if (type === 'track') syncTrack();
  if (type === 'state' || type === 'track') syncState();
  if (type === 'time') syncTime();
  if (type === 'queue') { syncState(); renderQueue(); }
  if (type === 'error') toast(player.current?.live ? 'Станция не отвечает, попробуйте другую' : 'Трек недоступен, пропускаю…');
});

ui.miniPlay.addEventListener('click', () => player.toggle());
ui.play.addEventListener('click', () => player.toggle());
$('#miniOpen').addEventListener('click', openPlayer);
$('#playerClose').addEventListener('click', () => closePlayer());
$('#nextBtn').addEventListener('click', () => player.next());
$('#prevBtn').addEventListener('click', () => player.prev());
ui.shuffle.addEventListener('click', () => toast(player.toggleShuffle() ? 'Перемешивание включено' : 'Перемешивание выключено'));
ui.repeat.addEventListener('click', () => {
  const r = player.cycleRepeat();
  toast(r === 'all' ? 'Повтор очереди' : r === 'one' ? 'Повтор трека' : 'Повтор выключен');
});
const likeCurrent = () => {
  const t = player.current; if (!t) return;
  toast(store.toggleLike(t) ? 'Добавлено в медиатеку' : 'Удалено из медиатеки');
  syncLike();
  document.querySelectorAll(`.row[data-key="${CSS.escape(t.key)}"] .like`).forEach((b) => {
    const on = store.isLiked(t); b.classList.toggle('on', on); b.innerHTML = icon(on ? 'heartFill' : 'heart', 20);
  });
};
ui.like.addEventListener('click', likeCurrent);
ui.miniLike.addEventListener('click', likeCurrent);
ui.artist.addEventListener('click', () => {
  const t = player.current;
  if (t && t.artistId) { closePlayer(); setTimeout(() => { location.hash = `#/artist/${t.artistId}`; }, 50); }
});
$('#queueBtn').addEventListener('click', () => { ui.queue.hidden = !ui.queue.hidden; renderQueue(); });
$('#queueClose').addEventListener('click', () => { ui.queue.hidden = true; });
$('#backBtn').addEventListener('click', () => (history.length > 1 ? history.back() : (location.hash = '#/home')));

ui.seek.addEventListener('input', () => {
  seeking = true;
  const a = player.audio;
  const dur = isFinite(a.duration) ? a.duration : player.current?.duration || 0;
  ui.cur.textContent = fmtTime((ui.seek.value / 1000) * dur);
  ui.seek.style.setProperty('--p', `${ui.seek.value / 10}%`);
});
ui.seek.addEventListener('change', () => { player.seek(ui.seek.value / 1000); seeking = false; });

// Swipe down to close the full player.
let touchY = null;
$('.player-head').addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
ui.art.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
ui.player.addEventListener('touchend', (e) => {
  if (touchY != null && e.changedTouches[0].clientY - touchY > 90) closePlayer();
  touchY = null;
});

// Keyboard shortcuts (desktop).
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  if (e.key === 'Escape') closePlayer();
});

/* --------------------------------- boot --------------------------------- */
player.restore();
syncState();
route();

if ('serviceWorker' in navigator && location.protocol === 'https:' && !window.Capacitor) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
