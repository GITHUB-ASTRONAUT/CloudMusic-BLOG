import { $, frag, html, raw } from './util.mjs';
import { hydrateIcons, ico, svgOf } from './icons.mjs';

/* ---------- toast ---------- */

export function toast(message, kind = 'info') {
  const host = $('#toasts');
  if (!host) return;
  const name = kind === 'error' ? 'alert' : kind === 'ok' ? 'check' : 'info';
  const node = frag(html`<div class="toast toast-${kind}">${raw(ico(name))}<span>${message}</span></div>`).firstElementChild;
  host.append(node);
  setTimeout(() => {
    node.classList.add('is-out');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }, kind === 'error' ? 4200 : 2600);
}

/* ---------- modal ---------- */

let closeActiveModal = null;

export function openModal(markup, { wide = false, onMount, onClose } = {}) {
  closeActiveModal?.();
  const root = $('#modalRoot');
  root.innerHTML = html`<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true"></div>`;
  const box = root.firstElementChild;
  box.innerHTML = markup;
  hydrateIcons(box);
  root.hidden = false;

  const close = () => {
    if (closeActiveModal !== close) return;
    closeActiveModal = null;
    document.removeEventListener('keydown', onKey);
    root.removeEventListener('pointerdown', onBackdrop);
    root.hidden = true;
    root.innerHTML = '';
    onClose?.();
  };

  function onKey(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }

  function onBackdrop(event) {
    if (event.target === root) close();
  }

  closeActiveModal = close;
  document.addEventListener('keydown', onKey);
  root.addEventListener('pointerdown', onBackdrop);
  onMount?.(box, close);
  box.querySelector('[data-autofocus]')?.focus();
  return close;
}

export const closeModal = () => closeActiveModal?.();

export function confirmDialog({ title, body, confirmText = '确定', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openModal(html`
      <div class="modal-head"><div><h2>${title}</h2>${body ? raw(html`<p>${body}</p>`) : ''}</div></div>
      <div class="modal-foot">
        <button class="btn" data-act="cancel">取消</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok" data-autofocus>${confirmText}</button>
      </div>
    `, {
      onMount(box, close) {
        box.querySelector('[data-act="cancel"]').onclick = close;
        box.querySelector('[data-act="ok"]').onclick = () => {
          finish(true);
          close();
        };
      },
      onClose: () => finish(false),
    });
  });
}

/* ---------- popover menu ---------- */

export function openMenu(anchor, items) {
  document.querySelector('.menu')?.remove();
  const node = frag(html`<div class="menu" role="menu">${raw(items.map((item) => (item.sep
    ? '<div class="menu-sep"></div>'
    : html`<button class="menu-item" role="menuitem" data-key="${item.key}">${raw(ico(item.icon || 'chevron-right'))}<span>${item.label}</span></button>`
  )).join(''))}</div>`).firstElementChild;

  document.body.append(node);
  const box = anchor.getBoundingClientRect();
  const width = node.offsetWidth;
  node.style.top = `${Math.min(box.bottom + 8, innerHeight - node.offsetHeight - 12)}px`;
  node.style.left = `${Math.max(12, Math.min(box.right - width, innerWidth - width - 12))}px`;

  const dismiss = (event) => {
    if (event && node.contains(event.target)) return;
    node.remove();
    document.removeEventListener('pointerdown', dismiss, true);
    document.removeEventListener('keydown', onKey, true);
  };

  function onKey(event) {
    if (event.key !== 'Escape') return;
    // Swallow it: Escape is also the global "close the now-playing page" key,
    // and one press should only close the topmost layer.
    event.stopPropagation();
    event.preventDefault();
    dismiss();
  }

  node.addEventListener('click', (event) => {
    const button = event.target.closest('[data-key]');
    if (!button) return;
    dismiss();
    items.find((item) => item.key === button.dataset.key)?.onSelect?.();
  });

  setTimeout(() => {
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', onKey, true);
  });
}

/* ---------- picker ---------- */

// A native <select> drops an OS-drawn list that ignores the rest of the design,
// so anywhere the popup is visible we use a button plus the app's own menu.
export function pickerHtml(options, value, { attr = '', className = '' } = {}) {
  const current = options.find((o) => String(o.value) === String(value)) || options[0];
  return html`<button type="button" class="picker ${className}" ${raw(attr)} aria-haspopup="menu">
    <span data-picker-label>${current?.label ?? ''}</span>${raw(ico('chevron-down'))}
  </button>`;
}

