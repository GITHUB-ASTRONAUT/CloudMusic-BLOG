import * as api from '../lib/api.mjs';
import { isLoggedIn, state } from '../lib/store.mjs';
import { bindPicker, confirmDialog, emptyState, errorState, pickerHtml, skeletonRows, toast } from '../lib/ui.mjs';
import { esc, fmtCount, fmtWhen, html, raw } from '../lib/util.mjs';
import { ico } from '../lib/icons.mjs';
import { avatarOf, requireLogin } from './auth.mjs';

const SORTS = [
  { value: 3, label: '最新', icon: 'clock' },
  { value: 2, label: '最热', icon: 'fire' },
  { value: 1, label: '推荐', icon: 'sparkle' },
];

const PAGE_SIZE = 20;

/* ---------- detective tuning ---------- */

// Netease's own apps have no "filter comments by user" call, so the detective
// brute-forces the comment list. Two channels behave very differently:
//   hot pool  - /comment/hot, plain offset, random access, fully parallel,
//               but capped at the comments that ever got a like (a few thousand).
//   timeline  - /comment/music with before=<time>, which seeks to any instant in
//               history. Sharding that timeline is what makes the scan parallel;
//               /comment/new's cursor silently returns page 1 forever.
const SCAN_PAGE = 100;
const SCAN_CONCURRENCY = 6;
// One shard per worker: with more shards than workers the newest slices would
// hog every worker and the older eras would never get touched.
const SCAN_SHARDS = 6;
// Netease Cloud Music launched in April 2013; nothing can be older.
const TIMELINE_FLOOR = Date.parse('2013-04-01T00:00:00Z');

const SCAN_LANES = [
  { value: 'both', label: '最热池 + 时间线' },
  { value: 'hot', label: '只扫最热池' },
  { value: 'time', label: '只扫时间线' },
];

const SCAN_DEPTHS = [
  { value: 2000, label: '快速 · 约 2 千条' },
  { value: 10000, label: '标准 · 约 1 万条' },
  { value: 50000, label: '深挖 · 约 5 万条' },
  { value: 0, label: '扫到底 · 不设上限' },
];

function scanWindows() {
  const thisYear = new Date().getFullYear();
  const floorYear = new Date(TIMELINE_FLOOR).getFullYear();
  const years = [];
  for (let y = thisYear; y >= floorYear; y -= 1) years.push({ value: String(y), label: `${y} 年` });
  return [{ value: 'all', label: '全部时间' }, ...years];
}

function windowRange(value) {
  const now = Date.now();
  if (value === 'all') return { from: TIMELINE_FLOOR, to: now };
  // Local-time year boundaries: picking "2023 年" should mean 2023 as the user
  // reads dates, not 2023 shifted by the UTC offset.
  const year = Number(value);
  return {
    from: Math.max(TIMELINE_FLOOR, new Date(year, 0, 1).getTime()),
    to: Math.min(now, new Date(year + 1, 0, 1).getTime()),
  };
}

const monthLabel = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/* ---------- rendering ---------- */

// Escape for HTML first so the needle matches the already-escaped haystack.
function highlight(text, needle) {
  const safe = esc(text);
  if (!needle) return safe;
  const pattern = esc(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!pattern) return safe;
  return safe.replace(new RegExp(pattern, 'gi'), (match) => `<mark>${match}</mark>`);
}

function replyQuote(comment) {
  const parent = (comment.beReplied || [])[0];
  if (!parent) return '';
  const who = parent.user?.nickname || '已注销用户';
  const body = parent.status === -5 || parent.content == null ? '该评论已删除' : parent.content;
  return html`<div class="comment-quote"><b>@${who}：</b>${body}</div>`;
}

