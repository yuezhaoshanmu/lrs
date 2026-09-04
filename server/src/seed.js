import db from './db.js';

const defs = {
  GOOD: {
    VILLAGER: ['平民', '老流氓', '漩涡平民'],
    CORE_GOD: ['预言家', '女巫', '猎人', '守卫', '白痴', '骑士', '摄梦人', '魔术师'],
    ADVANCED_GOD: ['纯白之女', '守墓人', '猎魔人', '奇迹商人', '定序王子', '魔镜少女', '流光伯爵', '驯熊师', '赏金猎人', '通灵师', '占卜师', '乌鸦', '圣光使者', '圣光骑士'],
    AWAKENED_GOD: ['觉醒预言家', '觉醒女巫', '觉醒猎人', '觉醒守卫', '觉醒愚者', '觉醒摄梦人', '觉醒骑士', '觉醒孤独少女']
  },
  WEREWOLF: {
    NORMAL_WOLF: ['狼人'],
    SPECIAL_WOLF: ['狼王', '白狼王', '狼美人', '隐狼', '石像鬼', '恶灵骑士', '血月使徒', '噩梦之影', '蚀时狼妃', '狼巫', '蚀日侍女', '种狼', '恶夜骑士（格拉海德）'],
    AWAKENED_WOLF: ['觉醒狼王', '觉醒狼美人', '觉醒隐狼', '觉醒石像鬼']
  },
  NEUTRAL: {
    CLASSIC_NEUTRAL: ['丘比特', '咒狐', '不详人', '鬼魂新娘'],
    COLLAB_NEUTRAL: ['许仙寻香魅影', '白蛇预言家']
  }
};

const retired = ['禁言长老', '长老', '单身狗', '暗恋者', '混血儿', '炸弹人', '盗贼', '野孩子', '刺客白狼王'];
const icons = ['🔮', '🧪', '🏹', '🛡️', '✨', '⚔️', '🌙', '🎩', '🐺', '👑', '💋', '🕶️', '🗿', '🗡️', '🌕', '👁️', '⏱️', '🧙', '☀️', '🧬', '🔪', '💘', '🗝️', '🦊', '💣', '💌', '🐾', '❔', '🌸', '🐍', '👤'];
const now = new Date().toISOString();
const aliasesFor = name => name === '丘比特' ? '丘比特（爱神）,爱神' : name === '漩涡平民' ? '旋涡平民' : name === '血月使徒' ? '赤月使徒' : null;
const categoryFor = (camp, sub) => camp === 'GOOD' ? (sub === 'VILLAGER' ? 'VILLAGER' : 'GOD') : camp === 'WEREWOLF' ? 'WOLF' : 'THIRD_PARTY';
const descriptionFor = name => name === '预言家' ? '每晚查验一名玩家的阵营。' : name === '女巫' ? '拥有解药和毒药，各限一次。' : name === '狼人' ? '夜间共同选择袭击目标。' : `${name}按当前板子规则发动技能。`;

const roleColumns = ['name', 'canonical_name', 'aliases', 'camp', 'category', 'sub_category', 'description', 'short_description', 'skill_description', 'win_condition', 'action_phase', 'action_order', 'target_type', 'max_uses', 'is_awakening', 'is_limited', 'is_easter_egg', 'is_collaboration', 'version', 'source_name', 'source_url', 'source_date', 'verified_at', 'verification_status', 'icon', 'is_active', 'created_at', 'updated_at'];
const insertRole = db.prepare(`INSERT INTO roles (${roleColumns.join(',')}) VALUES (${roleColumns.map(() => '?').join(',')})`);
const updateRole = db.prepare(`UPDATE roles SET name=?,canonical_name=?,aliases=?,camp=?,category=?,sub_category=?,description=?,short_description=?,skill_description=?,win_condition=?,action_phase=?,action_order=?,target_type=?,max_uses=?,is_awakening=?,is_limited=?,is_easter_egg=?,is_collaboration=?,version=?,source_name=?,source_url=?,source_date=?,verified_at=?,verification_status=?,icon=?,is_active=1,updated_at=? WHERE id=?`);
const versionInsert = db.prepare(`INSERT INTO role_versions(role_id,version_name,skill_description,rule_description,source_url,source_name,effective_date,is_current,created_at) SELECT id,?,?,?,?,?,?,1,? FROM roles WHERE id=? AND NOT EXISTS (SELECT 1 FROM role_versions rv WHERE rv.role_id=roles.id AND rv.version_name=?)`);

