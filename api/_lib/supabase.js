import { createClient } from '@supabase/supabase-js';

const url = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const supabase = url && key ? createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }) : null;

export const json = (res, status, body) => res.status(status).json(body);
export const method = (req, res, allowed) => {
  if (!allowed.includes(req.method)) { res.setHeader('Allow', allowed); json(res, 405, { error: '请求方法不允许' }); return false; }
  return true;
};
export const bearer = req => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
export async function userFromRequest(req) {
  if (!supabase) return null;
  const token = bearer(req);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data?.user || null;
}
export async function requireUser(req, res) {
  const user = await userFromRequest(req);
  if (!user) { json(res, 401, { code: 'AUTH_REQUIRED', error: '请先登录' }); return null; }
  return user;
}
export const publicGame = game => game && ({ ...game, player_count: game.max_players ?? game.player_count, invite_code: game.invite_code, day_number: game.day_number || 1, phase: game.phase || 'WAITING' });
export const roleView = role => role && ({ id: role.id, name: role.name, canonicalName: role.canonical_name || role.name, aliases: role.aliases ? String(role.aliases).split(',').map(v => v.trim()).filter(Boolean) : [], camp: role.camp, category: role.category, subCategory: role.sub_category, description: role.description, shortDescription: role.short_description || role.description, skillDescription: role.skill_description || role.description, winCondition: role.win_condition, actionPhase: role.action_phase, icon: role.icon, cardImageUrl: role.card_image_url || `/role-cards/${encodeURIComponent(role.name)}.png` });
export const fail = (res, error) => json(res, error.status || 500, { error: error.message || '云端请求失败' });