export function commentHtml(comment, opts = {}) {
  const user = comment.user || {};
  const location = comment.ipLocation?.location ? `· ${comment.ipLocation.location}` : '';
  const mine = isLoggedIn() && user.userId === state.profile.userId;
  return html`
    <article class="comment ${opts.extraClass || ''}" data-comment="${comment.commentId}" data-uid="${user.userId || 0}">
      <a href="#/user/${user.userId || 0}"><img class="avatar" loading="lazy" alt="" src="${avatarOf(user.avatarUrl)}"></a>
      <div class="comment-body">
        <div class="comment-head">
          <a class="comment-author" href="#/user/${user.userId || 0}">${user.nickname || '已注销用户'}</a>
          ${user.vipRights?.associator ? raw('<span class="chip chip-accent">VIP</span>') : ''}
          ${opts.badge ? raw(html`<span class="chip">${opts.badge}</span>`) : ''}
          <span class="comment-when">${fmtWhen(comment.time)} ${location}</span>
        </div>
        ${raw(replyQuote(comment))}
        <div class="comment-text">${raw(highlight(comment.content || '', opts.needle))}</div>
        <div class="comment-actions">
          <button class="comment-act ${comment.liked ? 'is-liked' : ''}" data-act="like" aria-label="点赞">
            ${raw(ico('thumb'))}<span>${comment.likedCount ? fmtCount(comment.likedCount) : '赞'}</span>
          </button>
          <button class="comment-act" data-act="reply">${raw(ico('reply'))}<span>回复</span></button>
          ${comment.replyCount > 0 ? raw(html`<button class="comment-act" data-act="floor">${raw(ico('comment'))}<span>${comment.replyCount} 条回复</span></button>`) : ''}
          ${mine ? raw(html`<button class="comment-act" data-act="del">${raw(ico('trash'))}<span>删除</span></button>`) : ''}
        </div>
        <div class="comment-floor" data-floor hidden></div>
      </div>
    </article>
  `;
}

/* ---------- comment section ---------- */

export function mountComments(host, { id, type = 0, title = '评论' }) {
  let sortType = 3;
  let pageNo = 1;
  let cursors = [undefined];
  let total = 0;
  let hasMore = false;
  let busy = false;

  host.innerHTML = html`
    <div class="section">
      <div class="section-head">
        <h2>${title}</h2>
        <span class="section-sub" data-total></span>
        <div class="spacer"></div>
        <div class="tabs" data-sorts role="tablist">
          ${raw(SORTS.map((s) => html`<button class="tab" role="tab" data-sort="${s.value}" aria-selected="${String(s.value === 3)}">${s.label}</button>`).join(''))}
        </div>
      </div>
      <div class="panel panel-pad" data-compose></div>
      <div data-list></div>
      <div class="pager" data-pager hidden>
        <button class="btn btn-sm" data-page="prev">上一页</button>
        <span class="pager-info" data-page-info></span>
        <button class="btn btn-sm" data-page="next">下一页</button>
      </div>
    </div>
  `;

  const list = host.querySelector('[data-list]');
  const pager = host.querySelector('[data-pager]');
  const pageInfo = host.querySelector('[data-page-info]');
  const totalLabel = host.querySelector('[data-total]');

  renderCompose();

  function renderCompose() {
    const box = host.querySelector('[data-compose]');
    if (!isLoggedIn()) {
      box.innerHTML = html`<div class="notice">${raw(ico('info'))}<span>登录后可以发表评论、点赞和回复。</span></div>`;
      return;
    }
    box.innerHTML = html`
      <div class="comment-compose">
        <img class="avatar" alt="" src="${avatarOf(state.profile.avatarUrl)}">
        <div class="comment-compose-body">
          <textarea class="field" data-input placeholder="说点什么…" maxlength="140"></textarea>
          <div class="comment-compose-foot">
            <span class="count" data-count>0 / 140</span>
            <button class="btn btn-primary btn-sm" data-act="send">发表</button>
          </div>
        </div>
      </div>
    `;
    const input = box.querySelector('[data-input]');
    const count = box.querySelector('[data-count]');
    input.oninput = () => {
      count.textContent = `${input.value.length} / 140`;
    };
    box.querySelector('[data-act="send"]').onclick = async (event) => {
      const content = input.value.trim();
      if (!content) return toast('先写点内容吧', 'info');
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await api.sendComment(id, content, type);
        input.value = '';
        count.textContent = '0 / 140';
        toast('评论已发表', 'ok');
        sortType = 3;
        syncSortTabs();
        await load(1, true);
      } catch (err) {
        toast(err.message || '发表失败', 'error');
      } finally {
        button.disabled = false;
      }
    };
  }

  function syncSortTabs() {
    for (const tab of host.querySelectorAll('[data-sort]')) {
      tab.setAttribute('aria-selected', String(Number(tab.dataset.sort) === sortType));
    }
  }

  async function load(page = 1, reset = false) {
    if (busy) return;
    busy = true;
    if (reset) cursors = [undefined];
    list.innerHTML = skeletonRows(6);
    pager.hidden = true;
    try {
      const data = await api.commentsNew(id, {
        type,
        pageNo: page,
        pageSize: PAGE_SIZE,
        sortType,
        cursor: sortType === 3 ? cursors[page - 1] : undefined,
      });
      const payload = data.data || {};
      const comments = payload.comments || [];
      total = payload.totalCount || 0;
      hasMore = Boolean(payload.hasMore);
      pageNo = page;

      if (sortType === 3) {
        const nextCursor = payload.cursor || comments.at(-1)?.time;
        cursors[page] = nextCursor ? String(nextCursor) : undefined;
      }

      totalLabel.textContent = total ? `共 ${fmtCount(total)} 条` : '';
      list.innerHTML = comments.length
        ? html`<div class="comment-list">${raw(comments.map((c) => commentHtml(c)).join(''))}</div>`
        : emptyState('这里还没有评论', '来做第一个说话的人', 'comment');
      pager.hidden = !(total > PAGE_SIZE);
      pageInfo.textContent = `第 ${pageNo} 页`;
      host.querySelector('[data-page="prev"]').disabled = pageNo <= 1;
      host.querySelector('[data-page="next"]').disabled = !hasMore;
    } catch (err) {
      list.innerHTML = errorState(err);
      list.querySelector('[data-act="retry"]').onclick = () => load(page, true);
    } finally {
      busy = false;
    }
  }

  host.querySelector('[data-sorts]').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-sort]');
    if (!tab) return;
    sortType = Number(tab.dataset.sort);
    syncSortTabs();
    load(1, true);
  });

  host.querySelector('[data-pager]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    load(button.dataset.page === 'next' ? pageNo + 1 : Math.max(1, pageNo - 1));
  });

  bindCommentActions(list, { id, type, onChanged: () => load(pageNo) });
  load(1, true);

  return { reload: () => load(pageNo), renderCompose };
}

