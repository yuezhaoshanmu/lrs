import { method, supabase, requireUser, publicGame, roleView, json } from '../../_lib/supabase.js';
export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return; if (!supabase) return json(res, 503, { error: 'Supabase 尚未配置' });
  const user = await requireUser(req, res); if (!user) return;
  const { data: game, error } = await supabase.from('games').select('*').eq('id', req.query.id).maybeSingle(); if (error) return json(res, 500, { error: error.message }); if (!game) return json(res, 404, { error: '牌局不存在' });
  const isJudge = game.owner_id === user.id; const { data: mine } = await supabase.from('players').select('id,game_id,user_id,nickname,seat_number,status,joined_at').eq('game_id', game.id).eq('user_id', user.id).maybeSingle(); if (!isJudge && !mine) return json(res, 403, { error: '无权查看该牌局' });
  const [{ data: players }, { data: gameRoles }] = await Promise.all([supabase.from('players').select('id,game_id,user_id,nickname,seat_number,status,joined_at').eq('game_id', game.id).order('seat_number'), supabase.from('game_roles').select('role_id,count,roles(*)').eq('game_id', game.id)]);
  const roles = (gameRoles || []).map(r => ({ ...roleView(r.roles), role_id: r.role_id, quantity: r.count }));
  res.json({ cloud: true, game: publicGame(game), players: players || [], roles, isJudge, isPlayer: Boolean(mine), player: mine || null });
}
