const PREFS_KEY = 'tide.prefs';

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}

const prefs = loadPrefs();

export const state = {
  profile: null,
  likedIds: new Set(),
  myPlaylists: [],
  queue: [],
  index: -1,
  playing: false,
  mode: prefs.mode || 'list',
  level: prefs.level || 'exhigh',
  volume: typeof prefs.volume === 'number' ? prefs.volume : 0.8,
  muted: false,
  lyrics: { synced: false, lines: [], plain: '' },
  lyricIndex: -1,
  // Sidebar tip: dismissed once, stays dismissed.
  hintDismissed: prefs.hintDismissed === true,
  railOff: prefs.railOff === true,
  npImmersive: prefs.npImmersive === true,
  // Reading preferences for the lyric pane; blur is off by default.
  lyric: {
    size: prefs.lyricSize || 'md',
    font: prefs.lyricFont || 'sans',
    blur: prefs.lyricBlur === true,
    trans: prefs.lyricTrans !== false,
    align: prefs.lyricAlign || 'left',
  },
};

export function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      // 心动模式依赖登录态和种子歌曲，重启后无从恢复，落盘时退回列表循环。
      mode: state.mode === 'heart' ? 'list' : state.mode,
      level: state.level,
      volume: state.volume,
      lyricSize: state.lyric.size,
      lyricFont: state.lyric.font,
      lyricBlur: state.lyric.blur,
      lyricTrans: state.lyric.trans,
      lyricAlign: state.lyric.align,
      hintDismissed: state.hintDismissed,
      railOff: state.railOff,
      npImmersive: state.npImmersive,
    }));
  } catch {
    /* private mode: preferences simply do not persist */
  }
}

const bus = new Map();

export function on(event, handler) {
  if (!bus.has(event)) bus.set(event, new Set());
  bus.get(event).add(handler);
  return () => bus.get(event).delete(handler);
}

export function emit(event, detail) {
  for (const handler of bus.get(event) || []) {
    try {
      handler(detail);
    } catch (err) {
      console.error(`[${event}]`, err);
    }
  }
}

export const currentSong = () => state.queue[state.index] || null;
export const isLoggedIn = () => Boolean(state.profile?.userId);
