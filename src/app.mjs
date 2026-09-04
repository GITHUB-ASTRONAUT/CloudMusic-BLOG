import * as api from './lib/api.mjs';
import { on, savePrefs, state } from './lib/store.mjs';
import { toast } from './lib/ui.mjs';
import { $, debounce, html, normalizeSongs, raw } from './lib/util.mjs';
import { hydrateIcons, ico } from './lib/icons.mjs';
import { syncTracklists } from './components/tracklist.mjs';
import { enqueue, initPlayer, isNowPlayingOpen, closeNowPlaying, nudge, next, prev, renderLike, setQueue, toggle } from './features/player.mjs';
import { bootstrapSession, initAuth, renderAccount } from './features/auth.mjs';
import * as pages from './pages.mjs';

const ROUTES = [
  { pattern: /^\/?$/, page: 'discover' },
  { pattern: /^\/discover$/, page: 'discover' },
  { pattern: /^\/toplist$/, page: 'toplist' },
  { pattern: /^\/daily$/, page: 'daily' },
  { pattern: /^\/mine$/, page: 'mine' },
  { pattern: /^\/queue$/, page: 'queue' },
  { pattern: /^\/search\/(.+)$/, page: 'search', keys: ['q'] },
  { pattern: /^\/playlist\/(\d+)$/, page: 'playlist', keys: ['id'] },
  { pattern: /^\/album\/(\d+)$/, page: 'album', keys: ['id'] },
  { pattern: /^\/user\/(\d+)$/, page: 'user', keys: ['id'] },
  { pattern: /^\/song\/(\d+)$/, page: 'song', keys: ['id'] },
];

const TITLES = {
  discover: '发现',
  toplist: '排行榜',
  daily: '每日推荐',
  mine: '我的歌单',
  queue: '播放队列',
  search: '搜索',
  playlist: '歌单',
  album: '专辑',
  user: '用户',
  song: '单曲',
};

let renderToken = 0;

