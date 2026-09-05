import crypto from 'node:crypto';
import { method, supabase, requireUser, publicGame, json, fail } from '../_lib/supabase.js';
export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  if (!supabase) return json(res, 503, { error: 'Supabase 尚未配置' });
  const user = await requireUser(req, res); if (!user) return;
  try {
    const { inviteCode, nickname } = req.body || {};
    if (typeof inviteCode !== 'string' || typeof nickname !== 'string' || nickname.trim().length < 2 || nickname.trim().length > 20) return json(res, 400, { error: '请输入2-20个字符的玩家姓名' });
    await supabase.from('profiles').upsert({ id: user.id, username: user.username }, { onConflict: 'id' });
    const { data: game, error } = await supabase.from('games').select('*').eq('invite_code', inviteCode.trim().toUpperCase()).maybeSingle(); if (error) throw error;
    if (!game) return json(res, 404, { error: '邀请码不存在' }); if (!['open', 'WAITING'].includes(game.status)) return json(res, 400, { error: '牌局已开始或结束' });
    const { data: players, error: pe } = await supabase.from('players').select('*').eq('game_id', game.id).order('seat_number'); if (pe) throw pe;
    if ((players || []).length >= (game.max_players ?? game.player_count)) return json(res, 409, { code: 'GAME_FULL', error: '牌局人数已满' });
    if ((players || []).some(p => p.nickname === nickname.trim())) return json(res, 409, { error: '该玩家姓名已存在' });
    const player = { id: crypto.randomUUID(), game_id: game.id, user_id: user.id, nickname: nickname.trim(), seat_number: (players || []).length + 1, status: 'ALIVE', joined_at: new Date().toISOString() };
    const { error: ie } = await supabase.from('players').insert(player); if (ie) throw ie;
    res.status(201).json({ cloud: true, gameId: game.id, game: publicGame(game), player });
  } catch (e) { fail(res, e); }
}