function mergeRole(primary, duplicate) {
  if (!duplicate || duplicate.id === primary.id) return;
  for (const row of db.prepare('SELECT id,game_id,quantity FROM game_roles WHERE role_id=?').all(duplicate.id)) {
    const existing = db.prepare('SELECT id,quantity FROM game_roles WHERE game_id=? AND role_id=?').get(row.game_id, primary.id);
    if (existing) {
      db.prepare('UPDATE game_roles SET quantity=? WHERE id=?').run(existing.quantity + row.quantity, existing.id);
      db.prepare('DELETE FROM game_roles WHERE id=?').run(row.id);
    } else db.prepare('UPDATE game_roles SET role_id=? WHERE id=?').run(primary.id, row.id);
  }
  for (const row of db.prepare('SELECT id,game_id,player_id FROM player_roles WHERE role_id=?').all(duplicate.id)) {
    const existing = db.prepare('SELECT id FROM player_roles WHERE game_id=? AND player_id=?').get(row.game_id, row.player_id);
    if (existing) db.prepare('DELETE FROM player_roles WHERE id=?').run(row.id);
    else db.prepare('UPDATE player_roles SET role_id=? WHERE id=?').run(primary.id, row.id);
  }
  db.prepare('UPDATE role_versions SET role_id=? WHERE role_id=?').run(primary.id, duplicate.id);
  db.prepare('DELETE FROM roles WHERE id=?').run(duplicate.id);
}

function findCanonicalRole(name) {
  const rows = db.prepare('SELECT * FROM roles WHERE canonical_name=? OR name=? ORDER BY CASE WHEN name=? THEN 0 ELSE 1 END, id').all(name, name, name);
  if (!rows.length) return null;
  const primary = rows[0];
  rows.slice(1).forEach(row => mergeRole(primary, row));
  return primary;
}

let iconIndex = 0;
let seeded = 0;
const tx = db.transaction(() => {
  const cupid = db.prepare('SELECT * FROM roles WHERE name=?').get('丘比特');
  const legacyCupid = db.prepare('SELECT * FROM roles WHERE name=?').get('丘比特（爱神）');
  if (cupid && legacyCupid) mergeRole(cupid, legacyCupid);
  if (cupid) db.prepare('UPDATE roles SET canonical_name=?,aliases=?,camp=?,category=?,sub_category=?,is_active=1,updated_at=? WHERE id=?').run('丘比特', '丘比特（爱神）,爱神', 'NEUTRAL', 'THIRD_PARTY', 'CLASSIC_NEUTRAL', now, cupid.id);
  const correctVortex = db.prepare('SELECT * FROM roles WHERE name=?').get('漩涡平民');
  const legacyVortex = db.prepare('SELECT * FROM roles WHERE name=?').get('旋涡平民');
  if (correctVortex && legacyVortex) mergeRole(correctVortex, legacyVortex);

  for (const camp of Object.keys(defs)) for (const sub of Object.keys(defs[camp])) for (const name of defs[camp][sub]) {
    const desc = descriptionFor(name);
    const roleData = [name, name, aliasesFor(name), camp, categoryFor(camp, sub), sub, desc, desc, desc, camp === 'GOOD' ? '好人阵营获胜。' : camp === 'WEREWOLF' ? '狼人阵营获胜。' : '依据当前板子规则获胜。', 'NIGHT', 10, 'ONE_PLAYER', 'EVERY_NIGHT', sub.startsWith('AWAKENED') ? 1 : 0, 0, 0, sub.startsWith('COLLAB') ? 1 : 0, '2026.09', '狼人杀官方正版角色资料', 'https://langrensha.com', '2026-08-29', now, 'UNVERIFIED', icons[iconIndex++ % icons.length], 1, now, now];
    let role = findCanonicalRole(name);
    if (role) updateRole.run(...roleData.slice(0, 25), now, role.id);
    else { insertRole.run(...roleData); role = db.prepare('SELECT * FROM roles WHERE canonical_name=?').get(name); }
    versionInsert.run('2026.09', desc, desc, 'https://langrensha.com', '狼人杀官方正版角色资料', '2026-08-29', now, role.id, '2026.09');
    seeded++;
  }
  for (const name of retired) db.prepare('UPDATE roles SET is_active=0,updated_at=? WHERE name=? OR canonical_name=?').run(now, name, name);
});
tx();
console.log(`Seeded ${seeded} active role definitions`);
