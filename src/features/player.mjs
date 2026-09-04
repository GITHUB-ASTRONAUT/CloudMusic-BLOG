import * as api from '../lib/api.mjs';
import { currentSong, emit, isLoggedIn, savePrefs, state } from '../lib/store.mjs';
import { accentFromArt, bindPicker, openMenu, resetAccent, toast } from '../lib/ui.mjs';
import { art, artSameOrigin, buildLyrics, fmtDuration, fmtTime, html, normalizeSong, normalizeSongs, raw } from '../lib/util.mjs';
import { ico } from '../lib/icons.mjs';
import { isLiked, toggleLike } from './likes.mjs';

const MODES = ['list', 'one', 'shuffle', 'heart'];
const MODE_META = {
  list: { icon: 'repeat', label: '列表循环' },
  one: { icon: 'repeat-one', label: '单曲循环' },
  shuffle: { icon: 'shuffle', label: '随机播放' },
  heart: { icon: 'heart-beat', label: '心动模式' },
};

const LYRIC_SIZES = ['sm', 'md', 'lg', 'xl'];
const LYRIC_SIZE_LABEL = { sm: '小', md: '中', lg: '大', xl: '特大' };
const LYRIC_FONTS = [
  { key: 'sans', label: '默认 · 无衬线' },
  { key: 'serif', label: '宋体 · 衬线' },
  { key: 'kai', label: '楷体' },
  { key: 'round', label: '圆体' },
  { key: 'mono', label: '等宽' },
];

const dom = {};
let audio;
let loadToken = 0;
let scrubbing = false;
let skipStreak = 0;

/* ---------- slider helper ---------- */

function bindSlider(el, { onDrag, onCommit }) {
  const ratioOf = (event) => {
    const box = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
  };

  el.addEventListener('pointerdown', (event) => {
    el.setPointerCapture(event.pointerId);
    el.classList.add('is-dragging');
    if (el === dom.scrub) scrubbing = true;
    onDrag(ratioOf(event));
  });

  el.addEventListener('pointermove', (event) => {
    if (!el.classList.contains('is-dragging')) return;
    onDrag(ratioOf(event));
  });

  el.addEventListener('pointerup', (event) => {
    if (!el.classList.contains('is-dragging')) return;
    el.classList.remove('is-dragging');
    scrubbing = false;
    onCommit(ratioOf(event));
  });

  el.addEventListener('pointercancel', () => {
    el.classList.remove('is-dragging');
    scrubbing = false;
  });

  el.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const now = Number(el.getAttribute('aria-valuenow') || 0) / 100;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      onCommit(Math.min(1, now + step));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      onCommit(Math.max(0, now - step));
    }
  });
}

/* ---------- queue ---------- */

export function setQueue(songs, index = 0, label = '播放列表') {
  state.queue = songs.slice();
  state.queueLabel = label;
  emit('queue:changed');
  playAt(index);
}

export function enqueue(songs, { next: asNext = false } = {}) {
  const list = [].concat(songs).filter(Boolean);
  if (!list.length) return;
  if (asNext && state.index >= 0) state.queue.splice(state.index + 1, 0, ...list);
  else state.queue.push(...list);
  emit('queue:changed');
  toast(asNext ? `已插入 ${list.length} 首到下一首` : `已添加 ${list.length} 首到队列`, 'ok');
}

export function removeAt(index) {
  if (index < 0 || index >= state.queue.length) return;
  const wasCurrent = index === state.index;
  state.queue.splice(index, 1);
  if (index < state.index) state.index -= 1;
  if (wasCurrent) {
    if (state.queue.length) playAt(Math.min(index, state.queue.length - 1));
    else stop();
  }
  emit('queue:changed');
}

export function clearQueue() {
  state.queue = [];
  stop();
  emit('queue:changed');
}

function stop() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  state.index = -1;
  state.playing = false;
  state.lyrics = { synced: false, lines: [], plain: '' };
  resetAccent();
  renderTrackInfo();
  renderLyrics();
  emit('player:track');
}

/* ---------- playback ---------- */

// What the upstream actually handed back for the current track (level/br/size/
// trial window). Selected level != delivered level whenever the account cannot
// unlock the higher tier, so the UI reports both.
let nowMeta = null;

async function resolveUrl(song) {
  const attempt = async (level) => {
    const data = await api.songUrl(song.id, level);
    return data?.data?.[0] || null;
  };
  let entry = await attempt(state.level);
  if (!entry?.url && state.level !== 'standard') entry = await attempt('standard');
  return entry;
}

