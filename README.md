# 夜幕牌局 · 狼人杀身份抽牌平台

## 启动

```bash
npm install
npm --prefix server install
npm --prefix client install
npm run seed
npm run dev
```

前端地址：`http://localhost:5173`；后端地址：`http://localhost:4000`。默认使用 `server/werewolf.db` 作为本地缓存。

## Supabase

1. 在 Supabase SQL Editor 执行根目录的 [`supabase_schema.sql`](./supabase_schema.sql)。如果检测到旧 bigint 牌局表，脚本会把它们移动到 `legacy` schema 后创建 UUID/Auth 表，不会删除历史数据。
2. 复制 `server/.env.example` 为 `server/.env`，填写服务端专用 `SUPABASE_SERVICE_ROLE_KEY`（云端写入/敏感操作必需）与 `SUPABASE_ANON_KEY`；复制 `client/.env.example` 为 `client/.env`，填写同一项目的 `VITE_SUPABASE_URL` 与公开 anon key。
3. 启动服务。带 Supabase Session 的请求使用 UUID 云端牌局；没有 Bearer Token 的旧请求继续使用 SQLite/旧 Token 兼容路径。旧镜像同步只有显式设置 `SUPABASE_LEGACY_SYNC=true` 才会启用。

不要把 service role key 暴露给浏览器或提交到 git。`server/.env` 已被 `.gitignore` 忽略。

## 使用流程

打开首页即可创建或加入牌局。法官创建后获得一次性法官链接和邀请码；玩家输入邀请码与 2-20 个字符的姓名即可获得临时座位会话。人数满足后法官点击“开始抽牌”，玩家只能查看自己的身份，法官可查看完整分配、重新洗牌、管理警徽、记录状态并结束牌局。

## 已实现

Supabase Auth 邮箱注册/登录/退出、自动 Session 恢复、profiles 用户中心、UUID 云端牌局与角色分配、Postgres RLS、players/games Realtime、服务端 `crypto.randomInt` 安全洗牌、最小权限的我的身份接口，以及旧 SQLite/judge/player Token 兼容路径。

## 已知限制

需要在真实 Supabase 项目执行 schema 并提供 env key 后，才能进行跨浏览器 Auth/Realtime 联调；本工作区没有配置密钥，因此未伪造“跨浏览器通过”的测试结论。生产环境建议配置 HTTPS、限流和 CSRF 防护。
