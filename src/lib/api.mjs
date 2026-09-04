// Every call goes through our own origin. server.mjs owns the upstream cookie,
// so no credential ever reaches this file.
const BASE = '/api';

export class ApiError extends Error {
  constructor(message, code, payload) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.payload = payload;
  }
}

const OK = new Set([200, 0, 803]);

function clean(params) {
  const out = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = String(value);
  }
  return out;
}

async function request(path, params = {}, options = {}) {
  const { method = 'GET', okCodes = [], signal } = options;
  const fields = clean(params);
  const url = new URL(BASE + path, location.origin);
  const init = { method, signal, headers: {} };

  if (method === 'GET') {
    for (const [key, value] of Object.entries(fields)) url.searchParams.set(key, value);
  } else {
    // Keeps passwords and captchas out of the URL and out of logs.
    init.body = new URLSearchParams(fields).toString();
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('网络请求失败，确认本地服务仍在运行', -1);
  }

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(`响应不是合法 JSON（HTTP ${response.status}）`, response.status);
  }

  const code = data?.code ?? data?.data?.code;
  const allowed = new Set([...OK, ...okCodes]);
  if (typeof code === 'number' && !allowed.has(code)) {
    throw new ApiError(data.message || data.msg || `请求失败（code ${code}）`, code, data);
  }
  if (!response.ok && typeof code !== 'number') {
    throw new ApiError(data.message || data.msg || `HTTP ${response.status}`, response.status, data);
  }
  return data;
}

const get = (path, params, options) => request(path, params, { ...options, method: 'GET' });
const post = (path, params, options) => request(path, params, { ...options, method: 'POST' });

/* ---------- session ---------- */

export const hasServerSession = () => get('/__session');
export const resetServerSession = () => get('/__session/reset');
export const loginStatus = () => get('/login/status');
export const userAccount = () => get('/user/account');
export const logout = () => get('/logout');

export const qrKey = () => get('/login/qr/key');
export const qrCreate = (key) => get('/login/qr/create', { key, qrimg: true });
export const qrCheck = (key) => post('/login/qr/check', { key }, { okCodes: [800, 801, 802] });
export const sendCaptcha = (phone, ctcode) => post('/captcha/sent', { phone, ctcode }, { okCodes: [400, 406] });

export const loginByPassword = (phone, password, countrycode) =>
  post('/login/cellphone', { phone, password, countrycode }, { okCodes: [400, 501, 502, 509] });

export const loginByCaptcha = (phone, captcha, countrycode) =>
  post('/login/cellphone', { phone, captcha, countrycode }, { okCodes: [400, 503] });

/* ---------- user ---------- */

export const userDetail = (uid) => get('/user/detail', { uid });
export const userPlaylist = (uid, limit = 60, offset = 0) => get('/user/playlist', { uid, limit, offset });
export const likeList = (uid) => get('/likelist', { uid });
export const setLiked = (id, like) => get('/like', { id, like });

/* ---------- discovery ---------- */

export const searchDefault = () => get('/search/default');
export const searchHot = () => get('/search/hot/detail');
// type=mobile returns keyword phrases; the web shape returns real songs/artists/albums.
export const searchSuggest = (keywords, signal) => get('/search/suggest', { keywords, type: 'mobile' }, { signal });
export const searchSuggestWeb = (keywords, signal) => get('/search/suggest', { keywords }, { signal });

export const cloudsearch = (keywords, type = 1, limit = 40, offset = 0) =>
  get('/cloudsearch', { keywords, type, limit, offset });

export const searchUsers = (keywords, limit = 20, offset = 0) =>
  get('/search', { keywords, type: 1002, limit, offset });

export const personalized = (limit = 12) => get('/personalized', { limit });
export const toplist = () => get('/toplist');
export const dailySongs = () => get('/recommend/songs');
// 心动模式 / 智能播放：pid 必须是本账号的「我喜欢的音乐」，id 必须在该歌单内。
export const intelligenceList = (id, pid, count = 60) =>
  get('/playmode/intelligence/list', { id, pid, count });
export const playlistDetail = (id) => get('/playlist/detail', { id });

export const playlistTracks = (id, limit = 100, offset = 0) =>
  get('/playlist/track/all', { id, limit, offset });

export const albumDetail = (id) => get('/album', { id });

/* ---------- playback ---------- */

export const songDetail = (ids) => get('/song/detail', { ids: [].concat(ids).join(',') });
export const songUrl = (id, level = 'exhigh') => get('/song/url/v1', { id, level });
export const lyric = (id) => get('/lyric/new', { id });

/* ---------- comments ---------- */

export const commentsNew = (id, opts = {}, signal) =>
  get('/comment/new', {
    id,
    type: opts.type ?? 0,
    pageNo: opts.pageNo ?? 1,
    pageSize: opts.pageSize ?? 20,
    sortType: opts.sortType ?? 1,
    cursor: opts.cursor,
  }, { signal });

export const commentsHot = (id, opts = {}, signal) =>
  get('/comment/hot', {
    id,
    type: opts.type ?? 0,
    limit: opts.limit ?? 100,
    offset: opts.offset ?? 0,
    before: opts.before,
  }, { signal });

// The legacy song-comment endpoint is the only one that still paginates deep:
// plain `offset` dies past ~1000, but `before=<time of the last comment>` seeks
// anywhere in the timeline, which also makes parallel time-sharded scans possible.
export const commentsTimeline = (id, opts = {}, signal) =>
  get('/comment/music', {
    id,
    limit: opts.limit ?? 100,
    offset: opts.before ? 100 : 0,
    before: opts.before,
  }, { signal });

export const commentFloor = (parentCommentId, id, opts = {}) =>
  get('/comment/floor', {
    parentCommentId,
    id,
    type: opts.type ?? 0,
    limit: opts.limit ?? 20,
    time: opts.time,
  });

export const likeComment = (id, cid, like, type = 0) =>
  post('/comment/like', { id, cid, t: like ? 1 : 0, type });

export const sendComment = (id, content, type = 0) =>
  post('/comment', { t: 1, type, id, content });

export const replyComment = (id, content, commentId, type = 0) =>
  post('/comment', { t: 2, type, id, content, commentId });

export const deleteComment = (id, commentId, type = 0) =>
  post('/comment', { t: 0, type, id, commentId });
