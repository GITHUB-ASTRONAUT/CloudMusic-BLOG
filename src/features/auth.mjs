import * as api from '../lib/api.mjs';
import { emit, isLoggedIn, on, state } from '../lib/store.mjs';
import { closeModal, openMenu, openModal, toast } from '../lib/ui.mjs';
import { art, html, raw, sleep } from '../lib/util.mjs';
import { hydrateIcons, ico } from '../lib/icons.mjs';
import { refreshLikes } from './likes.mjs';

const FALLBACK_AVATAR = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">'
  + '<rect width="40" height="40" fill="#342b52"/>'
  + '<circle cx="20" cy="15.5" r="6.4" fill="#7a6ba8"/>'
  + '<path d="M7 38a13 13 0 0 1 26 0z" fill="#7a6ba8"/></svg>',
)}`;

export const avatarOf = (url) => (url ? art(url, 80) : FALLBACK_AVATAR);

/* ---------- session ---------- */

export async function bootstrapSession() {
  try {
    const data = await api.loginStatus();
    const profile = data?.data?.profile;
    state.profile = profile?.userId ? profile : null;
  } catch {
    state.profile = null;
  }
  renderAccount();
  emit('auth:changed');
  if (isLoggedIn()) {
    await Promise.all([refreshLikes(), loadMyPlaylists()]);
  } else {
    state.likedIds = new Set();
    state.myPlaylists = [];
  }
  emit('likes:changed');
}

export async function loadMyPlaylists() {
  if (!isLoggedIn()) {
    state.myPlaylists = [];
    return;
  }
  try {
    const data = await api.userPlaylist(state.profile.userId, 100);
    state.myPlaylists = data.playlist || [];
  } catch {
    state.myPlaylists = [];
  }
  emit('playlists:changed');
}

export async function doLogout() {
  try {
    await api.logout();
  } catch {
    /* clearing the local jar below is what actually matters */
  }
  await api.resetServerSession().catch(() => {});
  state.profile = null;
  state.likedIds = new Set();
  state.myPlaylists = [];
  renderAccount();
  emit('auth:changed');
  emit('likes:changed');
  toast('已退出登录', 'ok');
}

/* ---------- account chip ---------- */

export function renderAccount() {
  const slot = document.getElementById('accountSlot');
  if (!slot) return;

  if (!isLoggedIn()) {
    slot.innerHTML = html`<button class="btn btn-primary" id="loginBtn">${raw(ico('user'))}登录</button>`;
    slot.querySelector('#loginBtn').onclick = () => openLogin();
    return;
  }

  const profile = state.profile;
  slot.innerHTML = html`
    <button class="acct-btn" id="acctBtn" aria-haspopup="menu">
      <img class="avatar" alt="" src="${avatarOf(profile.avatarUrl)}">
      <span class="acct-name">${profile.nickname}</span>
      ${raw(ico('chevron-down'))}
    </button>
  `;
  const button = slot.querySelector('#acctBtn');
  button.onclick = () => openMenu(button, [
    { key: 'me', icon: 'user', label: '我的主页', onSelect: () => { location.hash = `#/user/${profile.userId}`; } },
    { key: 'lists', icon: 'library', label: '我的歌单', onSelect: () => { location.hash = '#/mine'; } },
    { sep: true },
    { key: 'out', icon: 'logout', label: '退出登录', onSelect: () => doLogout() },
  ]);
}

/* ---------- login modal ---------- */

const QR_STATE = {
  801: '请用网易云音乐 App 扫描二维码',
  802: '已扫描，请在手机上点击确认',
  800: '二维码已过期',
};

