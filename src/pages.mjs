import * as api from './lib/api.mjs';
import { isLoggedIn, state } from './lib/store.mjs';
import { emptyState, errorState, skeletonCards, skeletonRows, toast } from './lib/ui.mjs';
import { art, fmtCount, fmtDate, html, normalizeSong, normalizeSongs, raw } from './lib/util.mjs';
import { ico } from './lib/icons.mjs';
import { bindTracklist, statLine, syncTracklists, tracklistHtml } from './components/tracklist.mjs';
import { cardGrid, userCard } from './components/cards.mjs';
import * as player from './features/player.mjs';
import { avatarOf, openLogin } from './features/auth.mjs';
import { isLiked, toggleLike } from './features/likes.mjs';
import { mountComments, mountDetective } from './features/comments.mjs';

// Echoes the stream the player actually got, but only on the song that is
// currently loaded -- other song pages keep the slot hidden.
export function syncQuality(root = document) {
  const slots = root.querySelectorAll('[data-quality]');
  if (!slots.length) return;
  const info = player.nowQuality();
  for (const slot of slots) {
    if (!info || String(info.songId) !== slot.dataset.quality) {
      slot.hidden = true;
      slot.textContent = '';
      continue;
    }
    const bits = [`实际 ${info.actualLabel}`];
    if (info.kbps) bits.push(info.kbps);
    if (info.trialSec) bits.push(`试听 ${info.trialSec}s`);
    slot.textContent = bits.join(' · ');
    slot.title = info.downgraded ? `已请求${info.askedLabel}，上游降级为${info.actualLabel}` : `当前音质 ${info.actualLabel}${info.size ? ` · ${info.size}` : ''}`;
    slot.className = `chip ${info.downgraded || info.trialSec ? 'chip-warn' : 'chip-accent'}`;
    slot.hidden = false;
  }
}

function heroActions() {
  return html`
    <div class="hero-actions">
      <button class="btn btn-primary" data-act="play-all">${raw(ico('play'))}播放全部</button>
      <button class="btn" data-act="shuffle-all">${raw(ico('shuffle'))}随机播放</button>
      <button class="btn btn-ghost" data-act="queue-all">${raw(ico('plus'))}加入队列</button>
    </div>
  `;
}

function bindHeroActions(root, getSongs, label) {
  root.addEventListener('click', (event) => {
    const action = event.target.closest('[data-act]')?.dataset.act;
    if (!action) return;
    const songs = getSongs();
    if (!songs.length) return toast('没有可播放的歌曲', 'info');
    if (action === 'play-all') player.setQueue(songs, 0, label);
    else if (action === 'shuffle-all') player.setQueue(songs, Math.floor(Math.random() * songs.length), label);
    else if (action === 'queue-all') player.enqueue(songs);
  });
}

function loginWall(view, message) {
  view.innerHTML = html`<div class="page">${raw(emptyState(message, '登录后这里就会有内容', 'user'))}</div>`;
  const button = document.createElement('button');
  button.className = 'btn btn-primary';
  button.textContent = '立即登录';
  button.onclick = () => openLogin(message);
  view.querySelector('.empty').append(button);
}

/* ---------- discover ---------- */

