import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceDirs = [path.join(projectRoot, 'client/public/role-cards'), path.join(projectRoot, 'images')];
const normalize = value => String(value || '').normalize('NFKC').trim();
const files = [...new Set(sourceDirs.flatMap(dir => {
  try { return fs.readdirSync(dir).filter(file => /\.(png|jpe?g|webp)$/i.test(file)); } catch { return []; }
}))];
const imageNames = new Set(files.map(file => normalize(file.replace(/\.[^.]+$/, ''))));
const roles = db.prepare('SELECT * FROM roles WHERE is_active=1 ORDER BY name').all();
const missing = [], matched = new Set();
for (const role of roles) {
  const candidates = [role.canonical_name, role.name, ...(role.aliases ? String(role.aliases).split(',') : [])].map(normalize).filter(Boolean);
  const found = candidates.map(name => imageNames.has(name) ? name : name.replace(/[（(].*[）)]$/, '').trim()).find(name => imageNames.has(name));
  if (found) matched.add(found); else missing.push(role.name);
}
const unknown = files.map(file => normalize(file.replace(/\.[^.]+$/, ''))).filter(name => !matched.has(name));
console.log(`数据库角色数量：${roles.length}`);
console.log(`角色图片数量：${files.length}`);
console.log(`成功匹配：${roles.length - missing.length}`);
console.log(`缺少图片：${missing.length}`);
console.log(`无法匹配图片：${unknown.length}`);
if (missing.length) console.log(`\n缺少图片：\n${missing.join('\n')}`);
if (unknown.length) console.log(`\n无法匹配：\n${unknown.join('\n')}`);
console.log(`\n项目图片目录：${sourceDirs[0]}`);