export function openLogin(reason = '') {
  let stopPolling = () => {};

  const markup = html`
    <div class="modal-head">
      <div>
        <h2>登录网易云音乐</h2>
        <p>${reason || '登录后可以收藏、评论、看每日推荐'}</p>
      </div>
      <button class="icon-btn" data-act="close" aria-label="关闭"><i data-ico="close"></i></button>
    </div>
    <div class="login-tabs tabs" role="tablist">
      <button class="tab" role="tab" data-pane="qr" aria-selected="true">扫码登录</button>
      <button class="tab" role="tab" data-pane="phone" aria-selected="false">手机号登录</button>
    </div>
    <div class="modal-body">
      <div class="login-pane" data-pane-body="qr">
        <div class="qr-wrap">
          <div class="qr-frame">
            <img alt="登录二维码" id="qrImg">
            <div class="qr-veil" id="qrVeil"><div class="spinner"></div><span>正在生成二维码…</span></div>
          </div>
          <p class="qr-state" id="qrState">准备中…</p>
        </div>
      </div>
      <div class="login-pane" data-pane-body="phone" hidden>
        <div class="form-row">
          <label for="lgPhone">手机号</label>
          <div class="form-inline">
            <input class="field" id="lgCode" value="86" style="max-width:74px" aria-label="国家代码">
            <input class="field" id="lgPhone" inputmode="numeric" placeholder="手机号码" autocomplete="username">
          </div>
        </div>
        <div class="tabs" style="gap:4px">
          <button class="tab" data-way="pwd" aria-selected="true">密码</button>
          <button class="tab" data-way="sms" aria-selected="false">验证码</button>
        </div>
        <div class="form-row" data-way-body="pwd">
          <label for="lgPwd">密码</label>
          <input class="field" id="lgPwd" type="password" placeholder="登录密码" autocomplete="current-password">
        </div>
        <div class="form-row" data-way-body="sms" hidden>
          <label for="lgSms">短信验证码</label>
          <div class="form-inline">
            <input class="field" id="lgSms" inputmode="numeric" placeholder="6 位验证码">
            <button class="btn" id="lgSend" type="button">获取验证码</button>
          </div>
        </div>
        <p class="form-error" id="lgError"></p>
        <button class="btn btn-primary" id="lgSubmit" style="width:100%">登录</button>
        <p class="form-hint">凭证只保存在本机 Node 服务的内存里，不写入磁盘，也不会交给页面脚本。重启服务即失效。</p>
      </div>
    </div>
  `;

  openModal(markup, {
    onMount(box, close) {
      box.querySelector('[data-act="close"]').onclick = close;

      for (const tab of box.querySelectorAll('[data-pane]')) {
        tab.onclick = () => {
          for (const other of box.querySelectorAll('[data-pane]')) {
            other.setAttribute('aria-selected', String(other === tab));
          }
          for (const pane of box.querySelectorAll('[data-pane-body]')) {
            pane.hidden = pane.dataset.paneBody !== tab.dataset.pane;
          }
        };
      }

      for (const tab of box.querySelectorAll('[data-way]')) {
        tab.onclick = () => {
          for (const other of box.querySelectorAll('[data-way]')) {
            other.setAttribute('aria-selected', String(other === tab));
          }
          for (const pane of box.querySelectorAll('[data-way-body]')) {
            pane.hidden = pane.dataset.wayBody !== tab.dataset.way;
          }
        };
      }

      stopPolling = startQrFlow(box, close);
      wirePhoneLogin(box, close);
      hydrateIcons(box);
    },
    onClose() {
      stopPolling();
    },
  });
}

