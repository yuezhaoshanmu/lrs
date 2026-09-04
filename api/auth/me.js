import { method, supabase, requireUser, json } from '../_lib/supabase.js';
export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return; if (!supabase) return json(res, 503, { error: 'Supabase 尚未配置' });
  const user = await requireUser(req, res); if (!user) return;
  const username = String(user.user_metadata?.username || user.user_metadata?.name || user.email?.split('@')[0] || '夜行者').trim().slice(0, 40);
  const { data: profile, error } = await supabase.from('profiles').upsert({ id: user.id, username, updated_at: new Date().toISOString() }, { onConflict: 'id' }).select('id,username,avatar_url,user_type,created_at,updated_at').single();
  if (error) return json(res, 500, { error: error.message }); res.json({ user: { id: user.id, email: user.email }, profile });
}
