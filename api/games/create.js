import crypto from 'node:crypto';
import { method, supabase, requireUser, roleView, publicGame, json, fail } from '../_lib/supabase.js';
const now = () => new Date().toISOString();
const code = () => `WOLF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  if (!supabase) return json(res, 503, { error: 'Supabase 尚未配置' });
  const user = await requireUser(req, res); if (!user) return;
  try {
    const { name, playerCount, roles = [] } = req.body || {};
    if (typeof name !== 'string' || name.trim().length < 2 || !Number.isInteger(playerCount) || playerCount < 4 || playerCount > 30 || !Array.isArray(roles)) return json(res, 400, { error: '牌局配置不合法' });
    if (roles.reduce((s, r) => s + Number(r.quantity || 0), 0) !== playerCount) return json(res, 400, { error: `身份牌数量需为 ${playerCount}` });
    const { error: profileError } = await supabase.from('profiles').upsert({ id: user.id, username: String(user.user_metadata?.username || user.email?.split('@')[0] || '夜行者').slice(0, 40), updated_at: now() }, { onConflict: 'id' });
    if (profileError) throw profileError;
    const ids = [...new Set(roles.filter(r => Number(r.quantity) > 0).map(r => Number(r.roleId)))];
    const { data: valid, error: roleError } = await supabase.from('roles').select('id').in('id', ids).eq('is_active', true); if (roleError) throw roleError;
    if ((valid || []).length !== ids.length) return json(res, 400, { error: '牌局包含不可用的身份牌' });
    let inviteCode; do { inviteCode = code(); const { data } = await supabase.from('games').select('id').eq('invite_code', inviteCode).maybeSingle(); if (!data) break; } while (true);
    const game = { id: crypto.randomUUID(), owner_id: user.id, name: name.trim(), invite_code: inviteCode, max_players: playerCount, status: 'open', phase: 'WAITING', day_number: 1, created_at: now(), updated_at: now() };
    const { error: gameError } = await supabase.from('games').insert(game); if (gameError) throw gameError;
    const rows = roles.filter(r => Number(r.quantity) > 0).map(r => ({ game_id: game.id, role_id: Number(r.roleId), count: Number(r.quantity) }));
    const { error: grError } = await supabase.from('game_roles').insert(rows); if (grError) { await supabase.from('games').delete().eq('id', game.id); throw grError; }
    res.status(201).json({ game: publicGame(game), gameId: game.id, inviteCode, cloud: true });
  } catch (e) { fail(res, e); }
}