function startQrFlow(box, close) {
  const img = box.querySelector('#qrImg');
  const veil = box.querySelector('#qrVeil');
  const label = box.querySelector('#qrState');
  let alive = true;

  const showVeil = (markup) => {
    veil.hidden = false;
    veil.innerHTML = markup;
  };

  async function run() {
    try {
      showVeil('<div class="spinner"></div><span>正在生成二维码…</span>');
      const keyData = await api.qrKey();
      const key = keyData?.data?.unikey;
      if (!key) throw new Error('未能获取二维码 key');
      const created = await api.qrCreate(key);
      if (!alive) return;
      img.src = created?.data?.qrimg || '';
      veil.hidden = true;
      label.textContent = QR_STATE[801];

      while (alive) {
        await sleep(1600);
        if (!alive) return;
        let check;
        try {
          check = await api.qrCheck(key);
        } catch (err) {
          label.textContent = `轮询失败：${err.message}`;
          continue;
        }
        if (!alive) return;

        if (check.code === 803) {
          label.innerHTML = '<b>登录成功，正在同步资料…</b>';
          await bootstrapSession();
          toast(`欢迎回来，${state.profile?.nickname || '朋友'}`, 'ok');
          close();
          return;
        }
        if (check.code === 802) {
          const who = check.nickname ? `${check.nickname}，` : '';
          label.textContent = `${who}${QR_STATE[802]}`;
          continue;
        }
        if (check.code === 800) {
          label.textContent = QR_STATE[800];
          showVeil('<span>二维码已过期</span><button class="btn btn-sm" data-act="refresh">重新生成</button>');
          veil.querySelector('[data-act="refresh"]').onclick = () => run();
          return;
        }
        label.textContent = QR_STATE[801];
      }
    } catch (err) {
      if (!alive) return;
      label.textContent = '';
      showVeil(`<span>${err.message}</span><button class="btn btn-sm" data-act="refresh">重试</button>`);
      veil.querySelector('[data-act="refresh"]').onclick = () => run();
    }
  }

  run();
  return () => {
    alive = false;
  };
}

function wirePhoneLogin(box, close) {
  const errorBox = box.querySelector('#lgError');
  const submit = box.querySelector('#lgSubmit');
  const sendBtn = box.querySelector('#lgSend');
  const phoneInput = box.querySelector('#lgPhone');
  const codeInput = box.querySelector('#lgCode');

  const fail = (message) => {
    errorBox.textContent = message;
  };

  const wayOf = () => box.querySelector('[data-way][aria-selected="true"]').dataset.way;

  sendBtn.onclick = async () => {
    const phone = phoneInput.value.trim();
    if (!/^\d{5,}$/.test(phone)) return fail('请先填写手机号');
    sendBtn.disabled = true;
    fail('');
    try {
      const data = await api.sendCaptcha(phone, codeInput.value.trim() || '86');
      if (data.code !== 200) throw new Error(data.message || data.msg || '验证码发送失败');
      toast('验证码已发送', 'ok');
      let left = 60;
      sendBtn.textContent = `${left} 秒后重试`;
      const timer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearInterval(timer);
          sendBtn.disabled = false;
          sendBtn.textContent = '获取验证码';
          return;
        }
        sendBtn.textContent = `${left} 秒后重试`;
      }, 1000);
    } catch (err) {
      sendBtn.disabled = false;
      fail(err.message);
    }
  };

  submit.onclick = async () => {
    const phone = phoneInput.value.trim();
    const country = codeInput.value.trim() || '86';
    if (!/^\d{5,}$/.test(phone)) return fail('手机号格式看起来不对');

    submit.disabled = true;
    fail('');
    try {
      let data;
      if (wayOf() === 'pwd') {
        const password = box.querySelector('#lgPwd').value;
        if (!password) throw new Error('请输入密码');
        data = await api.loginByPassword(phone, password, country);
      } else {
        const captcha = box.querySelector('#lgSms').value.trim();
        if (!captcha) throw new Error('请输入验证码');
        data = await api.loginByCaptcha(phone, captcha, country);
      }
      if (data.code !== 200) throw new Error(data.message || data.msg || `登录失败（code ${data.code}）`);
      await bootstrapSession();
      toast(`欢迎回来，${state.profile?.nickname || '朋友'}`, 'ok');
      close();
    } catch (err) {
      fail(err.message);
    } finally {
      submit.disabled = false;
    }
  };

  box.querySelector('#lgPwd').onkeydown = (event) => {
    if (event.key === 'Enter') submit.click();
  };
  box.querySelector('#lgSms').onkeydown = (event) => {
    if (event.key === 'Enter') submit.click();
  };
}

export function requireLogin(reason) {
  if (isLoggedIn()) return true;
  openLogin(reason);
  return false;
}

export function initAuth() {
  renderAccount();
  on('auth:required', (reason) => {
    closeModal();
    openLogin(reason);
  });
}