/* ---------- shared comment interactions ---------- */

export function bindCommentActions(root, { id, type = 0, onChanged } = {}) {
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const article = button.closest('[data-comment]');
    if (!article) return;
    const commentId = article.dataset.comment;
    const action = button.dataset.act;

    if (action === 'like') {
      if (!requireLogin('登录后才能给评论点赞')) return;
      const liked = button.classList.contains('is-liked');
      const label = button.querySelector('span');
      button.disabled = true;
      try {
        await api.likeComment(id, commentId, !liked, type);
        button.classList.toggle('is-liked', !liked);
        const shown = Number(String(label.textContent).replace(/[^\d]/g, '')) || 0;
        const nextCount = Math.max(0, shown + (liked ? -1 : 1));
        label.textContent = nextCount ? fmtCount(nextCount) : '赞';
      } catch (err) {
        toast(err.message || '点赞失败', 'error');
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (action === 'reply') {
      if (!requireLogin('登录后才能回复评论')) return;
      openReplyBox(article, { id, type, commentId, onChanged });
      return;
    }

    if (action === 'floor') {
      toggleFloor(article, { id, type, commentId });
      return;
    }

    if (action === 'del') {
      const yes = await confirmDialog({ title: '删除这条评论？', body: '删除后无法恢复。', confirmText: '删除', danger: true });
      if (!yes) return;
      try {
        await api.deleteComment(id, commentId, type);
        toast('已删除', 'ok');
        onChanged?.();
      } catch (err) {
        toast(err.message || '删除失败', 'error');
      }
    }
  });
}