export async function discover(view) {
  view.innerHTML = html`
    <div class="page">
      <section class="section" data-hot></section>
      <section class="section">
        <div class="section-head"><h2>推荐歌单</h2><span class="section-sub">网易云每天挑给你的</span></div>
        <div data-lists>${raw(skeletonCards(10))}</div>
      </section>
      <section class="section">
        <div class="section-head"><h2>排行榜</h2><a class="btn btn-sm btn-ghost" href="#/toplist">查看全部</a></div>
        <div data-tops>${raw(skeletonCards(5))}</div>
      </section>
    </div>
  `;

  const hotBox = view.querySelector('[data-hot]');
  const listBox = view.querySelector('[data-lists]');
  const topBox = view.querySelector('[data-tops]');

  api.searchHot().then((data) => {
    const rows = data?.data || [];
    if (!rows.length) return;
    hotBox.innerHTML = html`
      <div class="section-head"><span class="eyebrow">正在被听</span><h2>热搜榜</h2></div>
      <div class="tabs">${raw(rows.slice(0, 14).map((row, i) => html`
        <a class="tab" href="#/search/${encodeURIComponent(row.searchWord)}">
          <span style="color:var(--accent);font-weight:700;margin-right:6px">${i + 1}</span>${row.searchWord}
        </a>
      `).join(''))}</div>
    `;
  }).catch(() => {
    hotBox.remove();
  });

  api.personalized(12).then((data) => {
    const rows = data?.result || [];
    listBox.innerHTML = rows.length ? cardGrid(rows) : emptyState('暂时没有推荐歌单');
  }).catch((err) => {
    listBox.innerHTML = errorState(err);
    listBox.querySelector('[data-act="retry"]').onclick = () => discover(view);
  });

  api.toplist().then((data) => {
    const rows = (data?.list || []).slice(0, 10).map((item) => ({
      id: item.id,
      name: item.name,
      picUrl: item.coverImgUrl,
      copywriter: item.updateFrequency || '',
      playCount: item.playCount,
    }));
    topBox.innerHTML = rows.length ? cardGrid(rows) : emptyState('排行榜加载不出来');
  }).catch((err) => {
    topBox.innerHTML = errorState(err);
  });
}

export async function toplist(view) {
  view.innerHTML = html`<div class="page"><section class="section">
    <div class="section-head"><span class="eyebrow">Charts</span><h2>全部排行榜</h2></div>
    <div data-box>${raw(skeletonCards(12))}</div>
  </section></div>`;
  const box = view.querySelector('[data-box]');
  try {
    const data = await api.toplist();
    const rows = (data.list || []).map((item) => ({
      id: item.id,
      name: item.name,
      picUrl: item.coverImgUrl,
      copywriter: item.updateFrequency || item.description || '',
      playCount: item.playCount,
    }));
    box.innerHTML = cardGrid(rows);
  } catch (err) {
    box.innerHTML = errorState(err);
    box.querySelector('[data-act="retry"]').onclick = () => toplist(view);
  }
}

export async function daily(view) {
  if (!isLoggedIn()) return loginWall(view, '每日推荐需要登录才能生成');
  view.innerHTML = html`<div class="page">
    <div class="hero" data-hero>
      <div class="hero-art" style="display:grid;place-items:center;background:linear-gradient(140deg,var(--accent),hsl(calc(var(--accent-h) + 50) 80% 56%))">
        <div style="text-align:center;color:hsl(var(--accent-h) 60% 10%)">
          <div style="font-size:44px;font-weight:800;line-height:1">${new Date().getDate()}</div>
          <div style="font-size:12px;letter-spacing:0.2em;font-weight:700">${fmtDate(Date.now())}</div>
        </div>
      </div>
      <div class="hero-body">
        <span class="eyebrow">Daily Mix</span>
        <h1>每日歌曲推荐</h1>
        <p class="hero-desc">根据你的收听口味生成，每天 6:00 更新。</p>
        <div class="hero-facts" data-facts></div>
        ${raw(heroActions())}
      </div>
    </div>
    <section class="section"><div data-box>${raw(skeletonRows(10))}</div></section>
  </div>`;

  const box = view.querySelector('[data-box]');
  let songs = [];
  bindHeroActions(view.querySelector('[data-hero]'), () => songs, '每日推荐');

  try {
    const data = await api.dailySongs();
    songs = (data?.data?.dailySongs || []).map((song) => normalizeSong(song, song.privilege));
    view.querySelector('[data-facts]').textContent = `${songs.length} 首`;
    box.innerHTML = songs.length ? tracklistHtml(songs) : emptyState('今天没有推荐');
    bindTracklist(box.querySelector('[data-tracklist]'), () => songs, { title: '每日推荐' });
    syncTracklists(box);
  } catch (err) {
    box.innerHTML = errorState(err);
    box.querySelector('[data-act="retry"]').onclick = () => daily(view);
  }
}

