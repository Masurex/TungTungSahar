// Inline SVG icons (stroke-based, 24x24).
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>',
  library: '<path d="M4 4v16M9 4v16"/><path d="m14 4 6 15.5"/>',
  play: '<path d="M7 4.5v15a.5.5 0 0 0 .76.43l12.5-7.5a.5.5 0 0 0 0-.86L7.76 4.07A.5.5 0 0 0 7 4.5z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none"/>',
  next: '<path d="M5 5v14l11-7z" fill="currentColor" stroke="none"/><path d="M19 5v14"/>',
  prev: '<path d="M19 5v14L8 12z" fill="currentColor" stroke="none"/><path d="M5 5v14"/>',
  heart: '<path d="M12 20s-7.5-4.6-9.3-9.2C1.5 7.7 3.6 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.5 3.2 4.3 6.3C19.5 15.4 12 20 12 20z"/>',
  heartFill: '<path d="M12 20s-7.5-4.6-9.3-9.2C1.5 7.7 3.6 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.5 3.2 4.3 6.3C19.5 15.4 12 20 12 20z" fill="currentColor"/>',
  shuffle: '<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  repeatOne: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/><path d="M11 10h1v5" stroke-width="1.8"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  queue: '<path d="M3 6h13M3 12h13M3 18h9"/><path d="M17 15v6l4-3z" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
};

export function icon(name, size = 24) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
