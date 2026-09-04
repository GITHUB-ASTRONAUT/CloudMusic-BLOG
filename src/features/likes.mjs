import * as api from '../lib/api.mjs';
import { emit, isLoggedIn, state } from '../lib/store.mjs';
import { toast } from '../lib/ui.mjs';

export const isLiked = (id) => state.likedIds.has(Number(id));

export async function refreshLikes() {
  if (!isLoggedIn()) {
    state.likedIds = new Set();
    emit('likes:changed');
    return;
  }
  try {
    const data = await api.likeList(state.profile.userId);
    state.likedIds = new Set((data.ids || []).map(Number));
  } catch {
    state.likedIds = new Set();
  }
  emit('likes:changed');
}

export async function toggleLike(id) {
  if (!isLoggedIn()) {
    emit('auth:required', '登录后才能收藏歌曲');
    return;
  }
  const songId = Number(id);
  const next = !isLiked(songId);
  // Optimistic flip, rolled back if the server disagrees.
  if (next) state.likedIds.add(songId);
  else state.likedIds.delete(songId);
  emit('likes:changed');
  try {
    await api.setLiked(songId, next);
    toast(next ? '已加入我喜欢的音乐' : '已取消喜欢', 'ok');
  } catch (err) {
    if (next) state.likedIds.delete(songId);
    else state.likedIds.add(songId);
    emit('likes:changed');
    toast(err.message || '操作失败', 'error');
  }
}