export function bindPicker(button, { options, value, onChange }) {
  let current = value;
  const label = button.querySelector('[data-picker-label]');

  const paint = () => {
    const hit = options.find((o) => String(o.value) === String(current));
    label.textContent = hit?.label ?? '';
    button.dataset.value = String(current);
  };

  button.onclick = () => {
    button.classList.add('is-open');
    openMenu(button, options.map((option) => ({
      key: String(option.value),
      label: option.label,
      icon: String(option.value) === String(current) ? 'check' : 'dot',
      onSelect() {
        current = option.value;
        paint();
        onChange?.(option.value, option);
      },
    })));
    // openMenu removes itself on dismiss; drop the highlight when it goes away.
    const watch = new MutationObserver(() => {
      if (!document.querySelector('.menu')) {
        button.classList.remove('is-open');
        watch.disconnect();
      }
    });
    watch.observe(document.body, { childList: true });
  };

  paint();
  return {
    get value() { return current; },
    set(next) { current = next; paint(); },
  };
}

/* ---------- placeholders ---------- */

export function skeletonRows(count = 8) {
  return Array.from({ length: count }, () => html`
    <div class="sk-row">
      <div class="sk" style="width:44px;height:44px;border-radius:9px"></div>
      <div style="flex:1 1 auto;display:flex;flex-direction:column;gap:8px">
        <div class="sk sk-line" style="width:${38 + Math.random() * 34}%"></div>
        <div class="sk sk-line" style="width:${20 + Math.random() * 22}%"></div>
      </div>
    </div>
  `).join('');
}

export function skeletonCards(count = 6) {
  return html`<div class="grid">${raw(Array.from({ length: count }, () => html`
    <div class="card">
      <div class="sk" style="aspect-ratio:1;border-radius:14px"></div>
      <div class="sk sk-line" style="width:82%"></div>
      <div class="sk sk-line" style="width:52%"></div>
    </div>
  `).join(''))}</div>`;
}

export function emptyState(message, detail, iconName = 'disc') {
  return html`<div class="empty">
    <i class="ico" style="width:34px;height:34px">${raw(svgOf(iconName))}</i>
    <strong>${message}</strong>
    ${detail ? raw(html`<span>${detail}</span>`) : ''}
  </div>`;
}

export function errorState(err, retryLabel = '重试') {
  return html`<div class="empty">
    <i class="ico" style="width:32px;height:32px">${raw(svgOf('alert'))}</i>
    <strong>${err?.message || '出了点问题'}</strong>
    <button class="btn btn-sm" data-act="retry">${retryLabel}</button>
  </div>`;
}

/* ---------- accent colour ---------- */

const accentCache = new Map();

function dominantHue(image) {
  const size = 36;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  // Weight each pixel by saturation so muted backgrounds do not win.
  let x = 0;
  let y = 0;
  let satSum = 0;
  let weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 2;
    if (light < 0.12 || light > 0.94) continue;
    const delta = max - min;
    if (delta < 0.06) continue;
    const sat = delta / (1 - Math.abs(2 * light - 1));
    let hue;
    if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
    else if (max === g) hue = ((b - r) / delta + 2) * 60;
    else hue = ((r - g) / delta + 4) * 60;
    const w = sat * sat;
    const rad = (hue * Math.PI) / 180;
    x += Math.cos(rad) * w;
    y += Math.sin(rad) * w;
    satSum += sat * w;
    weight += w;
  }
  if (!weight) return null;
  let hue = (Math.atan2(y, x) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  const sat = satSum / weight;
  return { h: Math.round(hue), s: Math.round(Math.min(0.86, Math.max(0.42, sat)) * 100) };
}

export function applyAccent({ h, s }) {
  const root = document.documentElement.style;
  root.setProperty('--accent-h', String(h));
  root.setProperty('--accent-s', `${s}%`);
}

export const resetAccent = () => applyAccent({ h: 268, s: 72 });

// Samples album art (served same-origin by our proxy) to retint the whole UI.
export function accentFromArt(url) {
  if (!url) {
    resetAccent();
    return;
  }
  if (accentCache.has(url)) {
    applyAccent(accentCache.get(url));
    return;
  }
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => {
    try {
      const found = dominantHue(image);
      if (!found) return;
      accentCache.set(url, found);
      applyAccent(found);
    } catch {
      /* tainted canvas: keep the previous accent */
    }
  };
  image.src = url;
}