export async function playAt(index) {
  const song = state.queue[index];
  if (!song) return;
  state.index = index;
  state.lyrics = { synced: false, lines: [], plain: '' };
  state.lyricIndex = -1;
  nowMeta = null;
  renderTrackInfo();
  renderLyrics(true);
  emit('player:track');
  accentFromArt(artSameOrigin(song.cover, 220));

  const token = ++loadToken;
  let entry;
  try {
    entry = await resolveUrl(song);
  } catch (err) {
    toast(`${song.name}：${err.message}`, 'error');
    autoSkip();
    return;
  }
  if (token !== loadToken) return;

  if (!entry?.url) {
    const why = song.vip ? '需要 VIP' : song.blocked ? '无版权' : '没有可播放地址';
    toast(`${song.name} ${why}，已跳过`, 'error');
    autoSkip();
    return;
  }

  skipStreak = 0;
  nowMeta = {
    id: song.id,
    level: entry.level || '',
    br: Number(entry.br) || 0,
    size: Number(entry.size) || 0,
    trial: entry.freeTrialInfo || null,
  };
  refreshChips();
  emit('player:quality');
  audio.src = entry.url;
  audio.volume = state.muted ? 0 : state.volume;
  try {
    await audio.play();
  } catch (err) {
    if (err.name !== 'AbortError' && err.name !== 'NotSupportedError') {
      toast('浏览器拦截了自动播放，请再点一次播放键', 'info');
    }
  }
  const trial = trialSeconds();
  if (trial) toast(`仅试听片段（${trial} 秒）`, 'info');
  else if (entry.freeTrialInfo) toast('当前播放的是试听片段', 'info');
  loadLyrics(song.id, token);
  updateMediaSession(song);
}

// Guards against walking the whole queue when nothing is playable.
function autoSkip() {
  skipStreak += 1;
  if (skipStreak >= Math.min(5, Math.max(1, state.queue.length))) {
    skipStreak = 0;
    toast('连续多首都无法播放，已停下', 'error');
    return;
  }
  next(true);
}