function openReplyBox(article, { id, type, commentId, onChanged }) {
  const floor = article.querySelector('[data-floor]');
  if (floor.querySelector('[data-reply-box]')) {
    floor.querySelector('[data-reply-box]').remove();
    return;
  }
  const box = document.createElement('div');
  box.dataset.replyBox = '1';
  box.style.marginTop = '8px';
  box.innerHTML = html`
    <textarea class="field" data-input placeholder="回复…" maxlength="140"></textarea>
    <div class="comment-compose-foot" style="margin-top:8px">
      <button class="btn btn-sm" data-act-reply="cancel">取消</button>
      <button class="btn btn-primary btn-sm" data-act-reply="send">回复</button>
    </div>
  `;
  floor.hidden = false;
  floor.prepend(box);
  const input = box.querySelector('[data-input]');
  input.focus();
  box.querySelector('[data-act-reply="cancel"]').onclick = () => box.remove();
  box.querySelector('[data-act-reply="send"]').onclick = async (event) => {
    const content = input.value.trim();
    if (!content) return;
    event.currentTarget.disabled = true;
    try {
      await api.replyComment(id, content, commentId, type);
      toast('回复成功', 'ok');
      box.remove();
      onChanged?.();
    } catch (err) {
      toast(err.message || '回复失败', 'error');
      event.currentTarget.disabled = false;
    }
  };
}

async function toggleFloor(article, { id, type, commentId }) {
  const floor = article.querySelector('[data-floor]');
  if (floor.dataset.loaded === '1') {
    floor.hidden = !floor.hidden;
    return;
  }
  floor.hidden = false;
  floor.innerHTML = skeletonRows(2);
  try {
    const data = await api.commentFloor(commentId, id, { type, limit: 30 });
    const rows = data?.data?.comments || [];
    floor.dataset.loaded = '1';
    floor.innerHTML = rows.length
      ? rows.map((c) => commentHtml(c)).join('')
      : '<p class="form-hint">没有更多回复了</p>';
  } catch (err) {
    floor.innerHTML = html`<p class="form-error">${err.message}</p>`;
  }
}

/* ---------- the comment detective ---------- */

