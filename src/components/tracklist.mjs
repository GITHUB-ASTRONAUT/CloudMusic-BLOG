import { art, fmtCount, fmtDuration, html, raw } from '../lib/util.mjs';
import { ico } from '../lib/icons.mjs';
import { currentSong } from '../lib/store.mjs';
import { openMenu } from '../lib/ui.mjs';
import { isLiked, toggleLike } from '../features/likes.mjs';
import * as player from '../features/player.mjs';

function trackRow(song, i, opts) {
  const blocked = song.blocked || song.noCopyright;
  const tags = [
    song.vip ? '<span class="chip chip-accent">VIP</span>' : '',
    blocked ? '<span class="chip chip-warn">无版权</span>' : '',
    song.mv ? `<span class="chip">MV</span>` : '',
  ].join('');
  return html`
    <div class="track ${blocked ? 'is-blocked' : ''}" data-track data-id="${song.id}" data-i="${i}">
      <div class="track-idx">
        <span class="track-idx-num">${opts.numberFrom + i}</span>
        <button class="track-idx-play" data-act="play" title="播放" aria-label="播放 ${song.name}">${raw(ico('play'))}</button>
      </div>
      <div class="track-art"><img loading="lazy" alt="" src="${art(song.cover, 80)}"></div>
      <div class="track-main">
        <a class="track-name" href="#/song/${song.id}" title="${song.name}">${song.name}${song.alia ? raw(html` <span class="track-alia">(${song.alia})</span>`) : ''} ${raw(tags)}</a>
        <span class="track-sub">${song.artists}</span>
      </div>
      <a class="track-album" href="${song.albumId ? `#/album/${song.albumId}` : '#/discover'}" title="${song.albumName}">${song.albumName}</a>
      <span class="track-dur">${fmtDuration(song.duration)}</span>
      <div class="track-tools">
        <button class="icon-btn ${isLiked(song.id) ? 'is-liked' : ''}" data-act="like" title="喜欢" aria-label="喜欢">${raw(ico(isLiked(song.id) ? 'heart-fill' : 'heart'))}</button>
        <button class="icon-btn" data-act="queue-next" title="下一首播放" aria-label="下一首播放">${raw(ico('queue-next'))}</button>
        <a class="icon-btn" href="#/song/${song.id}" title="评论与歌词" aria-label="评论与歌词">${raw(ico('comment'))}</a>
        <button class="icon-btn" data-act="more" title="更多" aria-label="更多操作">${raw(ico('more'))}</button>
        ${opts.removable ? raw(html`<button class="icon-btn" data-act="remove" title="从队列移除" aria-label="从队列移除">${raw(ico('close'))}</button>`) : ''}
      </div>
    </div>
  `;
}

export function tracklistHtml(songs, opts = {}) {
  const settings = { numberFrom: 1, ...opts };
  return html`<div class="tracklist" data-tracklist>${raw(songs.map((song, i) => trackRow(song, i, settings)).join(''))}</div>`;
}

// One delegated listener per container; `getSongs` keeps paging in sync.
export function bindTracklist(container, getSongs, context = {}) {
  if (!container || container.dataset.bound === '1') return;
  container.dataset.bound = '1';

  const startAt = (index) => {
    const songs = getSongs();
    if (!songs[index]) return;
    player.setQueue(songs, index, context.title || '播放列表');
  };

  const openRowMenu = (anchor, index) => {
    const songs = getSongs();
    const song = songs[index];
    if (!song) return;
    const items = [
      { key: 'play', label: '立即播放', icon: 'play', onSelect: () => startAt(index) },
      { key: 'next', label: '下一首播放', icon: 'queue-next', onSelect: () => player.enqueue(song, { next: true }) },
      { key: 'tail', label: '添加到队列末尾', icon: 'plus', onSelect: () => player.enqueue(song) },
      { key: 'rest', label: '从这里播放到末尾', icon: 'playlist', onSelect: () => player.setQueue(songs.slice(index), 0, context.title || '播放列表') },
      { sep: true },
      { key: 'like', label: isLiked(song.id) ? '取消喜欢' : '喜欢这首歌', icon: isLiked(song.id) ? 'heart-fill' : 'heart', onSelect: () => toggleLike(song.id) },
      { key: 'song', label: '评论与侦探', icon: 'detective', onSelect: () => { location.hash = `#/song/${song.id}`; } },
    ];
    if (song.albumId) {
      items.push({ key: 'album', label: '查看专辑', icon: 'library', onSelect: () => { location.hash = `#/album/${song.albumId}`; } });
    }
    if (context.onRemove) {
      items.push({ sep: true });
      items.push({ key: 'remove', label: '从队列移除', icon: 'trash', onSelect: () => context.onRemove(index) });
    }
    openMenu(anchor, items);
  };

  container.addEventListener('click', (event) => {
    const row = event.target.closest('[data-track]');
    if (!row) return;
    const index = Number(row.dataset.i);
    const action = event.target.closest('[data-act]')?.dataset.act;
    if (action === 'play') {
      event.preventDefault();
      startAt(index);
    } else if (action === 'like') {
      event.preventDefault();
      toggleLike(row.dataset.id);
    } else if (action === 'queue-next') {
      event.preventDefault();
      const song = getSongs()[index];
      if (song) player.enqueue(song, { next: true });
    } else if (action === 'more') {
      event.preventDefault();
      openRowMenu(event.target.closest('[data-act="more"]'), index);
    } else if (action === 'remove') {
      event.preventDefault();
      context.onRemove?.(index);
    } else if (!event.target.closest('a')) {
      // Clicking anywhere on the row except a link starts the track.
      startAt(index);
    }
  });

  container.addEventListener('dblclick', (event) => {
    const row = event.target.closest('[data-track]');
    if (!row || event.target.closest('a')) return;
    startAt(Number(row.dataset.i));
  });
}

// Keeps "now playing" highlight and heart state fresh without re-rendering.
export function syncTracklists(root = document) {
  const playing = currentSong();
  for (const row of root.querySelectorAll('[data-track]')) {
    const id = Number(row.dataset.id);
    row.classList.toggle('is-current', Boolean(playing) && playing.id === id);
    const like = row.querySelector('[data-act="like"]');
    if (!like) continue;
    const liked = isLiked(id);
    like.classList.toggle('is-liked', liked);
    like.innerHTML = ico(liked ? 'heart-fill' : 'heart');
  }
}

export function statLine(playlist) {
  return [
    playlist.trackCount ? `${playlist.trackCount} 首` : '',
    playlist.playCount ? `${fmtCount(playlist.playCount)} 次播放` : '',
    playlist.subscribedCount ? `${fmtCount(playlist.subscribedCount)} 收藏` : '',
  ].filter(Boolean).join(' · ');
}
