import { art, fmtCount, html, raw } from '../lib/util.mjs';
import { ico } from '../lib/icons.mjs';

export function playlistCard(item) {
  const id = item.id;
  const count = item.playCount || item.playcount || 0;
  return html`
    <div class="card">
      <a class="card-art" href="#/playlist/${id}" aria-label="${item.name}">
        <img loading="lazy" alt="" src="${art(item.picUrl || item.coverImgUrl, 400)}">
        ${count ? raw(html`<span class="card-badge">${raw(ico('play'))} ${fmtCount(count)}</span>`) : ''}
        <span class="card-play">${raw(ico('play'))}</span>
      </a>
      <a class="card-title" href="#/playlist/${id}">${item.name}</a>
      ${item.copywriter ? raw(html`<span class="card-sub">${item.copywriter}</span>`) : ''}
    </div>
  `;
}

export function cardGrid(items, renderer = playlistCard) {
  return html`<div class="grid">${raw(items.map(renderer).join(''))}</div>`;
}

export function userCard(user) {
  return html`
    <div class="card">
      <a class="card-art" style="border-radius:50%" href="#/user/${user.userId}" aria-label="${user.nickname}">
        <img loading="lazy" alt="" src="${art(user.avatarUrl, 300)}">
      </a>
      <a class="card-title" style="text-align:center" href="#/user/${user.userId}">${user.nickname}</a>
      <span class="card-sub" style="text-align:center">uid ${user.userId}</span>
    </div>
  `;
}