/* ---------- search ---------- */

const SEARCH_TABS = [
  { key: 'song', label: '单曲' },
  { key: 'playlist', label: '歌单' },
  { key: 'user', label: '用户' },
];

export async function search(view, params) {
  const keywords = params.q || '';
  let tab = params.tab || 'song';

  view.innerHTML = html`<div class="page">
    <section class="section">
      <div class="section-head">
        <div>
          <span class="eyebrow">搜索</span>
          <h2>${keywords}</h2>
        </div>
        <div class="spacer"></div>
        <div class="tabs" data-tabs role="tablist">
          ${raw(SEARCH_TABS.map((t) => html`<button class="tab" role="tab" data-tab="${t.key}" aria-selected="${String(t.key === tab)}">${t.label}</button>`).join(''))}
        </div>
      </div>
      <div data-box>${raw(skeletonRows(8))}</div>
    </section>
  </div>`;

  const box = view.querySelector('[data-box]');

  view.querySelector('[data-tabs]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tab]');
    if (!button || button.dataset.tab === tab) return;
    tab = button.dataset.tab;
    for (const other of view.querySelectorAll('[data-tab]')) {
      other.setAttribute('aria-selected', String(other.dataset.tab === tab));
    }
    run();
  });

  async function run() {
    box.innerHTML = tab === 'song' ? skeletonRows(8) : skeletonCards(8);
    try {
      if (tab === 'song') {
        const data = await api.cloudsearch(keywords, 1, 60);
        const songs = normalizeSongs(data?.result?.songs || []);
        box.innerHTML = songs.length
          ? tracklistHtml(songs)
          : emptyState('没有匹配的歌曲', `换个关键词试试`);
        const listRoot = box.querySelector('[data-tracklist]');
        if (listRoot) {
          bindTracklist(listRoot, () => songs, { title: `搜索：${keywords}` });
          syncTracklists(box);
        }
      } else if (tab === 'playlist') {
        const data = await api.cloudsearch(keywords, 1000, 40);
        const rows = (data?.result?.playlists || []).map((item) => ({
          id: item.id,
          name: item.name,
          picUrl: item.coverImgUrl,
          copywriter: `${item.trackCount} 首 · ${fmtCount(item.playCount)} 次播放`,
        }));
        box.innerHTML = rows.length ? cardGrid(rows) : emptyState('没有匹配的歌单');
      } else {
        const data = await api.searchUsers(keywords, 40);
        const users = data?.result?.userprofiles || [];
        box.innerHTML = users.length ? cardGrid(users, userCard) : emptyState('没有匹配的用户');
      }
    } catch (err) {
      box.innerHTML = errorState(err);
      box.querySelector('[data-act="retry"]').onclick = run;
    }
  }

  run();
}

/* ---------- playlist / album ---------- */

