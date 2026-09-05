import { method, supabase, requireUser, json } from '../_lib/supabase.js';
export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return; if (!supabase) return json(res, 503, { error: 'Supabase 尚未配置' });
  const user = await requireUser(req, res); if (!user) return;
  res.json({ user: { id: user.id, username: user.username }, profile: user.profile });
}