export function toggle() {
  if (!currentSong()) {
    toast('队列是空的，先挑一首歌', 'info');
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}

export function next(auto = false) {
  if (!state.queue.length) return;
  if (state.mode === 'shuffle' && state.queue.length > 1) {
    let pick = state.index;
    while (pick === state.index) pick = Math.floor(Math.random() * state.queue.length);
    playAt(pick);
    return;
  }
  if (state.mode === 'heart' && state.index >= state.queue.length - 1) {
    // Refill from the current seed rather than looping back to the top.
    extendHeart().then((grew) => playAt(grew ? state.index + 1 : 0));
    return;
  }
  const last = state.index >= state.queue.length - 1;
  if (last && auto && state.queue.length === 1) {
    playAt(0);
    return;
  }
  playAt(last ? 0 : state.index + 1);
}

export function prev() {
  if (!state.queue.length) return;
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  playAt(state.index <= 0 ? state.queue.length - 1 : state.index - 1);
}

export function seekRatio(ratio) {
  if (!Number.isFinite(audio.duration) || !audio.duration) return;
  audio.currentTime = ratio * audio.duration;
}

export function seekTo(seconds) {
  if (!Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.min(audio.duration, Math.max(0, seconds));
}

export const nudge = (seconds) => seekTo(audio.currentTime + seconds);

export function setVolume(value) {
  state.volume = Math.min(1, Math.max(0, value));
  state.muted = state.volume === 0;
  audio.volume = state.volume;
  savePrefs();
  renderVolume();
}

export function toggleMute() {
  state.muted = !state.muted;
  audio.volume = state.muted ? 0 : state.volume;
  renderVolume();
}

export async function cycleMode() {
  const wanted = MODES[(MODES.indexOf(state.mode) + 1) % MODES.length];
  if (wanted === 'heart') {
    // Heart mode can refuse (no login / nothing liked): skip to list instead.
    if (await enterHeartMode()) return;
    state.mode = 'list';
    savePrefs();
    renderMode();
    return;
  }
  state.mode = wanted;
  savePrefs();
  renderMode();
  toast(MODE_META[wanted].label, 'info');
}

/* ---------- heart mode ---------- */

// Netease only accepts the account's own "我喜欢的音乐" playlist as the seed,
// and the seed song must already be in it -- anything else returns code 400.
let likedPid = 0;
let heartBusy = false;

async function resolveLikedPid() {
  if (likedPid) return likedPid;
  const data = await api.userPlaylist(state.profile.userId, 5, 0);
  const lists = data.playlist || [];
  const mine = lists.find((p) => p.specialType === 5) || lists[0];
  likedPid = mine?.id || 0;
  return likedPid;
}

// The intelligence endpoint mixes full songInfo rows with bare id rows, so
// anything that came back thin is refilled from /song/detail in batches.
async function hydrate(songs) {
  const thin = songs.filter((s) => !s.cover || !s.duration);
  if (!thin.length) return songs;
  const full = new Map();
  for (let i = 0; i < thin.length; i += 200) {
    try {
      const data = await api.songDetail(thin.slice(i, i + 200).map((s) => s.id));
      for (const song of normalizeSongs(data.songs || [], data.privileges || [])) full.set(song.id, song);
    } catch {
      /* keep the thin row rather than dropping the track */
    }
  }
  return songs.map((s) => full.get(s.id) || s);
}

async function fetchHeartList(seedId, exclude) {
  const pid = await resolveLikedPid();
  if (!pid) throw new Error('没找到「我喜欢的音乐」歌单');
  const data = await api.intelligenceList(seedId, pid, 60);
  const rows = data.data || data.result || [];
  const songs = [];
  for (const row of rows) {
    const raw = row.songInfo || row.song || row;
    const id = Number(raw?.id || row.id || row.songId || 0);
    if (!id || exclude.has(id)) continue;
    exclude.add(id);
    songs.push(normalizeSong(raw?.id ? raw : { id }));
  }
  return hydrate(songs);
}

// The seed is always the song in play, and the upstream only accepts one that
// already sits in 我喜欢的音乐 -- so an unliked track is refused up front
// instead of silently switching the user to some other song.
function pickSeed() {
  const song = currentSong();
  if (!song) return { error: '先播一首你喜欢的歌，再开心动模式' };
  if (!isLiked(song.id)) return { error: '心动模式要从你喜欢的歌开始，先给这首点个喜欢' };
  return { song };
}

export const isHeartMode = () => state.mode === 'heart';

async function enterHeartMode() {
  if (!isLoggedIn()) {
    emit('auth:required', '心动模式需要登录');
    return false;
  }
  if (heartBusy) return false;
  heartBusy = true;
  dom.mode?.classList.add('is-busy');
  try {
    const seed = pickSeed();
    if (seed.error) {
      toast(seed.error, 'info');
      return false;
    }
    const songs = await fetchHeartList(seed.song.id, new Set([seed.song.id]));
    if (!songs.length) throw new Error('上游没有返回心动列表');
    state.queue = [seed.song, ...songs];
    state.index = 0;
    state.queueLabel = `心动模式 · ${seed.song.name}`;
    state.mode = 'heart';
    savePrefs();
    emit('queue:changed');
    renderMode();
    emit('player:track');
    toast(`心动模式已开启，排好 ${songs.length + 1} 首`, 'ok');
    return true;
  } catch (err) {
    toast(err.message || '心动模式开启失败', 'error');
    return false;
  } finally {
    heartBusy = false;
    dom.mode?.classList.remove('is-busy');
  }
}

export async function toggleHeartMode() {
  if (state.mode !== 'heart') return enterHeartMode();
  state.mode = 'list';
  savePrefs();
  renderMode();
  toast('已退出心动模式，队列保留', 'info');
  return false;
}

// Keeps the heart queue rolling instead of wrapping to the first track.
async function extendHeart() {
  const song = currentSong();
  if (!song || heartBusy) return false;
  heartBusy = true;
  try {
    const songs = await fetchHeartList(song.id, new Set(state.queue.map((s) => s.id)));
    if (!songs.length) return false;
    state.queue.push(...songs);
    emit('queue:changed');
    return true;
  } catch {
    return false;
  } finally {
    heartBusy = false;
  }
}

/* ---------- lyrics ---------- */

async function loadLyrics(songId, token) {
  try {
    const payload = await api.lyric(songId);
    if (token !== loadToken) return;
    state.lyrics = buildLyrics(payload);
  } catch {
    state.lyrics = { synced: false, lines: [], plain: '歌词加载失败' };
  }
  state.lyricIndex = -1;
  renderLyrics();
  emit('lyrics:changed');
}

function voidLyric(icon, title, hint, extra = '') {
  return html`
    <div class="lyric-void ${extra}">
      <span class="lyric-void-mark">${raw(ico(icon))}</span>
      <strong>${title}</strong>
      <span>${hint}</span>
    </div>
  `;
}

function renderLyrics(loading = false) {
  const host = dom.npLyric;
  if (!host) return;
  const kind = dom.lyricKind;
  if (loading) {
    host.dataset.synced = '0';
    host.innerHTML = '<div class="lyric-void"><span class="lyric-void-mark is-spin">' + ico('refresh') + '</span><strong>歌词加载中…</strong></div>';
    if (kind) kind.textContent = '歌词';
    return;
  }
  const { synced, lines, plain, pure } = state.lyrics;
  host.dataset.synced = synced ? '1' : '0';
  if (synced) {
    if (kind) kind.textContent = lines.some((l) => l.trans) ? '歌词 · 含翻译' : '歌词 · 逐句同步';
    host.innerHTML = lines.map((line, i) => html`
      <div class="lyric-line" data-i="${i}" data-at="${line.at}">${line.words || '♪'}${line.trans ? raw(html`<span class="lyric-trans">${line.trans}</span>`) : ''}</div>
    `).join('');
    return;
  }
  if (pure) {
    if (kind) kind.textContent = '纯音乐';
    host.innerHTML = voidLyric('disc', '纯音乐，请欣赏', '这首曲子没有唱词，把音量调大一点吧。', 'is-pure');
    return;
  }
  if (plain) {
    if (kind) kind.textContent = '歌词 · 无时间轴';
    host.innerHTML = html`<div class="lyric-plain">${plain}</div>`;
    return;
  }
  if (kind) kind.textContent = '歌词';
  host.innerHTML = currentSong()
    ? voidLyric('quote', '这首歌还没有歌词', '网易云上暂时没有收录这首歌的歌词。')
    : voidLyric('disc', '还没有在播放', '随便挑一首歌，歌词会出现在这里。');
}

// offsetTop is measured against the nearest positioned ancestor, which is not
// always the scroller, so centre the line off measured rects instead.
function centerLyric(node, behavior = 'smooth') {
  const host = dom.npLyric;
  if (!host || !node) return;
  const delta = node.getBoundingClientRect().top - host.getBoundingClientRect().top;
  const top = host.scrollTop + delta - host.clientHeight / 2 + node.offsetHeight / 2;
  host.scrollTo({ top: Math.max(0, top), behavior });
}

/* Reading preferences: size / font / translation / blur / alignment.
   All of them are pure CSS switches driven by data-* on the scroller. */
function applyLyricPrefs({ recenter = true } = {}) {
  const host = dom.npLyric;
  if (!host) return;
  const pref = state.lyric;
  host.dataset.size = pref.size;
  host.dataset.font = pref.font;
  host.dataset.blur = pref.blur ? '1' : '0';
  host.dataset.trans = pref.trans ? '1' : '0';
  host.dataset.align = pref.align;
  if (dom.lyricSize) dom.lyricSize.textContent = LYRIC_SIZE_LABEL[pref.size] || '中';
  savePrefs();
  // Line heights just changed, so the active line is no longer on the midline.
  if (recenter) requestAnimationFrame(() => recenterLyric('auto'));
}

function stepLyricSize(delta) {
  const at = Math.max(0, LYRIC_SIZES.indexOf(state.lyric.size));
  const size = LYRIC_SIZES[Math.min(LYRIC_SIZES.length - 1, Math.max(0, at + delta))];
  if (size === state.lyric.size) {
    toast(delta > 0 ? '已经是最大字号' : '已经是最小字号', 'info');
    return;
  }
  state.lyric.size = size;
  applyLyricPrefs();
}

function openLyricStyleMenu(anchor) {
  const pref = state.lyric;
  const mark = (on) => (on ? 'check' : 'dot');
  const items = LYRIC_SIZES.map((size) => ({
    key: `size:${size}`,
    label: `字号 · ${LYRIC_SIZE_LABEL[size]}`,
    icon: mark(pref.size === size),
    onSelect() {
      pref.size = size;
      applyLyricPrefs();
    },
  }));
  items.push({ sep: true });
  items.push(...LYRIC_FONTS.map((font) => ({
    key: `font:${font.key}`,
    label: font.label,
    icon: pref.font === font.key ? 'check' : 'dot',
    onSelect() {
      pref.font = font.key;
      applyLyricPrefs();
    },
  })));
  items.push({ sep: true });
  items.push({
    key: 'trans',
    label: '显示翻译',
    icon: mark(pref.trans),
    onSelect() {
      pref.trans = !pref.trans;
      applyLyricPrefs();
      toast(pref.trans ? '已显示翻译' : '已隐藏翻译', 'info');
    },
  });
  items.push({
    key: 'blur',
    label: '模糊未唱歌词',
    icon: mark(pref.blur),
    onSelect() {
      pref.blur = !pref.blur;
      applyLyricPrefs();
    },
  });
  items.push({ sep: true });
  items.push({
    key: 'align',
    label: '居中对齐',
    icon: mark(pref.align === 'center'),
    onSelect() {
      pref.align = pref.align === 'center' ? 'left' : 'center';
      applyLyricPrefs();
    },
  });
  // The strip is hover-revealed, so pin it open while the menu (a body child,
  // therefore outside the hover target) is on screen.
  dom.lyricTools?.classList.add('is-open');
  openMenu(anchor, items);
  const menu = document.querySelector('.menu');
  if (menu) {
    const observer = new MutationObserver(() => {
      if (menu.isConnected) return;
      dom.lyricTools?.classList.remove('is-open');
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true });
  } else {
    dom.lyricTools?.classList.remove('is-open');
  }
}

export function recenterLyric(behavior = 'smooth') {
  const node = dom.npLyric?.querySelector('.lyric-line.is-active') || dom.npLyric?.querySelector('.lyric-line');
  centerLyric(node, behavior);
}

function syncLyric(timeMs) {
  const { synced, lines } = state.lyrics;
  if (!synced) return;
  let index = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].at <= timeMs + 240) index = i;
    else break;
  }
  if (index === state.lyricIndex) return;
  state.lyricIndex = index;
  const host = dom.npLyric;
  if (!host) return;
  host.querySelector('.lyric-line.is-active')?.classList.remove('is-active');
  for (const near of host.querySelectorAll('.lyric-line.is-near')) near.classList.remove('is-near');
  const all = host.querySelectorAll('.lyric-line');
  const node = all[index];
  if (!node) return;
  node.classList.add('is-active');
  all[index - 1]?.classList.add('is-near');
  all[index + 1]?.classList.add('is-near');
  if (!dom.nowPlaying.hidden) centerLyric(node);
}

