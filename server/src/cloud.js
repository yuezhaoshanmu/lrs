import crypto from 'node:crypto';
import express from 'express';
import { z } from 'zod';
import db from './db.js';
import {
  supabaseAdmin,
  supabaseConfigured,
  verifySupabaseToken
} from './supabase.js';

const router = express.Router();
const now = () => new Date().toISOString();
const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
const bearer = req => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
const publicPlayer = player => player && ({
  id: player.id,
  game_id: player.game_id,
  nickname: player.nickname,
  seat_number: player.seat_number,
  status: player.status,
  joined_at: player.joined_at
});
const publicGame = game => {
  if (!game) return game;
  const { owner_id, ...safe } = game;
  return {
    ...safe,
    player_count: game.max_players ?? game.player_count,
    invite_code: game.invite_code,
    day_number: game.day_number || 1,
    phase: game.phase || 'WAITING'
  };
};
const roleView = role => role && ({
  id: role.id,
  name: role.name,
  canonicalName: role.canonical_name || role.name,
  aliases: role.aliases ? String(role.aliases).split(',').map(v => v.trim()).filter(Boolean) : [],
  camp: role.camp,
  category: role.category,
  subCategory: role.sub_category,
  description: role.description,
  shortDescription: role.short_description || role.description,
  skillDescription: role.skill_description || role.description,
  winCondition: role.win_condition,
  actionPhase: role.action_phase,
  icon: role.icon,
  cardImageUrl: role.card_image_url || null
});

const cloudRequest = (req, res, next) => {
  // Cloud routes are selected by a Supabase bearer token. Legacy token/cookie
  // requests continue through the SQLite handlers below.
  if (!supabaseConfigured || !supabaseAdmin || !bearer(req)) return next('router');
  const gamePath = req.path.match(/^\/games\/([^/]+)/);
  if (gamePath && !['join'].includes(gamePath[1]) && !isUuid(gamePath[1])) return next('router');
  return next();
};

const auth = async (req, res, next) => {
  if (!supabaseConfigured || !supabaseAdmin) return res.status(503).json({ error: 'Supabase 尚未配置' });
  const user = await verifySupabaseToken(bearer(req));
  if (!user) return res.status(401).json({ code: 'AUTH_REQUIRED', error: '请先登录' });
  req.authUser = user;
  next();
};

router.use(cloudRequest);

const ensureProfile = async user => {
  const username = String(user.user_metadata?.username || user.user_metadata?.name || user.email?.split('@')[0] || '夜行者').trim().slice(0, 40);
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .upsert({ id: user.id, username, updated_at: now() }, { onConflict: 'id' })
    .select('id,username,avatar_url,user_type,created_at,updated_at')
    .single();
  if (error) throw error;
  return data;
};

