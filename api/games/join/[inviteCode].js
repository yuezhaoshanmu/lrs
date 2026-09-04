import { method, supabase, requireUser, publicGame, json } from '../../_lib/supabase.js';
export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  if (!supabase) return json(res, 503, { error: 'Supabase 尚未配置' });
  if (!await requireUser(req, res)) return;
  const { data: game, error } = await supabase.from('games').select('*').eq('invite_code', String(req.query.inviteCode || '').toUpperCase()).maybeSingle(); if (error) return json(res, 500, { error: error.message });
  if (!game) return json(res, 404, { error: '邀请码不存在' });
  const { count } = await supabase.from('players').select('id', { count: 'exact', head: true }).eq('game_id', game.id);
  res.json({ game: { ...publicGame(game), joined_count: count || 0 }, canJoin: ['open', 'WAITING'].includes(game.status) && (count || 0) < (game.max_players ?? game.player_count) });
}