export async function playlist(view, params) {
  const id = params.id;
  view.innerHTML = html`<div class="page">
    <div class="hero" data-hero>
      <div class="hero-art sk"></div>
      <div class="hero-body">
        <div class="sk sk-line" style="width:44%;height:26px"></div>
        <div class="sk sk-line" style="width:26%"></div>
      </div>
    </div>
    <section class="section"><div data-box>${raw(skeletonRows(10))}</div></section>
  </div>`;

  const hero = view.querySelector('[data-hero]');
  const box = view.querySelector('[data-box]');
  let songs = [];
  let detail = null;
  bindHeroActions(hero, () => songs, '歌单');

  try {
    const data = await api.playlistDetail(id);
    detail = data.playlist;
    if (!detail) throw new Error('歌单不存在');
    hero.innerHTML = html`
      <div class="hero-art"><img alt="" src="${art(detail.coverImgUrl, 500)}"></div>
      <div class="hero-body">
        <span class="eyebrow">歌单</span>
        <h1>${detail.name}</h1>
        <div class="hero-by">
          <img class="avatar" alt="" src="${avatarOf(detail.creator?.avatarUrl)}">
          <a href="#/user/${detail.creator?.userId}">${detail.creator?.nickname}</a>
          <span style="color:var(--ink-faint)">· ${fmtDate(detail.createTime)} 创建</span>
        </div>
        <div class="hero-facts">${statLine(detail)}</div>
        ${detail.description ? raw(html`<p class="hero-desc">${detail.description}</p>`) : ''}
        ${raw(heroActions())}
      </div>
    `;
  } catch (err) {
    view.innerHTML = html`<div class="page">${raw(errorState(err))}</div>`;
    view.querySelector('[data-act="retry"]').onclick = () => playlist(view, params);
    return;
  }

  const total = detail.trackCount || 0;
  const PAGE = 100;
  let offset = 0;

  box.innerHTML = html`<div data-list></div><div class="pager" data-more hidden></div>`;
  const listBox = box.querySelector('[data-list]');
  const moreBox = box.querySelector('[data-more]');

  async function loadMore() {
    moreBox.innerHTML = '<span class="pager-info">加载中…</span>';
    try {
      const data = await api.playlistTracks(id, PAGE, offset);
      const batch = normalizeSongs(data.songs || [], data.privileges || []);
      songs = songs.concat(batch);
      offset += batch.length;
      listBox.innerHTML = tracklistHtml(songs);
      bindTracklist(listBox.querySelector('[data-tracklist]'), () => songs, { title: detail.name });
      syncTracklists(listBox);
      if (offset < total && batch.length) {
        moreBox.hidden = false;
        moreBox.innerHTML = html`<button class="btn" data-act="more">继续加载（${offset} / ${total}）</button>`;
        moreBox.querySelector('[data-act="more"]').onclick = loadMore;
      } else {
        moreBox.hidden = true;
      }
    } catch (err) {
      moreBox.hidden = false;
      moreBox.innerHTML = html`<span class="pager-info" style="color:var(--danger)">${err.message}</span>`;
    }
  }

  listBox.innerHTML = skeletonRows(10);
  await loadMore();
}

export async function album(view, params) {
  const id = params.id;
  view.innerHTML = html`<div class="page">
    <div class="hero" data-hero><div class="hero-art sk"></div><div class="hero-body"><div class="sk sk-line" style="width:40%;height:26px"></div></div></div>
    <section class="section"><div data-box>${raw(skeletonRows(8))}</div></section>
  </div>`;
  const hero = view.querySelector('[data-hero]');
  const box = view.querySelector('[data-box]');
  let songs = [];
  bindHeroActions(hero, () => songs, '专辑');

  try {
    const data = await api.albumDetail(id);
    const info = data.album;
    songs = normalizeSongs(data.songs || []);
    hero.innerHTML = html`
      <div class="hero-art"><img alt="" src="${art(info.picUrl, 500)}"></div>
      <div class="hero-body">
        <span class="eyebrow">专辑</span>
        <h1>${info.name}</h1>
        <div class="hero-facts">${info.artist?.name} · ${fmtDate(info.publishTime)} · ${songs.length} 首</div>
        ${info.description ? raw(html`<p class="hero-desc">${info.description}</p>`) : ''}
        ${raw(heroActions())}
      </div>
    `;
    box.innerHTML = songs.length ? tracklistHtml(songs) : emptyState('这张专辑没有曲目');
    const listRoot = box.querySelector('[data-tracklist]');
    if (listRoot) {
      bindTracklist(listRoot, () => songs, { title: info.name });
      syncTracklists(box);
    }
  } catch (err) {
    view.innerHTML = html`<div class="page">${raw(errorState(err))}</div>`;
    view.querySelector('[data-act="retry"]').onclick = () => album(view, params);
  }
}