const getGame = async id => {
  const { data, error } = await supabaseAdmin.from('games').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
};
const getPlayers = async gameId => {
  const { data, error } = await supabaseAdmin
    .from('players')
    .select('id,game_id,user_id,nickname,seat_number,status,joined_at')
    .eq('game_id', gameId)
    .order('seat_number');
  if (error) throw error;
  return data || [];
};
const getMembership = async (gameId, userId) => {
  const { data, error } = await supabaseAdmin
    .from('players')
    .select('id,game_id,user_id,nickname,seat_number,status,joined_at')
    .eq('game_id', gameId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
};
const isJudge = (game, userId) => Boolean(game && userId && game.owner_id === userId);
const requireGameAccess = async (req, res, next) => {
  try {
    const game = await getGame(req.params.id);
    if (!game) return res.status(404).json({ error: '牌局不存在' });
    const judge = isJudge(game, req.authUser.id);
    const membership = judge ? null : await getMembership(game.id, req.authUser.id);
    if (!judge && !membership) return res.status(403).json({ error: '无权查看该牌局' });
    req.cloudGame = game;
    req.cloudJudge = judge;
    req.cloudPlayer = membership;
    next();
  } catch (error) { next(error); }
};
const requireJudge = (req, res, next) => {
  if (!req.cloudJudge) return res.status(403).json({ error: '仅法官可操作' });
  next();
};

const uniqueInviteCode = async () => {
  for (;;) {
    const code = `WOLF-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const { data, error } = await supabaseAdmin.from('games').select('id').eq('invite_code', code).maybeSingle();
    if (error) throw error;
    if (!data) return code;
  }
};

const ensureCloudRoles = async roleInputs => {
  const ids = [...new Set(roleInputs.filter(role => role.quantity > 0).map(role => role.roleId))];
  if (!ids.length) return [];
  const local = db.prepare(`SELECT * FROM roles WHERE id IN (${ids.map(() => '?').join(',')}) AND is_active=1`).all(...ids);
  if (local.length !== ids.length) throw Object.assign(new Error('牌局包含不可用的身份牌'), { status: 400 });
  const rows = local.map(role => ({
    id: role.id,
    name: role.name,
    canonical_name: role.canonical_name,
    aliases: role.aliases,
    camp: role.camp,
    category: role.category,
    sub_category: role.sub_category,
    description: role.description || role.name,
    short_description: role.short_description,
    skill_description: role.skill_description,
    win_condition: role.win_condition,
    action_phase: role.action_phase,
    icon: role.icon || '✦',
    is_active: true,
    created_at: role.created_at || now(),
    updated_at: now()
  }));
  const { error } = await supabaseAdmin.from('roles').upsert(rows, { onConflict: 'id' });
  if (error) throw error;
  return rows;
};
const cloudError = (res, error) => res.status(error.status || 500).json({ error: error.message || '云端请求失败' });

router.get('/auth/me', auth, async (req, res, next) => {
  try {
    const profile = await ensureProfile(req.authUser);
    res.json({ user: { id: req.authUser.id, email: req.authUser.email }, profile });
  } catch (error) { next(error); }
});

router.patch('/auth/profile', auth, async (req, res, next) => {
  try {
    const parsed = z.object({ username: z.string().trim().min(2).max(40), avatar_url: z.string().url().max(500).nullable().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '个人资料不合法' });
    const { data, error } = await supabaseAdmin.from('profiles').update({ ...parsed.data, updated_at: now() }).eq('id', req.authUser.id).select('id,username,avatar_url,user_type,created_at,updated_at').single();
    if (error) return next(error);
    res.json({ profile: data });
  } catch (error) { next(error); }
});

router.get('/user/games', auth, async (req, res, next) => {
  try {
    await ensureProfile(req.authUser);
    const [{ data: owned, error: ownedError }, { data: memberships, error: memberError }] = await Promise.all([
      supabaseAdmin.from('games').select('*').eq('owner_id', req.authUser.id).order('created_at', { ascending: false }),
      supabaseAdmin.from('players').select('game_id,nickname,seat_number').eq('user_id', req.authUser.id)
    ]);
    if (ownedError) throw ownedError;
    if (memberError) throw memberError;
    const memberIds = (memberships || []).map(row => row.game_id);
    let joined = [];
    if (memberIds.length) {
      const { data, error } = await supabaseAdmin.from('games').select('*').in('id', memberIds).order('created_at', { ascending: false });
      if (error) throw error;
      joined = data || [];
    }
    res.json({ created: (owned || []).map(publicGame), joined: joined.map(publicGame) });
  } catch (error) { next(error); }
});

router.post('/games', auth, async (req, res, next) => {
  try {
    const parsed = z.object({
      name: z.string().trim().min(2).max(60),
      playerCount: z.number().int().min(4).max(30),
      roles: z.array(z.object({ roleId: z.number().int(), quantity: z.number().int().min(0) }))
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '牌局配置不合法' });
    const total = parsed.data.roles.reduce((sum, role) => sum + role.quantity, 0);
    if (total !== parsed.data.playerCount) return res.status(400).json({ error: `身份牌数量需为 ${parsed.data.playerCount}` });
    await ensureProfile(req.authUser);
    await ensureCloudRoles(parsed.data.roles);
    const inviteCode = await uniqueInviteCode();
    const gameId = crypto.randomUUID();
    const game = {
      id: gameId,
      owner_id: req.authUser.id,
      name: parsed.data.name,
      invite_code: inviteCode,
      max_players: parsed.data.playerCount,
      status: 'open',
      phase: 'WAITING',
      day_number: 1,
      created_at: now(),
      updated_at: now()
    };
    const { error: gameError } = await supabaseAdmin.from('games').insert(game);
    if (gameError) throw gameError;
    const gameRoles = parsed.data.roles.filter(role => role.quantity > 0).map(role => ({ game_id: gameId, role_id: role.roleId, count: role.quantity }));
    if (gameRoles.length) {
      const { error } = await supabaseAdmin.from('game_roles').insert(gameRoles);
      if (error) {
        await supabaseAdmin.from('games').delete().eq('id', gameId);
        throw error;
      }
    }
    res.status(201).json({ game: publicGame(game), gameId, inviteCode, cloud: true });
  } catch (error) { cloudError(res, error); }
});

router.get('/games/join/:inviteCode', auth, async (req, res, next) => {
  try {
    const { data: game, error } = await supabaseAdmin.from('games').select('*').eq('invite_code', String(req.params.inviteCode || '').toUpperCase()).maybeSingle();
    if (error) throw error;
    if (!game) return res.status(404).json({ error: '邀请码不存在' });
    const { count, error: countError } = await supabaseAdmin.from('players').select('id', { count: 'exact', head: true }).eq('game_id', game.id);
    if (countError) throw countError;
    res.json({ game: { ...publicGame(game), joined_count: count || 0 }, canJoin: ['open', 'WAITING'].includes(game.status) && (count || 0) < (game.max_players ?? game.player_count) });
  } catch (error) { next(error); }
});

router.post('/games/join', auth, async (req, res, next) => {
  try {
    const parsed = z.object({ inviteCode: z.string().trim().min(4), nickname: z.string().trim().min(2).max(20) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: '请输入2-20个字符的玩家姓名' });
    await ensureProfile(req.authUser);
    const { data: game, error } = await supabaseAdmin.from('games').select('*').eq('invite_code', parsed.data.inviteCode.toUpperCase()).maybeSingle();
    if (error) throw error;
    if (!game) return res.status(404).json({ error: '邀请码不存在' });
    if (!['open', 'WAITING'].includes(game.status)) return res.status(400).json({ error: '牌局已开始或结束' });
    const players = await getPlayers(game.id);
    if (players.length >= (game.max_players ?? game.player_count)) return res.status(409).json({ code: 'GAME_FULL', error: '牌局人数已满' });
    if (players.some(player => player.nickname === parsed.data.nickname)) return res.status(409).json({ error: '该玩家姓名已存在' });
    if (players.some(player => player.user_id === req.authUser.id)) return res.status(409).json({ error: '你已经加入该牌局' });
    const row = { id: crypto.randomUUID(), game_id: game.id, user_id: req.authUser.id, nickname: parsed.data.nickname, seat_number: players.length + 1, status: 'ALIVE', joined_at: now() };
    const { error: insertError } = await supabaseAdmin.from('players').insert(row);
    if (insertError) throw insertError;
    res.status(201).json({ cloud: true, gameId: game.id, game: publicGame(game), player: publicPlayer(row) });
  } catch (error) { next(error); }
});

router.get('/games/:id', auth, requireGameAccess, async (req, res, next) => {
  try {
    const players = await getPlayers(req.cloudGame.id);
    const { data: gameRoles, error } = await supabaseAdmin.from('game_roles').select('role_id,count,roles(*)').eq('game_id', req.cloudGame.id);
    if (error) throw error;
    const roles = (gameRoles || []).map(row => ({ ...roleView(row.roles), role_id: row.role_id, quantity: row.count ?? 0 }));
    res.json({ cloud: true, game: publicGame(req.cloudGame), players: players.map(publicPlayer), roles, isJudge: req.cloudJudge, isPlayer: Boolean(req.cloudPlayer), player: req.cloudPlayer ? publicPlayer(req.cloudPlayer) : null });
  } catch (error) { next(error); }
});

router.get('/games/:id/players', auth, requireGameAccess, async (req, res, next) => {
  try { res.json({ players: (await getPlayers(req.cloudGame.id)).map(publicPlayer), cloud: true }); } catch (error) { next(error); }
});

router.get('/games/:id/public-roles', auth, requireGameAccess, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('game_roles').select('role_id,count,roles(*)').eq('game_id', req.cloudGame.id);
    if (error) throw error;
    const roles = (data || []).map(row => ({ ...roleView(row.roles), roleId: row.role_id, count: row.count ?? 0, quantity: row.count ?? 0 }));
    res.json({ cloud: true, gameId: req.cloudGame.id, total: roles.reduce((sum, role) => sum + role.count, 0), roles });
  } catch (error) { next(error); }
});

router.get('/games/:id/my-role', auth, requireGameAccess, async (req, res, next) => {
  try {
    if (!req.cloudPlayer) return res.status(403).json({ error: '仅玩家可查看自己的身份' });
    const { data, error } = await supabaseAdmin.from('player_roles').select('is_revealed,role_id,roles(*)').eq('player_id', req.cloudPlayer.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: '身份尚未分配' });
    res.json({ cloud: true, role: roleView(data.roles), isRevealed: Boolean(data.is_revealed) });
  } catch (error) { next(error); }
});

router.get('/games/:id/roles', auth, requireGameAccess, requireJudge, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('player_roles').select('player_id,is_revealed,role_id,roles(*),players(seat_number,nickname)').eq('game_id', req.cloudGame.id);
    if (error) throw error;
    res.json({ cloud: true, assignments: (data || []).map(row => ({ player_id: row.player_id, seat_number: row.players?.seat_number, nickname: row.players?.nickname, is_revealed: row.is_revealed, ...roleView(row.roles) })) });
  } catch (error) { next(error); }
});

router.get('/games/:id/judge', auth, requireGameAccess, requireJudge, async (req, res, next) => {
  try {
    const [players, assignments] = await Promise.all([
      getPlayers(req.cloudGame.id),
      supabaseAdmin.from('player_roles').select('player_id,is_revealed,roles(*)').eq('game_id', req.cloudGame.id)
    ]);
    if (assignments.error) throw assignments.error;
    const byPlayer = new Map((assignments.data || []).map(row => [row.player_id, row]));
    res.json({ cloud: true, game: publicGame(req.cloudGame), players: players.map(player => ({ ...player, role_name: byPlayer.get(player.id)?.roles?.name || null, role_camp: byPlayer.get(player.id)?.roles?.camp || null, role_icon: byPlayer.get(player.id)?.roles?.icon || null })), events: [], badge: null });
  } catch (error) { next(error); }
});

router.post('/games/:id/start', auth, requireGameAccess, requireJudge, async (req, res, next) => {
  try {
    if (!['open', 'WAITING'].includes(req.cloudGame.status)) return res.status(400).json({ error: '当前状态不可开始' });
    const players = await getPlayers(req.cloudGame.id);
    const { data: gameRoles, error: roleError } = await supabaseAdmin.from('game_roles').select('role_id,count').eq('game_id', req.cloudGame.id);
    if (roleError) throw roleError;
    const deck = (gameRoles || []).flatMap(row => Array.from({ length: row.count ?? 0 }, () => row.role_id));
    if (players.length !== (req.cloudGame.max_players ?? req.cloudGame.player_count)) return res.status(400).json({ error: `还需要 ${(req.cloudGame.max_players ?? req.cloudGame.player_count) - players.length} 名玩家` });
    if (deck.length !== players.length) return res.status(400).json({ error: '身份牌数量不匹配' });
    for (let i = deck.length - 1; i > 0; i -= 1) { const j = crypto.randomInt(i + 1); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const assignments = players.map((player, index) => ({ id: crypto.randomUUID(), game_id: req.cloudGame.id, player_id: player.id, role_id: deck[index], assigned_at: now(), is_revealed: false }));
    const { error: deleteError } = await supabaseAdmin.from('player_roles').delete().eq('game_id', req.cloudGame.id);
    if (deleteError) throw deleteError;
    const { error: insertError } = await supabaseAdmin.from('player_roles').insert(assignments);
    if (insertError) throw insertError;
    const { error: updateError } = await supabaseAdmin.from('games').update({ status: 'playing', phase: 'NIGHT', day_number: 1, updated_at: now() }).eq('id', req.cloudGame.id);
    if (updateError) throw updateError;
    res.json({ cloud: true, ok: true });
  } catch (error) { next(error); }
});

router.post('/games/:id/phase', auth, requireGameAccess, requireJudge, async (req, res, next) => {
  try {
    const phase = req.body?.phase;
    if (!['NIGHT', 'DAY'].includes(phase)) return res.status(400).json({ error: '无效阶段' });
    const dayNumber = phase === 'NIGHT' && req.cloudGame.phase === 'DAY' ? (req.cloudGame.day_number || 1) + 1 : (req.cloudGame.day_number || 1);
    const { error } = await supabaseAdmin.from('games').update({ phase, day_number: dayNumber, status: 'playing', updated_at: now() }).eq('id', req.cloudGame.id);
    if (error) throw error;
    res.json({ cloud: true, ok: true, phase, dayNumber });
  } catch (error) { next(error); }
});

router.post('/games/:id/finish', auth, requireGameAccess, requireJudge, async (req, res, next) => {
  try {
    const winner = ['GOOD', 'WEREWOLF', 'NEUTRAL', 'DRAW'].includes(req.body?.winner) ? req.body.winner : null;
    const { error } = await supabaseAdmin.from('games').update({ status: 'finished', winner, updated_at: now() }).eq('id', req.cloudGame.id);
    if (error) throw error;
    res.json({ cloud: true, ok: true });
  } catch (error) { next(error); }
});

router.post('/games/:id/leave', auth, requireGameAccess, async (req, res, next) => {
  try {
    if (!req.cloudPlayer) return res.status(400).json({ error: '法官不能离开自己创建的牌局' });
    const { error } = await supabaseAdmin.from('players').update({ status: 'LEFT' }).eq('id', req.cloudPlayer.id);
    if (error) throw error;
    res.json({ cloud: true, ok: true });
  } catch (error) { next(error); }
});

// Keep the old router's behavior for non-UUID ids and unauthenticated requests.
router.use((req, res, next) => next());

export default router;
