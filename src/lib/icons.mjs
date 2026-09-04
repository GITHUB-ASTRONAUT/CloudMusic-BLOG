// 24x24 stroke icons. Kept inline so the app needs no network or font assets.
const P = {
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.6 8.4-2.2 5.2-5.2 2.2 2.2-5.2z"/>',
  chart: '<path d="M4 20V10m5 10V4m5 16v-7m5 7V8"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  library: '<rect x="3" y="4" width="6" height="16" rx="1.6"/><rect x="11" y="4" width="4" height="16" rx="1.4"/><path d="M18 5.2l2.6 13.2"/>',
  queue: '<path d="M4 7h11M4 12h11M4 17h7"/><path d="M17.5 13.2V19a2 2 0 1 1-2-2c.8 0 2 .6 2 2z"/><path d="M17.5 13.2 21 12"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  'chevron-up': '<path d="m6 14 6-6 6 6"/>',
  'chevron-down': '<path d="m6 10 6 6 6-6"/>',
  'chevron-right': '<path d="m10 6 6 6-6 6"/>',
  heart: '<path d="M12 20s-7.2-4.5-7.2-9.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.2 3c0 4.9-7.2 9.4-7.2 9.4z"/>',
  'heart-fill': '<path d="M12 20s-7.2-4.5-7.2-9.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.2 3c0 4.9-7.2 9.4-7.2 9.4z" fill="currentColor"/>',
  'heart-beat': '<path d="M12 20s-7.2-4.5-7.2-9.4A4.1 4.1 0 0 1 12 7.6a4.1 4.1 0 0 1 7.2 3c0 4.9-7.2 9.4-7.2 9.4z"/><path d="M7.6 12.2h1.9l1.1-2.1 1.5 3.5 1-1.4h2.3"/>',
  repeat: '<path d="M4 9V8a3 3 0 0 1 3-3h10l-2.5-2.5M20 15v1a3 3 0 0 1-3 3H7l2.5 2.5"/>',
  'repeat-one': '<path d="M4 9V8a3 3 0 0 1 3-3h10l-2.5-2.5M20 15v1a3 3 0 0 1-3 3H7l2.5 2.5"/><path d="M12 15v-4l-1.4 1"/>',
  shuffle: '<path d="M4 6h3.4l9.2 12H20M4 18h3.4l2.6-3.4M14.4 8.6 16.6 6H20"/><path d="m17.6 3.4 2.4 2.6-2.4 2.6M17.6 15.4l2.4 2.6-2.4 2.6"/>',
  prev: '<path d="M18 6v12L9 12z" fill="currentColor" stroke="none"/><path d="M6 5.5v13"/>',
  next: '<path d="M6 6v12l9-6z" fill="currentColor" stroke="none"/><path d="M18 5.5v13"/>',
  play: '<path d="M8 5.2v13.6L19 12z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="7" y="5" width="3.4" height="14" rx="1.1" fill="currentColor" stroke="none"/><rect x="13.6" y="5" width="3.4" height="14" rx="1.1" fill="currentColor" stroke="none"/>',
  quote: '<path d="M9 7H5.5A1.5 1.5 0 0 0 4 8.5V12h4.6L7 17M19 7h-3.5A1.5 1.5 0 0 0 14 8.5V12h4.6L17 17"/>',
  volume: '<path d="M4 10v4h3l4 3.5v-11L7 10z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.4 7.4 0 0 1 0 10.4"/>',
  'volume-off': '<path d="M4 10v4h3l4 3.5v-11L7 10z"/><path d="m15.5 10 4 4m0-4-4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.2M12 7.9v.1"/>',
  alert: '<path d="M12 4.5 21 19.5H3z"/><path d="M12 10v4M12 16.9v.1"/>',
  check: '<path d="m5 12.8 4.4 4.2L19 7.4"/>',
  dot: '<circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" opacity="0.4"/>',
  more: '<circle cx="5.6" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.4" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  sliders: '<path d="M5 8h9M17.5 8H19M5 16h3M11.5 16H19"/><circle cx="15.6" cy="8" r="2.1"/><circle cx="9.6" cy="16" r="2.1"/>',
  target: '<circle cx="12" cy="12" r="7.6"/><path d="M12 4.4v2.4M12 17.2v2.4M4.4 12h2.4M17.2 12h2.4"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.6 4.5v15"/>',
  immersive: '<path d="M9 4.5H5.5a1 1 0 0 0-1 1V9M15 4.5h3.5a1 1 0 0 1 1 1V9M9 19.5H5.5a1 1 0 0 1-1-1V15M15 19.5h3.5a1 1 0 0 0 1-1V15"/>',
  'queue-next': '<path d="M4 7h9M4 12h9M4 17h5"/><path d="M16 8.5v7l5-3.5z" fill="currentColor" stroke="none"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.8 20a7.4 7.4 0 0 1 14.4 0"/>',
  logout: '<path d="M14 6h4.5A1.5 1.5 0 0 1 20 7.5v9a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 8.5 6.5 12l3.5 3.5M6.5 12H15"/>',
  comment: '<path d="M20 12.6c0 3.9-3.6 7-8 7a9 9 0 0 1-2.6-.4L5 21l1-3.5A6.6 6.6 0 0 1 4 12.6c0-3.9 3.6-7 8-7s8 3.1 8 7z"/>',
  reply: '<path d="M9 8.5 5 12l4 3.5"/><path d="M5 12h9a5 5 0 0 1 5 5v1"/>',
  thumb: '<path d="M7 10.5v9H4.6A1.6 1.6 0 0 1 3 17.9v-5.8a1.6 1.6 0 0 1 1.6-1.6z"/><path d="M7 10.5 11.4 4a2.2 2.2 0 0 1 2 3l-.8 3.5h5a1.9 1.9 0 0 1 1.8 2.4l-1.5 5.2a2.4 2.4 0 0 1-2.3 1.9H7"/>',
  trash: '<path d="M5 7h14M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.6 7l.8 11.4A1.6 1.6 0 0 0 9 20h6a1.6 1.6 0 0 0 1.6-1.6L17.4 7"/>',
  disc: '<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="2.6"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7"/><path d="M19.8 4.6v3.8H16"/>',
  detective: '<circle cx="10" cy="10.5" r="5.2"/><path d="m14.2 14.4 5 5.2"/><path d="M7.4 6.2 8.6 3.6a1.4 1.4 0 0 1 1.9-.7l1.6.8"/>',
  fire: '<path d="M12 21c3.6 0 6-2.3 6-5.4 0-3.9-3.6-5.2-3.2-9.6-2.1.6-3.4 2.3-3.4 4.2 0 1.3-.8 2-1.7 2-1 0-1.5-.7-1.6-1.7C6.7 12 6 13.5 6 15.6 6 18.7 8.4 21 12 21z"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.6V12l3.2 2"/>',
  download: '<path d="M12 4.5v10M8.2 11l3.8 3.8L15.8 11"/><path d="M5 18.5h14"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
  playlist: '<path d="M4 6h10M4 11h10M4 16h6"/><circle cx="17" cy="16" r="3"/><path d="M20 16V8l-3 1"/>',
};

export function svgOf(name) {
  const body = P[name] || P.info;
  return `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// Inline icon for use inside html`` templates.
export function ico(name) {
  return `<i class="ico">${svgOf(name)}</i>`;
}

// Replaces every <i data-ico="name"> placeholder with real SVG markup.
export function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll('i[data-ico]')) {
    node.innerHTML = svgOf(node.dataset.ico);
    node.removeAttribute('data-ico');
    node.classList.add('ico');
  }
}
