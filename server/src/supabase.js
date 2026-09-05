import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const configuredUrl = process.env.SUPABASE_URL || '';
const supabaseUrl = configuredUrl
  .replace(/\/rest\/v1\/?$/i, '')
  .replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';

export const supabaseConfigured = Boolean(supabaseUrl && (serviceKey || anonKey));
export const supabaseAdmin = supabaseConfigured && serviceKey
  ? createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;
export const supabasePublic = supabaseConfigured && anonKey
  ? createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;

export const verifySessionToken = async accessToken => {
  if (!accessToken || !supabaseAdmin) return null;
  const tokenHash = crypto.createHash('sha256').update(String(accessToken)).digest('hex');
  const { data: session, error } = await supabaseAdmin.from('sessions').select('user_id,expires_at').eq('token', tokenHash).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error || !session?.user_id) return null;
  const { data: profile, error: profileError } = await supabaseAdmin.from('profiles').select('id,username,avatar_url,user_type,created_at').eq('id', session.user_id).maybeSingle();
  if (profileError || !profile) return null;
  return { id: profile.id, username: profile.username, profile };
};

export { supabaseUrl };
