const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

export const raw = (value) => ({ __raw: String(value ?? '') });

function part(value) {
  if (value == null || value === false || value === true) return '';
  if (Array.isArray(value)) return value.map(part).join('');
  if (typeof value === 'object' && '__raw' in value) return value.__raw;
  return esc(value);
}

// Auto-escaping template tag. Wrap trusted markup in raw() to opt out.
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += part(values[i]) + strings[i + 1];
  return out;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function frag(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content;
}

// Event delegation: fires when the event target sits inside `selector`.
export function delegate(root, type, selector, handler) {
  root.addEventListener(type, (event) => {
    const match = event.target.closest(selector);
    if (match && root.contains(match)) handler(event, match);
  });
}

export function debounce(fn, wait = 260) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* ---------- formatting ---------- */

export function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  if (m < 60) return `${m}:${s}`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}`;
}

export const fmtDuration = (ms) => fmtTime((ms || 0) / 1000);

export function fmtCount(n) {
  const value = Number(n) || 0;
  if (value >= 100000000) return `${(value / 100000000).toFixed(1).replace(/\.0$/, '')}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, '')}万`;
  return String(value);
}

const DAY = 86400000;

export function fmtWhen(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 3 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  const pad = (v) => String(v).padStart(2, '0');
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const head = sameYear ? '' : `${date.getFullYear()}-`;
  return `${head}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------- netease shapes ---------- */

// Netease's CDN serves art directly and fast, so <img> uses it as-is.
export function art(url, size = 0) {
  if (!url) return '';
  return size ? `${url}?param=${size}y${size}` : url;
}

// Canvas pixel reads need a same-origin copy, so colour sampling goes
// through our proxy instead. Failures here only cost the accent colour.
export function artSameOrigin(url, size = 0) {
  if (!url) return '';
  return `/api/__img?url=${encodeURIComponent(art(url, size))}`;
}

export function artistsOf(song) {
  const list = song?.ar || song?.artists || [];
  return list.map((a) => a?.name).filter(Boolean).join(' / ') || '未知艺人';
}

export function artistIdsOf(song) {
  return (song?.ar || song?.artists || []).map((a) => a?.id).filter(Boolean);
}

// Flattens the two song shapes the API returns (`ar/al/dt` and `artists/album/duration`).
export function normalizeSong(song, privilege) {
  if (!song) return null;
  const album = song.al || song.album || {};
  const priv = privilege || song.privilege || {};
  const fee = song.fee ?? priv.fee ?? 0;
  return {
    id: song.id,
    name: song.name || '未知歌曲',
    alia: (song.alia || song.alias || []).filter(Boolean).join(' / '),
    artists: artistsOf(song),
    artistIds: artistIdsOf(song),
    albumId: album.id || 0,
    albumName: album.name || '',
    cover: album.picUrl || song.picUrl || '',
    duration: song.dt || song.duration || 0,
    mv: song.mv || song.mvid || 0,
    fee,
    vip: fee === 1,
    // st < 0 means the track is greyed out for this account/region.
    blocked: (song.st ?? 0) < 0 || priv.st < 0,
    noCopyright: priv.cp === 0,
  };
}

export function normalizeSongs(songs = [], privileges = []) {
  const byId = new Map(privileges.map((p) => [p.id, p]));
  return songs.map((s) => normalizeSong(s, byId.get(s.id))).filter(Boolean);
}

/* ---------- lyrics ---------- */

const LRC_LINE = /^\s*((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+)(.*)$/;
const LRC_STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

function parseLrc(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = LRC_LINE.exec(line);
    if (!match) continue;
    const words = match[2].trim();
    LRC_STAMP.lastIndex = 0;
    let stamp;
    while ((stamp = LRC_STAMP.exec(match[1])) !== null) {
      const ms = stamp[3] ? Number(String(stamp[3]).padEnd(3, '0')) : 0;
      rows.push({ at: Number(stamp[1]) * 60000 + Number(stamp[2]) * 1000 + ms, words });
    }
  }
  return rows.sort((a, b) => a.at - b.at);
}

// Merges the original lyric with its translation into one timeline.
const isPureMusic = (payload, text) => payload?.pureMusic === true || /纯音乐/.test(text);

export function buildLyrics(payload) {
  // Instrumentals are flagged upstream. Trust that first: their "lyric" field is
  // just credits plus a 纯音乐 marker, which would otherwise render as verses.
  if (payload?.pureMusic === true) {
    return { synced: false, lines: [], plain: '', pure: true };
  }
  const main = parseLrc(payload?.lrc?.lyric);
  const trans = parseLrc(payload?.tlyric?.lyric);
  if (!main.length) {
    const plain = String(payload?.lrc?.lyric || '').trim();
    return { synced: false, lines: [], plain, pure: isPureMusic(payload, plain) };
  }
  const transAt = new Map(trans.map((row) => [row.at, row.words]));
  const lines = main
    .filter((row) => row.words || transAt.get(row.at))
    .map((row) => ({ at: row.at, words: row.words, trans: transAt.get(row.at) || '' }));
  // A single timestamped line is not a lyric track — instrumental releases ship
  // exactly one "[00:00.000] 纯音乐，请欣赏". Degrade it to plain text.
  if (lines.length <= 1) {
    const plain = lines.map((row) => [row.words, row.trans].filter(Boolean).join('\n')).join('\n').trim();
    return { synced: false, lines: [], plain, pure: isPureMusic(payload, plain) };
  }
  return { synced: true, lines, plain: '', pure: false };
}
