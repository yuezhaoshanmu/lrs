# 夜幕牌局 · 狼人杀身份抽牌平台

## 启动

```bash
npm install
npm --prefix server install
npm --prefix client install
npm run seed
npm run dev
```

前端地址：`http://localhost:5173`；后端地址：`http://localhost:4000`。SQLite 数据库自动生成在 `server/werewolf.db`。

## 使用流程

打开首页即可创建或加入牌局。法官创建后获得一次性法官链接和邀请码；玩家输入邀请码与 2-20 个字符的姓名即可获得临时座位会话。人数满足后法官点击“开始抽牌”，玩家只能查看自己的身份，法官可查看完整分配、重新洗牌、管理警徽、记录状态并结束牌局。

## 已实现

SQLite 持久化、角色种子、邀请码加入、基于 `crypto.randomInt` 的安全洗牌、SHA-256 哈希存储的高强度 judge/player 临时 Token、最小权限的我的身份接口、响应式移动端 UI。

## 已知限制

当前未接入实时 WebSocket 在线状态，二维码使用当前浏览器地址生成；重新洗牌入口保留为法官控制台扩展点，生产环境建议配置 HTTPS、限流和 CSRF 防护。