export function mountDetective(host, { id, type = 0, songName = '' }) {
  let picked = null;
  let running = false;
  let abort = null;

  host.innerHTML = html`
    <div class="section scan">
      <div class="section-head">
        <div>
          <span class="eyebrow">评论侦探</span>
          <h2>在这首歌里找某个人的评论</h2>
        </div>
        <button class="icon-btn" data-act="explain" title="它怎么工作" aria-label="它怎么工作" aria-expanded="false" style="margin-left:auto">${raw(ico('info'))}</button>
      </div>
      <p class="form-hint" data-explain hidden>
        网易云没有“按用户筛选评论”的接口，所以这里并发翻页拉取 ${songName ? `《${songName}》` : '本曲'} 的评论再在本地比对。
        先秒扫<b>最热池</b>（所有被点过赞的评论），再把<b>时间线</b>切成 ${SCAN_SHARDS} 段并行倒查，命中随时冒出来。
        几十万条评论的歌没法全扫完，若大致知道对方是哪年评论的，选一下<b>时段</b>会快很多。
        因为读的是歌曲评论区本身，对方即使在设置里<b>隐藏了自己的历史评论</b>，留在这首歌下的那几条照样查得到。
      </p>
      <div class="scan-form">
        <div class="scan-target">
          <input class="field" data-who placeholder="输入昵称关键词，或搜索并锁定具体用户" aria-label="目标用户">
          <div class="omni-panel" data-who-panel hidden></div>
        </div>
        <input class="field" data-kw style="flex:1 1 190px" placeholder="评论内容包含（可选）" aria-label="内容关键词">
        <button class="btn btn-primary" data-act="scan">${raw(ico('detective'))}开始扫描</button>
      </div>
      <div data-picked></div>
      <div class="scan-opts">
        <label>范围 ${raw(pickerHtml(SCAN_LANES, 'both', { attr: 'data-lane' }))}</label>
        <label>强度 ${raw(pickerHtml(SCAN_DEPTHS, 10000, { attr: 'data-depth' }))}</label>
        <label>时段 ${raw(pickerHtml(scanWindows(), 'all', { attr: 'data-window' }))}</label>
        <span data-cap></span>
      </div>
      <div class="scan-progress" data-progress hidden>
        <div class="scan-stats">
          <span>已扫描<b data-stat-scanned>0</b></span>
          <span>命中<b data-stat-hits>0</b></span>
          <span>页数<b data-stat-pages>0</b></span>
          <span>耗时<b data-stat-time>0.0s</b></span>
          <span style="margin-left:auto"><button class="btn btn-sm btn-danger" data-act="stop" hidden>${raw(ico('stop'))}停止</button></span>
        </div>
        <div class="scan-bar"><div class="scan-bar-fill" data-bar style="width:0%"></div></div>
        <p class="form-hint" data-note></p>
      </div>
      <div class="scan-more" data-more hidden></div>
      <div class="scan-results" data-results></div>
    </div>
  `;

  const whoInput = host.querySelector('[data-who]');
  const whoPanel = host.querySelector('[data-who-panel]');
  const kwInput = host.querySelector('[data-kw]');
  const pickedBox = host.querySelector('[data-picked]');
  const results = host.querySelector('[data-results]');
  const progress = host.querySelector('[data-progress]');
  const bar = host.querySelector('[data-bar]');
  const note = host.querySelector('[data-note]');
  const scanBtn = host.querySelector('[data-act="scan"]');
  const capLabel = host.querySelector('[data-cap]');
  const stopBtn = host.querySelector('[data-act="stop"]');
  const moreBox = host.querySelector('[data-more]');

  // The explainer is four dense lines of prose: useful once, noise afterwards,
  // so it starts folded behind the header button.
  const explainBtn = host.querySelector('[data-act="explain"]');
  const explainBox = host.querySelector('[data-explain]');
  explainBtn.onclick = () => {
    const open = explainBox.hidden;
    explainBox.hidden = !open;
    explainBtn.setAttribute('aria-expanded', String(open));
    explainBtn.classList.toggle('is-on', open);
  };

  const stat = (key) => host.querySelector(`[data-stat-${key}]`);

  function renderCap() {
    const bits = [];
    if (lanePicker.value === 'hot') bits.push('只翻被点过赞的评论，几秒就能扫完');
    else if (depthPicker.value === 0) bits.push(`${SCAN_CONCURRENCY} 路并发，约每秒 800 条`);
    else bits.push(`${SCAN_CONCURRENCY} 路并发，本轮上限 ${fmtCount(depthPicker.value)} 条`);
    if (windowPicker.value !== 'all') bits.push(`只查 ${windowPicker.value} 年`);
    capLabel.textContent = bits.join(' · ');
  }

  const lanePicker = bindPicker(host.querySelector('[data-lane]'), {
    options: SCAN_LANES,
    value: 'both',
    onChange() { renderCap(); forgetRound(); },
  });
  const depthPicker = bindPicker(host.querySelector('[data-depth]'), {
    options: SCAN_DEPTHS,
    value: 10000,
    onChange() { renderCap(); },
  });
  const windowPicker = bindPicker(host.querySelector('[data-window]'), {
    options: scanWindows(),
    value: 'all',
    onChange() { renderCap(); forgetRound(); },
  });
  renderCap();

  function renderPicked() {
    if (!picked) {
      pickedBox.innerHTML = '';
      return;
    }
    pickedBox.innerHTML = html`
      <div class="scan-picked">
        <img class="avatar" alt="" src="${avatarOf(picked.avatarUrl)}">
        <div>
          <div class="scan-picked-name">${picked.nickname}</div>
          <div class="scan-picked-uid">已锁定 uid ${picked.userId} · 精确匹配</div>
        </div>
        <button class="icon-btn" data-act="unpick" aria-label="取消锁定">${raw(ico('close'))}</button>
      </div>
    `;
    pickedBox.querySelector('[data-act="unpick"]').onclick = () => {
      picked = null;
      renderPicked();
    };
  }

  let suggestTimer = 0;
  let suggestRound = 0;
  const forgetRound = () => {
    moreBox.hidden = true;
    scanBtn.innerHTML = `${ico('detective')}开始扫描`;
  };
  kwInput.oninput = forgetRound;

  whoInput.oninput = () => {
    picked = null;
    renderPicked();
    forgetRound();
    clearTimeout(suggestTimer);
    const keywords = whoInput.value.trim();
    if (keywords.length < 2) {
      whoPanel.hidden = true;
      return;
    }
    const round = ++suggestRound;
    suggestTimer = setTimeout(async () => {
      try {
        const data = await api.searchUsers(keywords, 8);
        const users = data?.result?.userprofiles || [];
        // The request is in flight while the user may already have hit scan;
        // a late response must not pop the panel back over the progress card.
        if (round !== suggestRound || running) return;
        if (!users.length) {
          whoPanel.hidden = true;
          return;
        }
        whoPanel.innerHTML = html`
          <div class="sugg-group-label">锁定用户可精确匹配</div>
          ${raw(users.map((u) => html`
            <button class="sugg-item" data-uid="${u.userId}">
              <img class="avatar" style="width:26px;height:26px" alt="" src="${avatarOf(u.avatarUrl)}">
              <span>${u.nickname}</span>
              <span class="sugg-sub" style="margin-left:auto">uid ${u.userId}</span>
            </button>
          `).join(''))}
        `;
        whoPanel.hidden = false;
        for (const item of whoPanel.querySelectorAll('[data-uid]')) {
          item.onclick = () => {
            const uid = Number(item.dataset.uid);
            picked = users.find((u) => u.userId === uid) || null;
            whoInput.value = picked?.nickname || '';
            whoPanel.hidden = true;
            renderPicked();
          };
        }
      } catch {
        whoPanel.hidden = true;
      }
    }, 320);
  };

  whoInput.onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      whoPanel.hidden = true;
      scanBtn.click();
    }
  };

  const dismissSuggest = (event) => {
    if (!document.contains(host)) {
      document.removeEventListener('pointerdown', dismissSuggest);
      return;
    }
    if (!host.contains(event.target)) whoPanel.hidden = true;
  };
  document.addEventListener('pointerdown', dismissSuggest);

  // Kept between rounds so "继续扫描" picks up exactly where the last one stopped.
  let session = null;

  function sessionKey(needle, contentKw, lane, win) {
    const who = picked ? `uid:${picked.userId}` : `name:${needle.toLowerCase()}`;
    return `${who}|kw:${contentKw.toLowerCase()}|lane:${lane}|win:${win}`;
  }

  // Equal time slices, newest first. Every shard — including the first — seeks
  // to its own upper bound via before=<ms>. Letting the first shard start with no
  // cursor used to pin it to the live head of the comment list, so picking a
  // single year still burned one of the six workers on today's comments forever.
  // before=<now> returns the same head anyway, so there is no reason to special
  // case it.
  function makeShards(from, to) {
    const step = (to - from) / SCAN_SHARDS;
    return Array.from({ length: SCAN_SHARDS }, (_, k) => {
      const top = Math.round(to - k * step);
      return {
        from: Math.round(to - (k + 1) * step),
        to: top,
        cursor: top,
        at: top,
        pages: 0,
        done: false,
        busy: false,
      };
    });
  }

  stopBtn.onclick = () => {
    abort?.();
    stopBtn.disabled = true;
  };

  scanBtn.onclick = () => {
    const needle = whoInput.value.trim();
    if (!picked && !needle) {
      toast('先填一个昵称关键词，或从下拉里锁定用户', 'info');
      whoInput.focus();
      return;
    }
    scan();
  };

  async function scan({ resume = false } = {}) {
    if (running) return;
    const needle = whoInput.value.trim();
    const contentKw = kwInput.value.trim();
    const lane = lanePicker.value;
    const win = windowPicker.value;
    const key = sessionKey(needle, contentKw, lane, win);
    // The legacy deep-paging endpoint only exists for songs.
    const canTimeline = type === 0 && lane !== 'hot';

    if (!resume || session?.key !== key) {
      const range = windowRange(win);
      session = {
        key,
        seen: new Set(),
        hits: [],
        scanned: 0,
        total: 0,
        range,
        hot: { offset: 0, total: 0, done: lane === 'time' },
        shards: canTimeline ? makeShards(range.from, range.to) : [],
        timelinePages: 0,
      };
      results.innerHTML = '';
    }

    running = true;
    let stopped = false;
    abort = () => {
      stopped = true;
    };

    const budget = Number(depthPicker.value) || 0;
    const pageBudget = budget ? Math.ceil(budget / SCAN_PAGE) : Infinity;
    let usedPages = 0;
    const hasBudget = () => !stopped && usedPages < pageBudget;

    const lowerNeedle = needle.toLowerCase();
    const lowerKw = contentKw.toLowerCase();
    const startedAt = performance.now();
    const who = picked ? `精确匹配 uid ${picked.userId}` : `昵称包含「${needle}」`;
    let phase = '最热池';

    scanBtn.disabled = true;
    scanBtn.innerHTML = `${ico('refresh')}扫描中…`;
    stopBtn.hidden = false;
    stopBtn.disabled = false;
    // A debounced suggestion request could otherwise re-open the panel on top
    // of the progress card right after the scan starts.
    clearTimeout(suggestTimer);
    suggestRound += 1;
    whoPanel.hidden = true;
    progress.hidden = false;
    moreBox.hidden = true;
    moreBox.innerHTML = '';
    bar.classList.remove('is-indeterminate');
    progress.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    // One cheap probe gives the real comment count, which keeps coverage honest.
    if (!session.total) {
      try {
        const probe = await api.commentsNew(id, { type, pageNo: 1, pageSize: 1, sortType: 3 });
        session.total = probe?.data?.totalCount || 0;
      } catch {
        /* coverage is informational only */
      }
    }

    let dirty = false;

    const absorb = (rows, badge) => {
      for (const comment of rows) {
        if (!comment || session.seen.has(comment.commentId)) continue;
        session.seen.add(comment.commentId);
        session.scanned += 1;
        const user = comment.user || {};
        const nameHit = picked
          ? user.userId === picked.userId
          : String(user.nickname || '').toLowerCase().includes(lowerNeedle);
        if (!nameHit) continue;
        if (lowerKw && !String(comment.content || '').toLowerCase().includes(lowerKw)) continue;
        session.hits.push({ comment, badge });
        dirty = true;
      }
    };

    // Workers finish out of order, so the list is rebuilt newest-first instead
    // of appended to.
    const renderHits = () => {
      if (!dirty) return;
      dirty = false;
      session.hits.sort((a, b) => (b.comment.time || 0) - (a.comment.time || 0));
      results.innerHTML = session.hits
        .map(({ comment, badge }) => commentHtml(comment, { extraClass: 'scan-hit', needle: contentKw, badge }))
        .join('');
    };

    const tick = () => {
      stat('scanned').textContent = fmtCount(session.scanned);
      stat('hits').textContent = fmtCount(session.hits.length);
      stat('pages').textContent = String(usedPages);
      stat('time').textContent = `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
      const ratio = Number.isFinite(pageBudget)
        ? usedPages / pageBudget
        : session.total
          ? session.scanned / session.total
          : 0;
      bar.style.width = `${Math.min(100, ratio * 100)}%`;
      note.textContent = phase === '时间线'
        ? `正在并行倒查时间线 ${session.shards.map((s) => monthLabel(s.at)).join(' / ')} · ${who}`
        : `正在扫${phase} · ${who}`;
      renderHits();
    };
    tick();

    // ---- channel 1: the like-ranked pool. Offsets are independent, so this is
    // embarrassingly parallel and usually done in a couple of seconds.
    async function hotPage() {
      const offset = session.hot.offset;
      if (session.hot.total && offset >= session.hot.total) {
        session.hot.done = true;
        return;
      }
      session.hot.offset = offset + SCAN_PAGE;
      usedPages += 1;
      const data = await api.commentsHot(id, { type, limit: SCAN_PAGE, offset });
      const rows = data?.hotComments || [];
      session.hot.total = data?.total || session.hot.total;
      absorb(rows, `最热池 第 ${Math.floor(offset / SCAN_PAGE) + 1} 页`);
      if (rows.length < SCAN_PAGE) session.hot.done = true;
      tick();
    }

    async function hotWorker() {
      while (hasBudget() && !session.hot.done) await hotPage();
    }

    // ---- channel 2: the timeline, walked backwards inside each shard.
    async function timeWorker() {
      while (hasBudget()) {
        const shard = session.shards.find((s) => !s.done && !s.busy);
        if (!shard) return;
        shard.busy = true;
        try {
          while (hasBudget()) {
            usedPages += 1;
            const data = await api.commentsTimeline(id, { limit: SCAN_PAGE, before: shard.cursor });
            // A page straddles the slice boundary at the end; anything already
            // below this shard's floor belongs to the next shard, and counting it
            // here would inflate the progress numbers with duplicates.
            const rows = (data?.comments || []).filter((c) => c.time > shard.from || shard.from <= session.range.from);
            shard.pages += 1;
            session.timelinePages += 1;
            absorb(rows, `时间线 ${monthLabel(rows[0]?.time || shard.at)}`);
            const last = rows.at(-1);
            if (!rows.length || !last || !data?.more) {
              shard.done = true;
              break;
            }
            shard.cursor = last.time;
            shard.at = last.time;
            // Walked past this slice: the next shard already owns what follows.
            if (last.time <= shard.from) {
              shard.done = true;
              break;
            }
            tick();
          }
        } finally {
          shard.busy = false;
        }
        tick();
      }
    }

    try {
      if (lane !== 'time' && !session.hot.done) {
        phase = '最热池';
        tick();
        // One page first, purely to learn the pool size so the parallel workers
        // know where to stop; then let all of them loose on the offsets.
        if (!session.hot.total && hasBudget()) await hotPage();
        if (!session.hot.done && hasBudget()) {
          await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, hotWorker));
        }
      }
      if (canTimeline && hasBudget()) {
        phase = '时间线';
        tick();
        await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, timeWorker));
      }
    } catch (err) {
      note.innerHTML = html`<span style="color:var(--danger)">扫描中断：${err.message}</span>`;
    }

    const shardsLeft = session.shards.filter((s) => !s.done).length;
    const exhausted = (lane === 'time' || session.hot.done) && (!canTimeline || shardsLeft === 0);

    dirty = true;
    tick();
    running = false;
    abort = null;
    scanBtn.disabled = false;
    scanBtn.innerHTML = `${ico('detective')}${session.scanned ? '重新扫描' : '开始扫描'}`;
    stopBtn.hidden = true;

    const coverage = session.total ? (session.scanned / session.total) * 100 : 0;
    const bits = [session.total
      ? `已看 ${fmtCount(session.scanned)} / ${fmtCount(session.total)} 条（${coverage < 0.1 ? '<0.1' : coverage.toFixed(1)}%）`
      : `已看 ${fmtCount(session.scanned)} 条`];
    if (lane !== 'time' && session.hot.total) {
      bits.push(session.hot.done
        ? `最热池 ${fmtCount(session.hot.total)} 条已扫完`
        : `最热池 ${fmtCount(Math.min(session.hot.offset, session.hot.total))}/${fmtCount(session.hot.total)}`);
    }
    if (canTimeline && session.timelinePages) {
      const doneShards = session.shards.length - shardsLeft;
      bits.push(`时间线 ${session.timelinePages} 页 · ${SCAN_SHARDS} 段并行，已扫完 ${doneShards} 段`);
    }
    const reach = bits.join(' · ');
    const scope = exhausted
      ? '已扫完选定范围'
      : stopped
        ? '已手动停止'
        : '预算用完，可继续';

    if (!session.hits.length) {
      const tip = canTimeline && win === 'all'
        ? '若大致知道对方是哪年评论的，把“时段”定到那一年会快得多'
        : '也可以换个更短的昵称关键词，或改用锁定用户';
      results.innerHTML = emptyState('还没找到这个人的评论', `${reach} · ${scope} · ${tip}`, 'detective');
    }

    const summary = session.hits.length
      ? html`命中 <b>${session.hits.length}</b> 条 · ${reach} · ${scope}`
      : html`${reach} · ${scope}`;
    moreBox.innerHTML = html`
      <div class="notice ${session.hits.length ? '' : 'notice-warn'}">
        ${raw(ico(session.hits.length ? 'check' : 'info'))}
        <span>${raw(summary)}</span>
        ${exhausted ? '' : raw(html`<button class="btn btn-sm" data-act="more">${raw(ico('refresh'))}继续扫描</button>`)}
      </div>
    `;
    moreBox.hidden = false;
    moreBox.querySelector('[data-act="more"]')?.addEventListener('click', () => scan({ resume: true }));
    note.textContent = `${reach} · ${scope}`;
  }

  bindCommentActions(results, { id, type });
  return { destroy() { abort?.(); } };
}
