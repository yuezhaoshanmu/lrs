import { method, supabase, roleView, json } from './_lib/supabase.js';
export default async function handler(req, res) {
  if (!method(req, res, ['GET'])) return;
  if (!supabase) return json(res, 503, { error: 'Supabase 尚未配置' });
  const { data, error } = await supabase.from('roles').select('*').eq('is_active', true).order('camp').order('sub_category').order('name');
  if (error) return json(res, 500, { error: error.message });
  res.json({ roles: (data || []).map(roleView) });
}