/* ---------- rendering ---------- */

function renderTrackInfo() {
  const song = currentSong();
  dom.playbar.dataset.empty = song ? 'false' : 'true';

  if (!song) {
    dom.coverImg.removeAttribute('src');
    dom.name.textContent = '还没有在播放';
    dom.name.href = '#/discover';
    dom.artist.textContent = '选一首歌开始吧';
    dom.npName.textContent = '—';
    dom.npArtist.textContent = '';
    dom.npAlbum.textContent = '';
    dom.npCover.removeAttribute('src');
    dom.npBg.style.backgroundImage = '';
    dom.npBg.classList.remove('is-on');
    dom.npChips.innerHTML = '';
    dom.npSongLink.hidden = true;
    dom.npAlbumLink.hidden = true;
    dom.total.textContent = '0:00';
    dom.now.textContent = '0:00';
    dom.fill.style.width = '0%';
    dom.buffer.style.width = '0%';
    renderLike();
    return;
  }

  const cover = art(song.cover, 320);
  dom.coverImg.src = cover;
  dom.npCover.src = cover;
  if (song.cover) {
    dom.npBg.style.backgroundImage = `url("${art(song.cover, 480)}")`;
    dom.npBg.classList.add('is-on');
  } else {
    dom.npBg.style.backgroundImage = '';
    dom.npBg.classList.remove('is-on');
  }
  dom.name.textContent = song.name;
  dom.name.href = `#/song/${song.id}`;
  dom.artist.textContent = song.artists;
  dom.npName.textContent = song.name + (song.alia ? ` (${song.alia})` : '');
  dom.npArtist.textContent = song.artists;
  dom.npAlbum.textContent = song.albumName ? `专辑 · ${song.albumName}` : '';
  dom.npSongLink.hidden = false;
  dom.npSongLink.href = `#/song/${song.id}`;
  dom.npAlbumLink.hidden = !song.albumId;
  if (song.albumId) dom.npAlbumLink.href = `#/album/${song.albumId}`;
  renderNpChips(song);
  dom.total.textContent = fmtTime(song.duration / 1000);
  renderLike();
}

