import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

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

export const verifySupabaseToken = async accessToken => {
  if (!accessToken || !supabaseConfigured) return null;
  const client = supabaseAdmin || supabasePublic;
  if (!client) return null;
  const { data, error } = await client.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user;
};

export { supabaseUrl };
