import { method, supabase, requireUser, publicGame, json } from '../_lib/supabase.js';
export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return; if (!supabase) return json(res, 503, { error: 'Supabase 尚未配置' }); const user = await requireUser(req, res); if (!user) return;
  const [{ data: created, error: ce }, { data: memberships, error: me }] = await Promise.all([supabase.from('games').select('*').eq('owner_id', user.id).order('created_at', { ascending: false }), supabase.from('players').select('game_id').eq('user_id', user.id)]);
  if (ce || me) return json(res, 500, { error: (ce || me).message }); const ids = (memberships || []).map(p => p.game_id); let joined = [];
  if (ids.length) { const result = await supabase.from('games').select('*').in('id', ids).order('created_at', { ascending: false }); if (result.error) return json(res, 500, { error: result.error.message }); joined = result.data || []; }
  res.json({ created: (created || []).map(publicGame), joined: joined.map(publicGame) });
}