/* ---------- mine / queue / user ---------- */

export async function mine(view) {
  if (!isLoggedIn()) return loginWall(view, '登录后可以看到你的歌单');
  const render = () => {
    const lists = state.myPlaylists.map((item) => ({
      id: item.id,
      name: item.name,
      picUrl: item.coverImgUrl,
      copywriter: `${item.trackCount} 首`,
      playCount: item.playCount,
    }));
    view.innerHTML = html`<div class="page"><section class="section">
      <div class="section-head">
        <div><span class="eyebrow">${state.profile.nickname}</span><h2>我的歌单</h2></div>
        <div class="spacer"></div>
        <span class="section-sub">${lists.length} 个歌单</span>
      </div>
      ${raw(lists.length ? cardGrid(lists) : emptyState('还没有歌单'))}
    </section></div>`;
  };
  render();
  if (!state.myPlaylists.length) {
    const { loadMyPlaylists } = await import('./features/auth.mjs');
    await loadMyPlaylists();
    render();
  }
}

export async function queue(view) {
  const render = () => {
    const songs = state.queue;
    view.innerHTML = html`<div class="page"><section class="section">
      <div class="section-head">
        <div><span class="eyebrow">${state.queueLabel || '当前队列'}</span><h2>播放队列</h2></div>
        <div class="spacer"></div>
        <span class="section-sub">${songs.length} 首</span>
        ${songs.length ? raw('<button class="btn btn-sm btn-danger" data-act="clear">清空</button>') : ''}
      </div>
      <div data-box>${raw(songs.length ? tracklistHtml(songs, { removable: true }) : emptyState('队列是空的', '去发现页挑几首歌'))}</div>
    </section></div>`;

    const listRoot = view.querySelector('[data-tracklist]');
    if (listRoot) {
      bindTracklist(listRoot, () => state.queue, {
        title: state.queueLabel || '播放队列',
        onRemove(index) {
          player.removeAt(index);
          render();
        },
      });
      syncTracklists(view);
    }
    view.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
      player.clearQueue();
      render();
    });
  };
  render();
}

export async function user(view, params) {
  const uid = params.id;
  view.innerHTML = html`<div class="page">
    <div class="hero" data-hero><div class="hero-art sk" style="border-radius:50%"></div><div class="hero-body"><div class="sk sk-line" style="width:34%;height:26px"></div></div></div>
    <section class="section"><div data-box>${raw(skeletonCards(8))}</div></section>
  </div>`;
  const hero = view.querySelector('[data-hero]');
  const box = view.querySelector('[data-box]');

  try {
    const [detail, lists] = await Promise.all([
      api.userDetail(uid),
      api.userPlaylist(uid, 60).catch(() => ({ playlist: [] })),
    ]);
    const profile = detail.profile || {};
    hero.innerHTML = html`
      <div class="hero-art" style="border-radius:50%;width:150px;height:150px"><img alt="" src="${avatarOf(profile.avatarUrl)}"></div>
      <div class="hero-body">
        <span class="eyebrow">用户 · uid ${uid}</span>
        <h1>${profile.nickname || '未知用户'}</h1>
        <div class="hero-facts">
          <span>关注 ${fmtCount(profile.follows)}</span>
          <span>粉丝 ${fmtCount(profile.followeds)}</span>
          ${detail.listenSongs ? raw(html`<span>累计听歌 ${fmtCount(detail.listenSongs)}</span>`) : ''}
          ${detail.level ? raw(html`<span class="chip chip-accent">Lv.${detail.level}</span>`) : ''}
        </div>
        ${profile.signature ? raw(html`<p class="hero-desc">${profile.signature}</p>`) : ''}
      </div>
    `;
    const rows = (lists.playlist || []).map((item) => ({
      id: item.id,
      name: item.name,
      picUrl: item.coverImgUrl,
      copywriter: `${item.trackCount} 首`,
      playCount: item.playCount,
    }));
    box.innerHTML = rows.length ? cardGrid(rows) : emptyState('这位用户没有公开歌单');
  } catch (err) {
    view.innerHTML = html`<div class="page">${raw(errorState(err))}</div>`;
    view.querySelector('[data-act="retry"]').onclick = () => user(view, params);
  }
}