const LEVEL_LABEL = { standard: '标准', higher: '较高', exhigh: '极高', lossless: '无损', hires: 'Hi-Res' };
const LEVEL_OPTIONS = Object.entries(LEVEL_LABEL).map(([value, label]) => ({ value, label }));

function trialSeconds() {
  const info = nowMeta?.trial;
  if (!info) return 0;
  const start = Number(info.start) || 0;
  const end = Number(info.end) || 0;
  const span = end - start;
  if (span <= 0) return 0;
  // Upstream has shipped both seconds and milliseconds here.
  return Math.round(span > 600 ? span / 1000 : span);
}

function levelText(level) {
  return LEVEL_LABEL[level] || level || '';
}

function kbpsText() {
  return nowMeta?.br ? `${Math.round(nowMeta.br / 1000)}k` : '';
}

function sizeText() {
  const size = nowMeta?.size || 0;
  if (!size) return '';
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)}MB` : `${Math.round(size / 1024)}KB`;
}

// The picker shows what you asked for; the chip tells you what you got.
function pushLevelChips(chips) {
  const asked = levelText(state.level);
  if (!nowMeta) {
    chips.push({ text: asked, accent: true });
    return;
  }
  const got = levelText(nowMeta.level);
  const kbps = kbpsText();
  if (got && nowMeta.level !== state.level) {
    chips.push({ text: `${asked} → 实际 ${got}${kbps ? ` ${kbps}` : ''}`, warn: true });
  } else {
    chips.push({ text: kbps ? `${asked} ${kbps}` : asked, accent: true });
  }
  const trial = trialSeconds();
  if (trial) chips.push({ text: `试听 ${trial}s`, warn: true });
}

function renderLevelHint() {
  if (!dom.level) return;
  if (!nowMeta) {
    dom.level.title = '音质';
    dom.level.classList.remove('is-downgraded');
    return;
  }
  const parts = [`实际 ${levelText(nowMeta.level) || '未知'}`];
  const kbps = kbpsText();
  const size = sizeText();
  if (kbps) parts.push(`${kbps}bps`);
  if (size) parts.push(size);
  const trial = trialSeconds();
  if (trial) parts.push(`试听 ${trial}s`);
  const downgraded = Boolean(nowMeta.level) && nowMeta.level !== state.level;
  if (downgraded) parts.push(`已从${levelText(state.level)}降级`);
  dom.level.title = `音质 · ${parts.join(' · ')}`;
  dom.level.classList.toggle('is-downgraded', downgraded);
}

// Read-only view of the delivered stream, for pages that want to echo it.
export function nowQuality() {
  if (!nowMeta) return null;
  return {
    songId: nowMeta.id,
    askedLabel: levelText(state.level),
    actualLabel: levelText(nowMeta.level) || '未知',
    kbps: kbpsText(),
    size: sizeText(),
    trialSec: trialSeconds(),
    downgraded: Boolean(nowMeta.level) && nowMeta.level !== state.level,
  };
}

function renderNpChips(song) {
  const chips = [];
  if (song.duration) chips.push({ text: fmtDuration(song.duration) });
  pushLevelChips(chips);
  if (state.queue.length > 1) chips.push({ text: `队列 ${state.index + 1} / ${state.queue.length}` });
  chips.push({ text: MODE_META[state.mode].label });
  if (song.vip) chips.push({ text: 'VIP', warn: true });
  if (song.blocked) chips.push({ text: '无版权', warn: true });
  dom.npChips.innerHTML = chips
    .map((c) => html`<span class="chip ${c.accent ? 'chip-accent' : ''} ${c.warn ? 'chip-warn' : ''}">${c.text}</span>`)
    .join('');
}

export function renderLike() {
  if (!dom.like) return;
  const song = currentSong();
  const liked = song ? isLiked(song.id) : false;
  for (const button of [dom.like, dom.npLike]) {
    if (!button) continue;
    button.classList.toggle('is-liked', liked);
    button.innerHTML = ico(liked ? 'heart-fill' : 'heart');
  }
}

function renderPlayState() {
  dom.play.innerHTML = ico(state.playing ? 'pause' : 'play');
  dom.play.setAttribute('aria-label', state.playing ? '暂停' : '播放');
  dom.vinyl.classList.toggle('is-spinning', state.playing);
}

function refreshChips() {
  renderLevelHint();
  const song = currentSong();
  if (song) renderNpChips(song);
}

function renderMode() {
  const meta = MODE_META[state.mode];
  dom.mode.innerHTML = ico(meta.icon);
  dom.mode.title = meta.label;
  dom.mode.setAttribute('aria-label', meta.label);
  dom.mode.classList.toggle('is-on', state.mode !== 'list');
  refreshChips();
}

function renderVolume() {
  const shown = state.muted ? 0 : state.volume;
  dom.volFill.style.width = `${shown * 100}%`;
  dom.vol.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
  dom.mute.innerHTML = ico(shown === 0 ? 'volume-off' : 'volume');
}

function renderProgress() {
  const duration = Number.isFinite(audio.duration) && audio.duration
    ? audio.duration
    : (currentSong()?.duration || 0) / 1000;
  if (!scrubbing) {
    const ratio = duration ? Math.min(1, audio.currentTime / duration) : 0;
    dom.fill.style.width = `${ratio * 100}%`;
    dom.scrub.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    dom.now.textContent = fmtTime(audio.currentTime);
  }
  dom.total.textContent = fmtTime(duration);
  if (audio.buffered.length && duration) {
    const end = audio.buffered.end(audio.buffered.length - 1);
    dom.buffer.style.width = `${Math.min(1, end / duration) * 100}%`;
  }
}

function updateMediaSession(song) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.name,
      artist: song.artists,
      album: song.albumName,
      artwork: [{ src: art(song.cover, 512), sizes: '512x512', type: 'image/jpeg' }],
    });
    navigator.mediaSession.setActionHandler('play', () => toggle());
    navigator.mediaSession.setActionHandler('pause', () => toggle());
    navigator.mediaSession.setActionHandler('previoustrack', () => prev());
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
  } catch {
    /* not fatal */
  }
}

/* ---------- now playing panel ---------- */

/* ---------- immersive mode ---------- */

// Bottom edge of the viewport wakes the hidden playbar back up.
const onPeekMove = (event) => {
  document.body.classList.toggle('np-peek', event.clientY > innerHeight - 92);
};

function applyImmersive() {
  const on = state.npImmersive;
  const btn = dom.immersive;
  if (btn) {
    btn.title = on ? '常显播放栏' : '隐藏播放栏';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-on', on);
  }
  // Only hide the transport while the lyric overlay is actually up.
  const active = on && isNowPlayingOpen();
  document.body.classList.toggle('np-immersive', active);
  if (active) {
    document.addEventListener('pointermove', onPeekMove);
  } else {
    document.removeEventListener('pointermove', onPeekMove);
    document.body.classList.remove('np-peek');
  }
}

export function openNowPlaying() {
  dom.nowPlaying.hidden = false;
  dom.lyricBtn.classList.add('is-on');
  applyImmersive();
  refreshChips();
  state.lyricIndex = -1;
  // The scroller has no height until it is visible, so measure on the next frame.
  requestAnimationFrame(() => {
    syncLyric(audio.currentTime * 1000);
    recenterLyric();
  });
}

export function closeNowPlaying() {
  dom.nowPlaying.hidden = true;
  dom.lyricBtn.classList.remove('is-on');
  applyImmersive();
}

export const toggleNowPlaying = () => (dom.nowPlaying.hidden ? openNowPlaying() : closeNowPlaying());
export const isNowPlayingOpen = () => !dom.nowPlaying.hidden;

/* ---------- init ---------- */

export function initPlayer() {
  audio = document.getElementById('audio');
  Object.assign(dom, {
    playbar: document.getElementById('playbar'),
    cover: document.getElementById('pbCover'),
    coverImg: document.getElementById('pbCoverImg'),
    name: document.getElementById('pbName'),
    artist: document.getElementById('pbArtist'),
    like: document.getElementById('pbLike'),
    mode: document.getElementById('pbMode'),
    play: document.getElementById('pbPlay'),
    lyricBtn: document.getElementById('pbLyric'),
    scrub: document.getElementById('pbScrub'),
    fill: document.getElementById('pbFill'),
    buffer: document.getElementById('pbBuffer'),
    now: document.getElementById('pbNow'),
    total: document.getElementById('pbTotal'),
    level: document.getElementById('pbLevel'),
    mute: document.getElementById('pbMute'),
    vol: document.getElementById('pbVol'),
    volFill: document.getElementById('pbVolFill'),
    nowPlaying: document.getElementById('nowPlaying'),
    npLyric: document.getElementById('npLyric'),
    npCover: document.getElementById('npCover'),
    npName: document.getElementById('npName'),
    npArtist: document.getElementById('npArtist'),
    npAlbum: document.getElementById('npAlbum'),
    npBg: document.getElementById('npBg'),
    npChips: document.getElementById('npChips'),
    npLike: document.getElementById('npLike'),
    npSongLink: document.getElementById('npSongLink'),
    npAlbumLink: document.getElementById('npAlbumLink'),
    lyricKind: document.getElementById('npLyricKind'),
    lyricSize: document.getElementById('npLyricSize'),
    lyricSmaller: document.getElementById('npLyricSmaller'),
    lyricBigger: document.getElementById('npLyricBigger'),
    lyricStyle: document.getElementById('npLyricStyle'),
    lyricTools: document.querySelector('.np-lyric-tools'),
    lyricCenter: document.getElementById('npLyricCenter'),
    vinyl: document.getElementById('npVinyl'),
    immersive: document.getElementById('npImmersive'),
  });

  dom.play.onclick = () => toggle();
  dom.mode.onclick = () => cycleMode();
  document.getElementById('pbPrev').onclick = () => prev();
  document.getElementById('pbNext').onclick = () => next();
  dom.lyricBtn.onclick = () => toggleNowPlaying();
  dom.cover.onclick = () => toggleNowPlaying();
  document.getElementById('npClose').onclick = () => closeNowPlaying();
  dom.mute.onclick = () => toggleMute();
  const likeCurrent = () => {
    const song = currentSong();
    if (song) toggleLike(song.id);
  };
  dom.like.onclick = likeCurrent;
  dom.npLike.onclick = likeCurrent;
  dom.lyricCenter.onclick = () => recenterLyric();
  dom.lyricSmaller.onclick = () => stepLyricSize(-1);
  dom.lyricBigger.onclick = () => stepLyricSize(1);
  dom.lyricStyle.onclick = () => openLyricStyleMenu(dom.lyricStyle);
  dom.vinyl.onclick = () => toggle();
  dom.immersive.onclick = () => {
    state.npImmersive = !state.npImmersive;
    savePrefs();
    applyImmersive();
    toast(state.npImmersive ? '播放栏已隐藏，鼠标移到屏幕底部可唤出' : '播放栏已常显', 'info');
  };

  // Both links point at a hash; when we are already on that hash no
  // hashchange fires, so close the overlay by hand and scroll to the target.
  dom.npSongLink.onclick = (event) => {
    const song = currentSong();
    if (!song) return;
    closeNowPlaying();
    if (location.hash === `#/song/${song.id}`) {
      event.preventDefault();
      requestAnimationFrame(() => {
        document.querySelector('#view [data-detective]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };
  dom.npAlbumLink.onclick = () => closeNowPlaying();

  bindPicker(dom.level, {
    options: LEVEL_OPTIONS,
    value: state.level,
    async onChange(value) {
      state.level = value;
      savePrefs();
      refreshChips();
      if (!currentSong()) return;
      const resume = audio.currentTime;
      await playAt(state.index);
      audio.addEventListener('loadedmetadata', () => seekTo(resume), { once: true });
    },
  });

  bindSlider(dom.scrub, {
    onDrag(ratio) {
      dom.fill.style.width = `${ratio * 100}%`;
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      dom.now.textContent = fmtTime(ratio * duration);
    },
    onCommit: seekRatio,
  });

  bindSlider(dom.vol, { onDrag: setVolume, onCommit: setVolume });

  dom.npLyric.addEventListener('click', (event) => {
    const line = event.target.closest('.lyric-line');
    if (!line) return;
    seekTo(Number(line.dataset.at) / 1000);
  });

  audio.addEventListener('play', () => {
    state.playing = true;
    renderPlayState();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  });
  audio.addEventListener('pause', () => {
    state.playing = false;
    renderPlayState();
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  });
  audio.addEventListener('timeupdate', () => {
    renderProgress();
    syncLyric(audio.currentTime * 1000);
  });
  audio.addEventListener('progress', renderProgress);
  audio.addEventListener('loadedmetadata', renderProgress);
  audio.addEventListener('ended', () => {
    if (state.mode === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else {
      next(true);
    }
  });
  audio.addEventListener('error', () => {
    if (audio.currentSrc) toast('音频加载失败，链接可能已过期', 'error');
  });

  audio.volume = state.volume;
  renderTrackInfo();
  renderPlayState();
  renderMode();
  renderVolume();
  renderLyrics();
  applyLyricPrefs({ recenter: false });
  applyImmersive();
}
