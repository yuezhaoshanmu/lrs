import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
console.log('[server] initializing database...');
const sqlitePath = path.join(__dirname, '../werewolf.db');
console.log(`[db] sqlite path: ${sqlitePath}`);
const db = new DatabaseSync(sqlitePath);
db.exec('PRAGMA foreign_keys = ON');
db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS roles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, canonical_name TEXT, aliases TEXT, camp TEXT NOT NULL, category TEXT, sub_category TEXT, description TEXT NOT NULL, short_description TEXT, skill_description TEXT, win_condition TEXT, action_phase TEXT, action_order INTEGER, target_type TEXT, max_uses TEXT, can_target_dead INTEGER DEFAULT 0, can_target_self INTEGER DEFAULT 0, is_awakening INTEGER DEFAULT 0, is_limited INTEGER DEFAULT 0, is_easter_egg INTEGER DEFAULT 0, is_collaboration INTEGER DEFAULT 0, version TEXT, source_name TEXT, source_url TEXT, source_date TEXT, verified_at TEXT, verification_status TEXT DEFAULT 'UNVERIFIED', icon TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS games (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, invite_code TEXT UNIQUE NOT NULL, player_count INTEGER NOT NULL, status TEXT NOT NULL, judge_id INTEGER, created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT, judge_token_hash TEXT, judge_token_created_at TEXT, FOREIGN KEY(judge_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL, nickname TEXT NOT NULL, seat_number INTEGER NOT NULL, player_token_hash TEXT, is_ready INTEGER NOT NULL DEFAULT 0, is_online INTEGER NOT NULL DEFAULT 1, joined_at TEXT NOT NULL, last_seen_at TEXT, status TEXT DEFAULT 'ALIVE', death_type TEXT, died_at TEXT, UNIQUE(game_id, seat_number), FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS game_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL, role_id INTEGER NOT NULL, quantity INTEGER NOT NULL, UNIQUE(game_id, role_id), FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE, FOREIGN KEY(role_id) REFERENCES roles(id));
CREATE TABLE IF NOT EXISTS player_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL, player_id INTEGER NOT NULL, role_id INTEGER NOT NULL, is_revealed INTEGER NOT NULL DEFAULT 0, assigned_at TEXT NOT NULL, UNIQUE(game_id, player_id), FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE, FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE, FOREIGN KEY(role_id) REFERENCES roles(id));`);
const addColumn=(table,column,definition)=>{try{db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)}catch{}};
[['roles','canonical_name','TEXT'],['roles','aliases','TEXT'],['roles','category','TEXT'],['roles','sub_category','TEXT'],['roles','short_description','TEXT'],['roles','skill_description','TEXT'],['roles','win_condition','TEXT'],['roles','action_phase','TEXT'],['roles','action_order','INTEGER'],['roles','target_type','TEXT'],['roles','max_uses','TEXT'],['roles','can_target_dead','INTEGER DEFAULT 0'],['roles','can_target_self','INTEGER DEFAULT 0'],['roles','is_awakening','INTEGER DEFAULT 0'],['roles','is_limited','INTEGER DEFAULT 0'],['roles','is_easter_egg','INTEGER DEFAULT 0'],['roles','is_collaboration','INTEGER DEFAULT 0'],['roles','version','TEXT'],['roles','source_name','TEXT'],['roles','source_url','TEXT'],['roles','source_date','TEXT'],['roles','verified_at','TEXT'],['roles','verification_status',"TEXT DEFAULT 'UNVERIFIED'"],['roles','updated_at','TEXT'],['games','day_number','INTEGER DEFAULT 1'],['games','phase',"TEXT DEFAULT 'WAITING'"],['games','winner','TEXT'],['players','status',"TEXT DEFAULT 'ALIVE'"],['players','death_type','TEXT'],['players','died_at','TEXT']].forEach(x=>addColumn(...x));
addColumn('games','judge_token_hash','TEXT'); addColumn('games','judge_token_created_at','TEXT');
addColumn('players','player_token_hash','TEXT'); addColumn('players','last_seen_at','TEXT');
db.exec(`CREATE TABLE IF NOT EXISTS badges (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL, player_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1, awarded_at TEXT, transferred_at TEXT, destroyed_at TEXT, FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE, FOREIGN KEY(player_id) REFERENCES players(id));
CREATE TABLE IF NOT EXISTS badge_events (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL, player_id INTEGER, event_type TEXT NOT NULL, target_player_id INTEGER, created_at TEXT NOT NULL, created_by INTEGER, metadata TEXT, FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS death_events (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL, player_id INTEGER NOT NULL, day_number INTEGER, phase TEXT, death_type TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, created_by INTEGER, FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS game_events (id INTEGER PRIMARY KEY AUTOINCREMENT, game_id INTEGER NOT NULL, actor_player_id INTEGER, target_player_id INTEGER, event_type TEXT NOT NULL, description TEXT, day_number INTEGER, phase TEXT, metadata TEXT, created_at TEXT NOT NULL, created_by INTEGER, FOREIGN KEY(game_id) REFERENCES games(id) ON DELETE CASCADE);`);
db.exec(`CREATE TABLE IF NOT EXISTS role_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, role_id INTEGER NOT NULL, version_name TEXT NOT NULL, skill_description TEXT, rule_description TEXT, source_url TEXT, source_name TEXT, effective_date TEXT, is_current INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, FOREIGN KEY(role_id) REFERENCES roles(id) ON DELETE CASCADE);`);
db.transaction = (fn) => (...args) => { db.exec('BEGIN'); try { const result = fn(...args); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } };

// Supabase is used as the durable store while SQLite keeps the existing synchronous
// query API working. This also gives local development a useful offline fallback.
const configuredSupabaseUrl = process.env.SUPABASE_URL || 'https://dwiepfpenidfmbumisxo.supabase.co';
const supabaseUrl = configuredSupabaseUrl.replace(/\/rest\/v1\/?$/i, '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
// The previous whole-table mirror targets the legacy bigint schema. Keep it
// available for migrations, but never run it implicitly against the new UUID
// Auth schema.
const remoteEnabled = Boolean(supabaseKey && process.env.SUPABASE_LEGACY_SYNC === 'true');
const syncOrder = ['users','roles','games','players','game_roles','player_roles','badges','badge_events','death_events','game_events','role_versions'];
let syncQueue = Promise.resolve();
const rawPrepare = db.prepare.bind(db);

const remoteRequest = async (table, init = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}${init.query || ''}`, {
    ...init,
    signal: controller.signal,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  }).finally(() => clearTimeout(timeout));
  if (!response.ok) throw new Error(`Supabase ${table}: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
};

const localRows = table => rawPrepare(`SELECT * FROM ${table}`).all();
const replaceRemoteSafe = async table => {
  const rows = localRows(table);
  await remoteRequest(table, { method: 'DELETE', query: '?id=not.is.null', headers: { Prefer: 'return=minimal' }, body: undefined });
  if (rows.length) await remoteRequest(table, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
};
const pushTable = async (table, sql, args) => {
  if (/^\s*DELETE\b/i.test(sql)) {
    const where = sql.match(/\bWHERE\s+([\w]+)\s*=\s*\?/i);
    if (where && args.length) {
      await remoteRequest(table, { method: 'DELETE', query: `?${where[1]}=eq.${encodeURIComponent(args[0])}`, headers: { Prefer: 'return=minimal' } });
      return;
    }
  }
  const rows = localRows(table);
  if (rows.length) await remoteRequest(table, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
};
const syncTableWithFilter = (table, sql, args) => {
  if (!remoteEnabled) return;
  syncQueue = syncQueue.then(() => pushTable(table, sql, args)).catch(error => console.warn(`[supabase] ${error.message}`));
};

// Wrap mutations only; reads remain synchronous and continue to use the local cache.
db.prepare = sql => {
  const statement = rawPrepare(sql);
  if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) {
    const match = sql.match(/^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([\w]+)/i);
    const table = match?.[1];
    return {
      run(...args) {
        const result = statement.run(...args);
        if (table) syncTableWithFilter(table, sql, args);
        return result;
      },
      get(...args) { return statement.get(...args); },
      all(...args) { return statement.all(...args); }
    };
  }
  return statement;
};

const importRemote = async () => {
  if (!remoteEnabled) return;
  const remoteData = new Map();
  let hasRemoteData = false;
  let fetchFailed = false;
  for (const table of syncOrder) {
    try {
      const remoteRows = await remoteRequest(table, { method: 'GET', headers: { Prefer: 'count=exact' } });
      remoteData.set(table, remoteRows || []);
      hasRemoteData ||= Boolean(remoteRows?.length);
    } catch (error) {
      fetchFailed = true;
      console.warn(`[supabase] startup sync skipped for ${table}: ${error.message}`);
    }
  }
  if (fetchFailed) return;
  if (hasRemoteData) {
    // Clear children first to respect the foreign-key graph, then restore in order.
    for (const table of [...syncOrder].reverse()) rawPrepare(`DELETE FROM ${table}`).run();
    for (const table of syncOrder) {
      for (const row of remoteData.get(table) || []) {
        const keys = Object.keys(row);
        rawPrepare(`INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...Object.values(row));
      }
    }
  } else {
    // First run: publish an existing local seed/database to Supabase.
    for (const table of syncOrder) if (localRows(table).length) await replaceRemoteSafe(table);
  }
};

if (remoteEnabled) await importRemote();

console.log('[server] database ready');

export default db;