/* ---------- song ---------- */

export async function song(view, params) {
  const id = params.id;
  view.innerHTML = html`<div class="page">
    <div class="hero" data-hero><div class="hero-art sk"></div><div class="hero-body"><div class="sk sk-line" style="width:44%;height:26px"></div><div class="sk sk-line" style="width:24%"></div></div></div>
    <div data-detective></div>
    <div data-comments></div>
  </div>`;

  const hero = view.querySelector('[data-hero]');
  let current = null;

  try {
    const data = await api.songDetail(id);
    const rawSong = data.songs?.[0];
    if (!rawSong) throw new Error('找不到这首歌');
    current = normalizeSong(rawSong, data.privileges?.[0]);

    hero.innerHTML = html`
      <div class="hero-art"><img alt="" src="${art(current.cover, 500)}"></div>
      <div class="hero-body">
        <span class="eyebrow">单曲</span>
        <h1>${current.name}${current.alia ? raw(html` <span style="color:var(--ink-faint);font-weight:500">(${current.alia})</span>`) : ''}</h1>
        <div class="hero-facts">
          <span>${current.artists}</span>
          ${current.albumName ? raw(html`<span>·</span><a href="#/album/${current.albumId}">${current.albumName}</a>`) : ''}
          ${current.vip ? raw('<span class="chip chip-accent">VIP</span>') : ''}
          ${current.blocked ? raw('<span class="chip chip-warn">无版权</span>') : ''}
          <span class="chip" data-quality="${current.id}" hidden></span>
        </div>
        <div class="hero-actions">
          <button class="btn btn-primary" data-act="play">${raw(ico('play'))}播放</button>
          <button class="btn" data-act="next">${raw(ico('plus'))}下一首播放</button>
          <button class="btn btn-ghost ${isLiked(current.id) ? 'is-liked' : ''}" data-act="like">${raw(ico('heart'))}<span>${isLiked(current.id) ? '已喜欢' : '喜欢'}</span></button>
          <button class="btn btn-ghost" data-act="lyric">${raw(ico('quote'))}歌词</button>
          <button class="btn btn-ghost" data-act="heart" title="心动模式：需登录，且这首歌已在我喜欢的音乐里">${raw(ico('heart-beat'))}心动模式</button>
        </div>
      </div>
    `;

    syncQuality(view);

    hero.addEventListener('click', (event) => {
      const action = event.target.closest('[data-act]')?.dataset.act;
      if (action === 'play') player.setQueue([current], 0, current.name);
      else if (action === 'next') player.enqueue([current], { next: true });
      else if (action === 'like') toggleLike(current.id);
      else if (action === 'heart') {
        if (state.queue[state.index]?.id !== current.id) player.setQueue([current], 0, current.name);
        player.toggleHeartMode();
      }
      else if (action === 'lyric') {
        if (state.queue[state.index]?.id !== current.id) player.setQueue([current], 0, current.name);
        player.openNowPlaying();
      }
    });
  } catch (err) {
    view.innerHTML = html`<div class="page">${raw(errorState(err))}</div>`;
    view.querySelector('[data-act="retry"]').onclick = () => song(view, params);
    return;
  }

  mountDetective(view.querySelector('[data-detective]'), { id, type: 0, songName: current.name });
  mountComments(view.querySelector('[data-comments]'), { id, type: 0, title: '全部评论' });
}
