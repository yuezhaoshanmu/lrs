import crypto from 'node:crypto';
import { method, supabase, json, createSessionToken, hashToken, sessionExpiry } from '../_lib/supabase.js';

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  if (!supabase) return json(res, 503, { error: 'Supabase 尚未配置' });
  const username = String(req.body?.username || '').normalize('NFKC').trim();
  if (username.length < 2 || username.length > 40) return json(res, 400, { error: '请输入有效用户名' });
  const { data: profile, error } = await supabase.from('profiles').select('id,username,avatar_url,user_type,created_at').eq('username', username).maybeSingle();
  if (error) return json(res, 500, { error: error.message });
  if (!profile) return json(res, 401, { code: 'INVALID_USERNAME', error: '用户名不存在，请先注册' });
  const rawToken = createSessionToken();
  const { error: sessionError } = await supabase.from('sessions').insert({ id: crypto.randomUUID(), user_id: profile.id, token: hashToken(rawToken), created_at: new Date().toISOString(), expires_at: sessionExpiry() });
  if (sessionError) return json(res, 500, { error: sessionError.message });
  return res.json({ user: { id: profile.id, username: profile.username }, token: rawToken });
}
