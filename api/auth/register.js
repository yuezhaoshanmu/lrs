import crypto from 'node:crypto';
import { method, supabase, json, createSessionToken, hashToken, sessionExpiry } from '../_lib/supabase.js';

const publicUser = profile => ({ id: profile.id, username: profile.username });

export default async function handler(req, res) {
  if (!method(req, res, ['POST'])) return;
  if (!supabase) return json(res, 503, { error: 'Supabase 尚未配置' });
  const username = String(req.body?.username || '').normalize('NFKC').trim();
  if (username.length < 2 || username.length > 40) return json(res, 400, { error: '用户名需为 2-40 个字符' });
  const { data: existing, error: lookupError } = await supabase.from('profiles').select('id').eq('username', username).maybeSingle();
  if (lookupError) return json(res, 500, { error: lookupError.message });
  if (existing) return json(res, 409, { code: 'USERNAME_TAKEN', error: '用户名已存在' });
  const profile = { id: crypto.randomUUID(), username, created_at: new Date().toISOString() };
  const { data: created, error: createError } = await supabase.from('profiles').insert(profile).select('id,username,avatar_url,user_type,created_at').single();
  if (createError) return json(res, createError.code === '23505' ? 409 : 500, { error: createError.code === '23505' ? '用户名已存在' : createError.message });
  const rawToken = createSessionToken();
  const { error: sessionError } = await supabase.from('sessions').insert({ id: crypto.randomUUID(), user_id: created.id, token: hashToken(rawToken), created_at: new Date().toISOString(), expires_at: sessionExpiry() });
  if (sessionError) return json(res, 500, { error: sessionError.message });
  return res.status(201).json({ user: publicUser(created), token: rawToken });
}
