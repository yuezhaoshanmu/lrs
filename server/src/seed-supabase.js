import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import db from './db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const imageDir = path.join(root, 'client', 'public', 'role-cards');
const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !serviceKey) throw new Error('需要配置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY');

const normalize = value => String(value || '').normalize('NFKC').trim();
const imageFiles = fs.readdirSync(imageDir).filter(file => /\.(png|jpe?g|webp)$/i.test(file));
const imageNames = new Map(imageFiles.map(file => [normalize(file.replace(/\.[^.]+$/, '')), file]));
const imageFor = role => {
  const candidates = [role.canonical_name, role.name, ...(role.aliases ? String(role.aliases).split(',') : [])]
    .map(normalize).filter(Boolean);
  const file = candidates
    .map(name => imageNames.get(name) || imageNames.get(name.replace(/[（(].*[）)]$/, '').trim()))
    .find(Boolean);
  return file ? `/role-cards/${encodeURIComponent(file)}` : null;
};

const roles = db.prepare('SELECT * FROM roles WHERE is_active=1 ORDER BY id').all();
if (!roles.length) throw new Error('本地没有 active 角色，请先运行 npm run seed');

const client = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const timestamp = new Date().toISOString();
const rows = roles.map(role => ({
  id: role.id,
  name: role.name,
  canonical_name: role.canonical_name || role.name,
  aliases: role.aliases,
  camp: role.camp,
  category: role.category,
  sub_category: role.sub_category,
  description: role.description || role.name,
  short_description: role.short_description || role.description || role.name,
  skill_description: role.skill_description || role.description || role.name,
  win_condition: role.win_condition,
  action_phase: role.action_phase,
  icon: role.icon || '✦',
  card_image_url: imageFor(role),
  is_active: true,
  created_at: role.created_at || timestamp,
  updated_at: timestamp
}));

const { error } = await client.from('roles').upsert(rows, { onConflict: 'id' });
if (error) throw error;
console.log(`Synced ${rows.length} active roles to ${supabaseUrl}`);
console.log(`Matched ${rows.filter(row => row.card_image_url).length}/${rows.length} role card images`);