function parseHash() {
  const path = decodeURIComponent(location.hash.replace(/^#/, '')) || '/';
  for (const route of ROUTES) {
    const match = route.pattern.exec(path);
    if (!match) continue;
    const params = {};
    (route.keys || []).forEach((key, i) => {
      params[key] = match[i + 1];
    });
    return { page: route.page, params };
  }
  return { page: 'discover', params: {} };
}

async function renderRoute() {
  const { page, params } = parseHash();
  const view = $('#view');
  const token = ++renderToken;

  document.title = `${TITLES[page] || '紫听歌嘞'} · 紫听歌嘞 Purple Music`;
  markActiveNav(page);
  if (isNowPlayingOpen()) closeNowPlaying();

  const handler = pages[page] || pages.discover;
  try {
    await handler(view, params);
  } catch (err) {
    if (token !== renderToken) return;
    view.innerHTML = html`<div class="page"><div class="empty"><strong>页面出错了</strong><span>${err.message}</span></div></div>`;
    console.error(err);
  }
  if (token !== renderToken) return;
  hydrateIcons(view);
  syncTracklists(view);
  pages.syncQuality(view);
  view.scrollTop = 0;
}

function markActiveNav(page) {
  const wanted = { discover: '#/discover', toplist: '#/toplist', daily: '#/daily', mine: '#/mine', queue: '#/queue' }[page];
  for (const link of document.querySelectorAll('.rail-link')) {
    if (wanted && link.getAttribute('href') === wanted) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

/* ---------- omni search ---------- */

function initSearch() {
  const form = $('#searchForm');
  const input = $('#searchInput');
  const panel = $('#omniPanel');
  let controller = null;
  let cursor = -1;

  const items = () => [...panel.querySelectorAll('.sugg-item')];

  const close = () => {
    panel.hidden = true;
    cursor = -1;
  };

  const go = (keywords) => {
    const value = String(keywords || '').trim();
    if (!value) return;
    close();
    input.blur();
    location.hash = `#/search/${encodeURIComponent(value)}`;
  };

  const jump = (hash) => {
    close();
    input.blur();
    location.hash = hash;
  };

  // The suggestion payload is a lightweight shape, so resolve the real track
  // before it goes anywhere near the queue.
  async function withSong(songId, run) {
    try {
      const data = await api.songDetail(songId);
      const songs = normalizeSongs(data.songs || [], data.privileges || []);
      if (!songs.length) throw new Error('找不到这首歌');
      run(songs);
    } catch (err) {
      toast(err.message || '操作失败', 'error');
    }
  }

  const playNow = (songId, label) =>
    withSong(songId, (songs) => setQueue(songs, 0, label || songs[0].name));

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const active = items()[cursor];
    if (active) {
      active.click();
      return;
    }
    go(input.value);
  });

  function markCursor() {
    items().forEach((el, i) => el.classList.toggle('is-active', i === cursor));
    items()[cursor]?.scrollIntoView({ block: 'nearest' });
  }

  function group(label, rows) {
    if (!rows.length) return '';
    return html`<div class="sugg-group-label">${label}</div>${raw(rows.join(''))}`;
  }

  const suggest = debounce(async () => {
    const keywords = input.value.trim();
    if (!keywords) {
      close();
      return;
    }
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    try {
      // Keywords and real entities come from two different shapes of the same endpoint.
      const [words, entities] = await Promise.all([
        api.searchSuggest(keywords, signal).catch(() => null),
        api.searchSuggestWeb(keywords, signal).catch(() => null),
      ]);
      if (signal.aborted) return;

      const result = entities?.result || {};
      const songRows = (result.songs || []).slice(0, 5).map((s) => {
        const who = (s.artists || []).map((a) => a.name).filter(Boolean).join(' / ');
        const sub = [who, s.album?.name].filter(Boolean).join(' · ');
        return html`
          <div class="sugg-row">
            <button type="button" class="sugg-item" data-song="${s.id}">
              ${raw(ico('disc'))}<span class="sugg-name">${s.name}</span><span class="sugg-sub">${sub}</span>
            </button>
            <button type="button" class="icon-btn sugg-play" data-play="${s.id}" title="立即播放" aria-label="立即播放 ${s.name}">${raw(ico('play'))}</button>
            <button type="button" class="icon-btn sugg-play" data-next="${s.id}" title="下一首播放" aria-label="${s.name} 下一首播放">${raw(ico('queue-next'))}</button>
            <button type="button" class="icon-btn sugg-play" data-enqueue="${s.id}" title="加入队列" aria-label="${s.name} 加入队列">${raw(ico('plus'))}</button>
          </div>
        `;
      });

      const albumRows = (result.albums || []).slice(0, 3).map((a) => html`
        <button type="button" class="sugg-item" data-album="${a.id}">
          ${raw(ico('library'))}<span class="sugg-name">${a.name}</span><span class="sugg-sub">${(a.artist?.name) || ''}</span>
        </button>
      `);

      const artistRows = (result.artists || []).slice(0, 3).map((a) => html`
        <button type="button" class="sugg-item" data-kw="${a.name}">
          ${raw(ico('user'))}<span class="sugg-name">${a.name}</span><span class="sugg-sub">歌手</span>
        </button>
      `);

      const wordRows = (words?.result?.allMatch || []).slice(0, 6).map((row) => html`
        <button type="button" class="sugg-item" data-kw="${row.keyword}">
          ${raw(ico('search'))}<span class="sugg-name">${row.keyword}</span>
        </button>
      `);

      const body = [
        group('歌曲', songRows),
        group('歌手', artistRows),
        group('专辑', albumRows),
        group('猜你想搜', wordRows),
      ].join('');

      if (!body) {
        close();
        return;
      }
      panel.innerHTML = body + html`
        <div class="sugg-hint">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span>
        </div>
      `;
      cursor = -1;
      panel.hidden = false;
    } catch (err) {
      if (err.name !== 'AbortError') close();
    }
  }, 200);

  input.addEventListener('input', suggest);
  input.addEventListener('focus', () => {
    if (panel.innerHTML.trim() && input.value.trim()) panel.hidden = false;
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (panel.hidden || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    const all = items();
    if (!all.length) return;
    event.preventDefault();
    cursor += event.key === 'ArrowDown' ? 1 : -1;
    if (cursor >= all.length) cursor = -1;
    else if (cursor < -1) cursor = all.length - 1;
    markCursor();
  });

  panel.addEventListener('click', (event) => {
    const hit = event.target.closest('[data-kw], [data-song], [data-album], [data-play], [data-next], [data-enqueue]');
    if (!hit) return;
    const { kw, song, album, play, next: playNext, enqueue: addTail } = hit.dataset;
    if (play) {
      playNow(play, '搜索建议');
      close();
    } else if (playNext) {
      withSong(playNext, (songs) => enqueue(songs, { next: true }));
    } else if (addTail) {
      withSong(addTail, (songs) => enqueue(songs));
    } else if (song) {
      jump(`#/song/${song}`);
    } else if (album) {
      jump(`#/album/${album}`);
    } else if (kw) {
      input.value = kw;
      go(kw);
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (!form.contains(event.target)) close();
  });
}

/* ---------- keyboard ---------- */

/* ---------- sidebar ---------- */

function applyRail() {
  document.documentElement.classList.toggle('rail-mini', state.railOff);
  const btn = $('#railToggle');
  if (!btn) return;
  btn.title = state.railOff ? '展开侧栏' : '收起为图标';
  btn.setAttribute('aria-label', btn.title);
  btn.setAttribute('aria-pressed', String(state.railOff));
  btn.classList.toggle('is-on', state.railOff);
}

let railTimer = 0;

function toggleRail() {
  state.railOff = !state.railOff;
  savePrefs();
  /* Park the ambient blob animation for the duration of the slide so the
     compositor only has the rail and stage to worry about. */
  document.documentElement.classList.add('rail-animating');
  clearTimeout(railTimer);
  railTimer = setTimeout(() => document.documentElement.classList.remove('rail-animating'), 320);
  applyRail();
}

function initKeyboard() {
  document.addEventListener('keydown', (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable;

    if (event.key === '/' && !typing) {
      event.preventDefault();
      $('#searchInput').focus();
      return;
    }
    if (event.key === 'Escape' && isNowPlayingOpen()) {
      closeNowPlaying();
      return;
    }
    if (typing) return;

    if (event.code === 'Space') {
      event.preventDefault();
      toggle();
    } else if (event.key === 'ArrowRight' && event.shiftKey) {
      next();
    } else if (event.key === 'ArrowLeft' && event.shiftKey) {
      prev();
    } else if (event.key === 'ArrowRight') {
      nudge(5);
    } else if (event.key === 'ArrowLeft') {
      nudge(-5);
    } else if (event.key === 'b' || event.key === 'B') {
      toggleRail();
    }
  });
}

/* ---------- boot ---------- */

async function boot() {
  hydrateIcons(document);
  initPlayer();
  initAuth();
  initSearch();
  initKeyboard();

  applyRail();
  $('#railToggle').onclick = () => toggleRail();
  $('#navBack').onclick = () => history.back();

  // Clicking the wordmark behaves like a site logo: home, and re-fetch the page
  // even if we are already there. A full document reload would kill playback.
  $('#brandHome').onclick = (event) => {
    event.preventDefault();
    if (isNowPlayingOpen()) closeNowPlaying();
    const { page } = parseHash();
    if (page === 'discover') renderRoute();
    else location.hash = '#/discover';
  };

  // The sidebar tip collapses to a one-line link rather than vanishing, so the
  // choice stays reversible.
  const railHint = $('#railHint');
  const railHintOpen = $('#railHintOpen');
  const renderHint = () => {
    railHint.hidden = state.hintDismissed;
    railHintOpen.hidden = !state.hintDismissed;
  };
  const setHint = (dismissed) => {
    state.hintDismissed = dismissed;
    savePrefs();
    renderHint();
  };
  renderHint();
  $('#railHintClose').onclick = () => setHint(true);
  railHintOpen.onclick = () => setHint(false);
  $('#pbQueue').onclick = () => {
    location.hash = '#/queue';
  };

  on('player:track', () => {
    syncTracklists();
    renderLike();
    pages.syncQuality();
  });
  on('player:quality', () => pages.syncQuality());
  on('likes:changed', () => {
    syncTracklists();
    renderLike();
  });
  on('queue:changed', () => syncTracklists());

  // Resolve the session before the first paint so pages render once, not twice.
  await bootstrapSession();

  on('auth:changed', () => {
    renderAccount();
    const { page } = parseHash();
    if (page === 'daily' || page === 'mine' || page === 'song') renderRoute();
  });

  window.addEventListener('hashchange', renderRoute);
  await renderRoute();

  try {
    const hint = await api.searchDefault();
    const word = hint?.data?.realkeyword || hint?.data?.showKeyword;
    if (word) $('#searchInput').placeholder = `试试搜「${word}」`;
  } catch {
    /* placeholder is cosmetic */
  }
}

boot().catch((err) => {
  console.error(err);
  toast(`启动失败：${err.message}`, 'error');
});
