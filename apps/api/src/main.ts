import 'reflect-metadata';
import { createHash, randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { Module, Injectable, Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Req, Res, UseGuards, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma, PrismaClient, RoleCode, EventSource } from '@prisma/client';
import argon2 from 'argon2';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { z } from 'zod';
import { giftDedupKey, liveEventSchema, shouldAnswerComment, type LiveEvent } from '@cd/shared';
import type { Request, Response } from 'express';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (status: number, message: string): never => { throw new HttpException({ error: message }, status); };
const parse = <T extends z.ZodType>(schema: T, input: unknown): z.infer<T> => {
  const result = schema.safeParse(input);
  if (!result.success) fail(400, result.error.issues.map(i => i.message).join('; '));
  return result.data! as z.infer<T>;
};
const uuid = z.uuid();
const loginSchema = z.object({ login: z.string().min(3), password: z.string().min(1), turnstileToken: z.string().optional() });
const liveSchema = z.object({ uniqueId: z.string().trim().regex(/^@?[a-zA-Z0-9_.]{2,32}$/).transform(value => value.replace(/^@/, '')), title: z.string().min(1).max(100) });
const simulationSchema = z.object({ eventType: z.enum(['viewer.join','viewer.leave','chat.comment','viewer.like','viewer.share','viewer.follow','gift.received','room.stats']), user: z.object({ id: z.string().max(100), nickname: z.string().max(100), avatarUrl: z.url().optional() }).optional(), payload: z.record(z.string(), z.unknown()).default({}), ai: z.boolean().default(false) });
type AuthedRequest = Request & { principal?: { id: string; role: RoleCode; sessionId: string } };

@Injectable()
class Services {
  db = new PrismaClient();
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  subscriber = this.redis.duplicate();
  speechQueue = new Queue('speech', { connection: this.redis });
  io?: Server;

  async auth(req: AuthedRequest) {
    const token = req.cookies?.sid;
    if (typeof token !== 'string') fail(401, 'Authentication required');
    const session = await this.db.authSession.findUnique({ where: { tokenHash: hash(token) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.active || session.user.deletedAt) fail(401, 'Session expired');
    req.principal = { id: session!.userId, role: session!.user.role, sessionId: session!.id };
    return req.principal;
  }
  async live(id: string, req: AuthedRequest) {
    parse(uuid, id);
    const principal = req.principal ?? await this.auth(req);
    const live = await this.db.liveChannel.findFirst({ where: { id, deletedAt: null, ...(principal.role === 'SUPER_ADMIN' ? {} : { ownerId: principal.id }) } });
    if (!live) fail(404, 'LIVE not found');
    return live;
  }
  async overlay(id: string, token: unknown) {
    parse(uuid, id);
    if (typeof token !== 'string' || token.length < 32) fail(401, 'Invalid overlay token');
    const active = await this.db.overlayToken.findFirst({ where: { liveId: id, tokenHash: hash(token as string), revokedAt: null, live: { deletedAt: null } } });
    if (!active) fail(401, 'Invalid overlay token');
  }
  async disconnectOverlays(id: string) {
    for (const socket of await this.io?.in(`live:${id}`).fetchSockets() ?? []) {
      if (socket.data.overlay) socket.disconnect(true);
    }
  }
  async publish(eventInput: unknown, includeSimulatorAI = false) {
    const event = parse(liveEventSchema, eventInput);
    const live = await this.db.liveChannel.findUnique({ where: { id: event.liveId } });
    if (!live || live.deletedAt) return false;
    const userKey = event.user?.id ?? event.user?.uniqueId ?? null;
    const created = await this.db.liveEvent.createMany({ data: [{ eventId: event.eventId, liveId: event.liveId, sessionId: event.sessionId ?? null, source: event.source, type: event.eventType, userKey, payload: event as object, occurredAt: new Date(event.timestamp) }], skipDuplicates: true });
    if (!created.count) return false;
    if (userKey && event.eventType === 'viewer.leave') {
      await this.db.viewer.updateMany({ where: { liveId: event.liveId, userKey }, data: { deletedAt: new Date() } });
    } else if (userKey && event.user) {
      await this.db.viewer.upsert({ where: { liveId_userKey: { liveId: event.liveId, userKey } }, create: { liveId: event.liveId, userKey, nickname: event.user.nickname, avatarUrl: event.user.avatarUrl }, update: { nickname: event.user.nickname, ...(event.user.avatarUrl ? { avatarUrl: event.user.avatarUrl } : {}), lastSeenAt: new Date(), deletedAt: null } });
    }
    let newGift = true;
    if (event.eventType === 'gift.received' && event.payload.repeatEnd !== false) {
      const p = event.payload;
      const giftCreated = await this.db.giftEvent.createMany({ data: [{ liveId: event.liveId, dedupKey: giftDedupKey(event), viewerKey: userKey ?? 'unknown', nickname: event.user?.nickname, giftId: typeof p.giftId === 'string' ? p.giftId : null, giftName: typeof p.giftName === 'string' ? p.giftName : 'Gift', quantity: Math.max(1, Math.min(10000, Number(p.quantity) || 1)), estimatedCoins: typeof p.estimatedCoins === 'number' ? Math.max(0, Math.floor(p.estimatedCoins)) * Math.max(1, Math.min(10000, Number(p.quantity) || 1)) : null, source: event.source, occurredAt: new Date(event.timestamp) }], skipDuplicates: true });
      newGift = giftCreated.count > 0;
    }
    if (!newGift) return true;
    this.io?.to(`live:${event.liveId}`).emit('live.event', event);
    if (newGift && (event.source === 'tiktok' || includeSimulatorAI)) await this.enqueueAI(event);
    return true;
  }
  async enqueueAI(event: LiveEvent) {
    if (!['chat.comment', 'gift.received', 'viewer.join'].includes(event.eventType)) return;
    const config = await this.db.aIConfiguration.findUnique({ where: { liveId: event.liveId } });
    if (!config?.enabled) return;
    if (event.eventType === 'chat.comment' && !shouldAnswerComment(event.payload.text)) return;
    if (event.eventType === 'gift.received' && event.payload.repeatEnd === false) return;
    const isJoin = event.eventType === 'viewer.join';
    const userKey = event.user?.id ?? event.user?.uniqueId ?? 'anon';
    const cooldownKey = `ai:cooldown:${event.liveId}:${event.eventType}:${userKey}`;
    if (!(await this.redis.set(cooldownKey, '1', 'PX', config.cooldownMs, 'NX'))) return;
    const firstComment = event.eventType === 'chat.comment' && !(await this.redis.exists(`ai:comment:answered:${event.liveId}:${userKey}`));
    const category = isJoin ? 'welcome' : event.eventType === 'gift.received' ? 'gift' : firstComment ? 'first-comment' : 'repeat-comment';
    const minuteKey = `ai:minute:${category}:${event.liveId}:${Math.floor(Date.now() / 60000)}`;
    const minuteCount = await this.redis.incr(minuteKey);
    if (minuteCount === 1) await this.redis.expire(minuteKey, 120);
    if (minuteCount > (isJoin || category === 'repeat-comment' ? Math.max(1, Math.floor(config.maxPerMinute / 4)) : config.maxPerMinute)) return;
    const live = await this.db.liveChannel.findUnique({ where: { id: event.liveId }, select: { ownerId: true } });
    if (!live) return;
    const quota = await this.db.userQuota.findUnique({ where: { userId: live.ownerId } });
    const dayKey = `ai:day:${live.ownerId}:${new Date().toISOString().slice(0, 10)}`;
    if (isJoin || category === 'repeat-comment') {
      const categoryDayKey = `${dayKey}:${category}`;
      const categoryDayCount = await this.redis.incr(categoryDayKey);
      if (categoryDayCount === 1) await this.redis.expire(categoryDayKey, 172800);
      if (categoryDayCount > Math.max(1, Math.floor((quota?.maxAiPerDay ?? 100) / 5))) return;
    }
    const dayCount = await this.redis.incr(dayKey);
    if (dayCount === 1) await this.redis.expire(dayKey, 172800);
    if (dayCount > (quota?.maxAiPerDay ?? 100)) return;
    const priority = event.eventType === 'gift.received' ? 1 : firstComment ? 2 : isJoin ? 5 : 3;
    await this.speechQueue.add('generate', { event }, { jobId: hash(event.eventId), priority, delay: isJoin ? 4000 : 0, removeOnComplete: 100, removeOnFail: 100, attempts: 2, backoff: { type: 'exponential', delay: 1000 } });
    if (firstComment) await this.redis.set(`ai:comment:answered:${event.liveId}:${userKey}`, '1', 'EX', 86400);
  }
  async leaderboard(id: string, includeSimulator = false) {
    const rows = await this.db.giftEvent.groupBy({ by: ['viewerKey'], where: { liveId: id, ...(includeSimulator ? {} : { source: EventSource.tiktok }) }, _sum: { quantity: true, estimatedCoins: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 5 });
    const viewers = await this.db.viewer.findMany({ where: { liveId: id, userKey: { in: rows.map(r => r.viewerKey) } }, select: { userKey: true, nickname: true, avatarUrl: true } });
    const byKey = new Map(viewers.map(viewer => [viewer.userKey, viewer]));
    return rows.map(r => ({ viewerKey: r.viewerKey, nickname: byKey.get(r.viewerKey)?.nickname, avatarUrl: byKey.get(r.viewerKey)?.avatarUrl, gifts: r._sum.quantity ?? 0, estimatedCoins: r._sum.estimatedCoins }));
  }
}

@Injectable()
class SessionGuard implements CanActivate {
  constructor(private readonly services: Services) {}
  async canActivate(context: ExecutionContext) { await this.services.auth(context.switchToHttp().getRequest<AuthedRequest>()); return true; }
}

@Controller()
class HealthController {
  constructor(private readonly s: Services) {}
  @Get('health') health() { return { status: 'ok' }; }
  @Get('ready') async ready() { await this.s.db.$queryRaw`SELECT 1`; await this.s.redis.ping(); return { status: 'ready' }; }
  @Get('public-config') config() { return { turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? '' }; }
}

@Controller('auth')
class AuthController {
  constructor(private readonly s: Services) {}
  @Post('login') async login(@Body() input: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const data = parse(loginSchema, input);
    const key = `login:${hash(req.ip ?? 'unknown')}`;
    const attempts = await this.s.redis.incr(key);
    if (attempts === 1) await this.s.redis.expire(key, 900);
    if (attempts > 10) fail(429, 'Too many login attempts');
    if (process.env.TURNSTILE_SECRET_KEY) {
      if (!data.turnstileToken) fail(400, 'Turnstile required');
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: data.turnstileToken!, remoteip: req.ip ?? '' }), signal: AbortSignal.timeout(5000) });
      if (!(await response.json() as { success: boolean }).success) fail(403, 'Turnstile verification failed');
    }
    const user = await this.s.db.user.findFirst({ where: { OR: [{ email: data.login }, { username: data.login }], active: true, deletedAt: null } });
    if (!user || !(await argon2.verify(user.passwordHash, data.password))) fail(401, 'Invalid credentials');
    await this.s.redis.del(key);
    const token = randomBytes(32).toString('base64url');
    await this.s.db.authSession.create({ data: { userId: user!.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + 7 * 86400000) } });
    res.cookie('sid', token, { httpOnly: true, secure: (process.env.PUBLIC_APP_URL ?? '').startsWith('https://'), sameSite: 'lax', path: '/', maxAge: 7 * 86400000 });
    return { id: user!.id, email: user!.email, role: user!.role };
  }
  @Post('logout') @UseGuards(SessionGuard) async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) { await this.s.db.authSession.update({ where: { id: req.principal!.sessionId }, data: { revokedAt: new Date() } }); res.clearCookie('sid'); return { ok: true }; }
  @Get('me') @UseGuards(SessionGuard) async me(@Req() req: AuthedRequest) { return this.s.db.user.findUnique({ where: { id: req.principal!.id }, select: { id: true, email: true, username: true, role: true } }); }
  @Post('change-password') @UseGuards(SessionGuard) async changePassword(@Req() req: AuthedRequest, @Body() body: unknown) { const data = parse(z.object({ oldPassword: z.string(), newPassword: z.string().min(16) }), body); const user = await this.s.db.user.findUniqueOrThrow({ where: { id: req.principal!.id } }); if (!(await argon2.verify(user.passwordHash, data.oldPassword))) fail(401, 'Invalid password'); await this.s.db.$transaction([this.s.db.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(data.newPassword, { type: argon2.argon2id }) } }), this.s.db.authSession.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } })]); return { ok: true }; }
}

@Controller('users') @UseGuards(SessionGuard)
class UsersController {
  constructor(private readonly s: Services) {}
  private admin(req: AuthedRequest) { if (!['SUPER_ADMIN', 'ADMIN'].includes(req.principal!.role)) fail(403, 'Forbidden'); }
  @Get() async list(@Req() req: AuthedRequest) { this.admin(req); return this.s.db.user.findMany({ where: { deletedAt: null }, select: { id: true, email: true, username: true, role: true, active: true, createdAt: true }, take: 100 }); }
  @Post() async create(@Req() req: AuthedRequest, @Body() body: unknown) { this.admin(req); const d = parse(z.object({ email: z.email(), username: z.string().min(3), password: z.string().min(16), role: z.enum(['USER','VIEWER','ADMIN']).default('USER') }), body); if (d.role === 'ADMIN' && req.principal!.role !== 'SUPER_ADMIN') fail(403, 'Forbidden'); const user = await this.s.db.user.create({ data: { email: d.email, username: d.username, passwordHash: await argon2.hash(d.password, { type: argon2.argon2id }), role: d.role } }); await this.s.db.auditLog.create({ data: { actorId: req.principal!.id, action: 'user.create', targetId: user.id } }); return { id: user.id }; }
  @Patch(':id') async update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { this.admin(req); parse(uuid, id); const d = parse(z.object({ active: z.boolean().optional(), role: z.enum(['USER','VIEWER','ADMIN']).optional() }), body); const target = await this.s.db.user.findUnique({ where: { id } }); if (!target || target.role === 'SUPER_ADMIN' || (d.role === 'ADMIN' && req.principal!.role !== 'SUPER_ADMIN')) fail(403, 'Forbidden'); await this.s.db.user.update({ where: { id }, data: d }); if (d.active === false) await this.s.db.authSession.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } }); await this.s.db.auditLog.create({ data: { actorId: req.principal!.id, action: 'user.update', targetId: id } }); return { ok: true }; }
  @Delete(':id') async remove(@Req() req: AuthedRequest, @Param('id') id: string) { this.admin(req); parse(uuid, id); const target = await this.s.db.user.findUnique({ where: { id } }); if (!target || target.role === 'SUPER_ADMIN') fail(403, 'Forbidden'); const now = new Date(); await this.s.db.$transaction([this.s.db.overlayToken.updateMany({ where: { live: { ownerId: id } }, data: { revokedAt: now } }), this.s.db.liveChannel.updateMany({ where: { ownerId: id }, data: { deletedAt: now, status: 'stopped' } }), this.s.db.user.update({ where: { id }, data: { active: false, deletedAt: now } }), this.s.db.authSession.updateMany({ where: { userId: id }, data: { revokedAt: now } }), this.s.db.auditLog.create({ data: { actorId: req.principal!.id, action: 'user.delete', targetId: id } })]); return { ok: true }; }
}

@Controller('lives') @UseGuards(SessionGuard)
class LivesController {
  constructor(private readonly s: Services) {}
  private editable(req: AuthedRequest) { if (req.principal!.role === 'VIEWER') fail(403, 'Read only'); }
  @Get() async list(@Req() req: AuthedRequest) { return this.s.db.liveChannel.findMany({ where: { ownerId: req.principal!.id, deletedAt: null }, orderBy: { createdAt: 'desc' } }); }
  @Post() async create(@Req() req: AuthedRequest, @Body() body: unknown) { this.editable(req); const d = parse(liveSchema, body); const quota = await this.s.db.userQuota.findUnique({ where: { userId: req.principal!.id } }); const count = await this.s.db.liveChannel.count({ where: { ownerId: req.principal!.id, deletedAt: null } }); if (count >= (quota?.maxLives ?? 3)) fail(403, 'LIVE quota reached'); return this.s.db.liveChannel.create({ data: { ...d, ownerId: req.principal!.id, ai: { create: {} }, audio: { create: {} }, scene: { create: {} } } }); }
  @Get(':id') async get(@Req() req: AuthedRequest, @Param('id') id: string) { return this.s.live(id, req); }
  @Patch(':id') async update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { this.editable(req); await this.s.live(id, req); const d = parse(liveSchema.partial().extend({ autoReconnect: z.boolean().optional() }), body); return this.s.db.liveChannel.update({ where: { id }, data: d }); }
  @Delete(':id') async remove(@Req() req: AuthedRequest, @Param('id') id: string) { this.editable(req); await this.s.live(id, req); await this.s.db.liveChannel.update({ where: { id }, data: { deletedAt: new Date(), status: 'stopped' } }); await this.s.db.overlayToken.updateMany({ where: { liveId: id }, data: { revokedAt: new Date() } }); return { ok: true }; }
  @Post(':id/connect') async connect(@Req() req: AuthedRequest, @Param('id') id: string) { this.editable(req); await this.s.live(id, req); if (process.env.TIKTOK_CONNECTOR_MODE !== 'tiktok') fail(503, 'TikTok connector disabled; use simulator'); await this.s.db.liveChannel.update({ where: { id }, data: { status: 'connecting' } }); return { status: 'connecting' }; }
  @Post(':id/disconnect') async disconnect(@Req() req: AuthedRequest, @Param('id') id: string) { this.editable(req); await this.s.live(id, req); await this.s.db.liveChannel.update({ where: { id }, data: { status: 'stopped' } }); return { status: 'stopped' }; }
  @Get(':id/status') async status(@Req() req: AuthedRequest, @Param('id') id: string) { const live = await this.s.live(id, req); const lastEvent = await this.s.db.liveEvent.findFirst({ where: { liveId: id, source: EventSource.tiktok }, orderBy: { createdAt: 'desc' }, select: { occurredAt: true } }); return { status: live!.status, lastConnectedAt: live!.lastConnectedAt, lastEventAt: lastEvent?.occurredAt ?? null }; }
  @Get(':id/events') async events(@Req() req: AuthedRequest, @Param('id') id: string, @Query('limit') limit?: string) { await this.s.live(id, req); return this.s.db.liveEvent.findMany({ where: { liveId: id }, orderBy: { createdAt: 'desc' }, take: Math.min(100, Math.max(1, Number(limit) || 50)) }); }
  @Get(':id/analytics') async analytics(@Req() req: AuthedRequest, @Param('id') id: string) {
    const live = (await this.s.live(id, req))!;
    const session = await this.s.db.liveSession.findFirst({ where: { liveId: id, events: { some: { type: 'room.connected' } } }, orderBy: { startedAt: 'desc' } });
    if (!session) return { counts: {}, currentViewers: null, totalViewers: null, uniqueJoiners: 0, likeEvents: 0, hearts: 0, shares: 0, comments: 0, giftEvents: 0, gifts: 0, recentComments: [], recentGifts: [], topGifts: [], leaderboard: [] };
    const sessions = session.roomId ? await this.s.db.liveSession.findMany({ where: { liveId: id, roomId: session.roomId }, select: { id: true, startedAt: true } }) : [session];
    const sessionIds = sessions.map(item => item.id);
    const startedAt = sessions.reduce((earliest, item) => item.startedAt < earliest ? item.startedAt : earliest, session.startedAt);
    const where = { liveId: id, sessionId: { in: sessionIds }, source: EventSource.tiktok };
    const [grouped, latestRoomStats, commentRows, giftTotals, giftRows, topGiftRows, summary] = await Promise.all([
      this.s.db.liveEvent.groupBy({ by: ['type'], where, _count: true }),
      this.s.db.liveEvent.findFirst({ where: { ...where, type: 'room.stats' }, orderBy: { createdAt: 'desc' }, select: { payload: true, occurredAt: true } }),
      this.s.db.liveEvent.findMany({ where: { ...where, type: 'chat.comment' }, orderBy: { createdAt: 'desc' }, take: 100, select: { payload: true, occurredAt: true } }),
      this.s.db.giftEvent.aggregate({ where: { liveId: id, source: EventSource.tiktok, occurredAt: { gte: startedAt } }, _count: true, _sum: { quantity: true } }),
      this.s.db.giftEvent.findMany({ where: { liveId: id, source: EventSource.tiktok, occurredAt: { gte: startedAt } }, orderBy: { occurredAt: 'desc' }, take: 20, select: { nickname: true, giftName: true, quantity: true, occurredAt: true } }),
      this.s.db.giftEvent.groupBy({ by: ['giftName'], where: { liveId: id, source: EventSource.tiktok, occurredAt: { gte: startedAt } }, _sum: { quantity: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 5 }),
      this.s.db.$queryRaw<{ uniqueJoiners: bigint; hearts: bigint }[]>(Prisma.sql`
        SELECT COUNT(DISTINCT CASE WHEN type = 'viewer.join' THEN "userKey" END)::bigint AS "uniqueJoiners",
               COALESCE(SUM(CASE WHEN type = 'viewer.like' AND (payload->'payload'->>'count') ~ '^[0-9]+$'
                 THEN (payload->'payload'->>'count')::bigint ELSE 0 END), 0)::bigint AS hearts
        FROM "LiveEvent" WHERE "liveId" = ${id}::uuid AND "sessionId" IN (${Prisma.join(sessionIds.map(value => Prisma.sql`${value}::uuid`))}) AND source = 'tiktok'
      `),
    ]);
    const counts = Object.fromEntries(grouped.map(row => [row.type, row._count]));
    const room = (latestRoomStats?.payload as { payload?: { viewerCount?: number; totalViewers?: number } } | null)?.payload;
    return {
      sessionStartedAt: startedAt,
      counts,
      currentViewers: live.status === 'connected' && typeof room?.viewerCount === 'number' ? room.viewerCount : live.status === 'unavailable' || live.status === 'stopped' ? 0 : null,
      totalViewers: typeof room?.totalViewers === 'number' ? room.totalViewers : null,
      roomStatsAt: latestRoomStats?.occurredAt ?? null,
      uniqueJoiners: Number(summary[0]?.uniqueJoiners ?? 0),
      likeEvents: counts['viewer.like'] ?? 0,
      hearts: Number(summary[0]?.hearts ?? 0),
      shares: counts['viewer.share'] ?? 0,
      comments: counts['chat.comment'] ?? 0,
      giftEvents: giftTotals._count,
      gifts: giftTotals._sum.quantity ?? 0,
      recentComments: commentRows.map(row => { const event = row.payload as { user?: { nickname?: string }; payload?: { text?: string } }; return { nickname: event.user?.nickname ?? 'Người xem', text: event.payload?.text ?? '', at: row.occurredAt }; }).filter(item => item.text.trim()).slice(0, 30),
      recentGifts: giftRows.map(row => ({ nickname: row.nickname ?? 'Người xem', giftName: row.giftName, quantity: row.quantity, at: row.occurredAt })),
      topGifts: topGiftRows.map(row => ({ giftName: row.giftName, quantity: row._sum.quantity ?? 0 })),
      leaderboard: await this.s.leaderboard(id),
    };
  }
  @Get(':id/ai-config') async ai(@Req() req: AuthedRequest, @Param('id') id: string) { await this.s.live(id, req); return this.s.db.aIConfiguration.findUnique({ where: { liveId: id }, select: { enabled: true, personality: true, customPrompt: true, cooldownMs: true, maxPerMinute: true } }); }
  @Get(':id/ai-history') async aiHistory(@Req() req: AuthedRequest, @Param('id') id: string) { await this.s.live(id, req); return this.s.db.aIInteraction.findMany({ where: { liveId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, answer: true, status: true, createdAt: true } }); }
  @Put(':id/ai-config') async setAi(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { this.editable(req); await this.s.live(id, req); const d = parse(z.object({ enabled: z.boolean().optional(), personality: z.string().max(100).optional(), customPrompt: z.string().max(2000).nullable().optional(), cooldownMs: z.number().int().min(1000).max(3600000).optional(), maxPerMinute: z.number().int().min(1).max(60).optional() }), body); return this.s.db.aIConfiguration.update({ where: { liveId: id }, data: d }); }
  @Get(':id/audio-config') async audio(@Req() req: AuthedRequest, @Param('id') id: string) { await this.s.live(id, req); return this.s.db.audioConfiguration.findUnique({ where: { liveId: id } }); }
  @Put(':id/audio-config') async setAudio(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { this.editable(req); await this.s.live(id, req); const d = parse(z.object({ musicUrl: z.url().nullable().optional(), musicVolume: z.number().int().min(0).max(100).optional(), ttsVolume: z.number().int().min(0).max(100).optional(), voiceId: z.enum(['vi-VN-Standard-A','vi-VN-Standard-D','vi-VN-Neural2-A','vi-VN-Neural2-D']).optional(), speakingRate: z.number().min(0.5).max(2).optional(), pitch: z.number().min(-10).max(10).optional(), woodenFishEnabled: z.boolean().optional(), woodenFishVolume: z.number().int().min(0).max(100).optional() }), body); if (d.musicUrl && !/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(d.musicUrl)) fail(400, 'Only HTTPS YouTube URLs supported'); const saved = await this.s.db.audioConfiguration.update({ where: { liveId: id }, data: d }); this.s.io?.to(`live:${id}`).emit('live.config', { audio: saved }); return saved; }
  @Get(':id/scene-config') async scene(@Req() req: AuthedRequest, @Param('id') id: string) { await this.s.live(id, req); return this.s.db.sceneConfiguration.findUnique({ where: { liveId: id } }); }
  @Put(':id/scene-config') async setScene(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { this.editable(req); await this.s.live(id, req); const d = parse(z.object({ maxCharacters: z.number().int().min(1).max(100).optional(), inactiveTtlSeconds: z.number().int().min(60).max(86400).optional(), reducedMotion: z.boolean().optional() }), body); const saved = await this.s.db.sceneConfiguration.update({ where: { liveId: id }, data: d }); this.s.io?.to(`live:${id}`).emit('live.config', { scene: saved }); return saved; }
  @Get(':id/rules') async rules(@Req() req: AuthedRequest, @Param('id') id: string) { await this.s.live(id, req); return this.s.db.liveRule.findMany({ where: { liveId: id } }); }
  @Post(':id/rules') async addRule(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { this.editable(req); await this.s.live(id, req); const d = parse(z.object({ triggerType: z.string().max(50), enabled: z.boolean().default(true), actions: z.array(z.object({ type: z.enum(['spawn.character','character.show.comment','camera.focus','sound.play.wooden.fish']) })).max(10), cooldownMs: z.number().int().min(0).max(3600000).default(0), priority: z.number().int().min(-100).max(100).default(0) }), body); return this.s.db.liveRule.create({ data: { ...d, liveId: id } }); }
  @Post(':id/overlay-token/rotate') async rotate(@Req() req: AuthedRequest, @Param('id') id: string) { this.editable(req); await this.s.live(id, req); const token = randomBytes(32).toString('base64url'); await this.s.db.$transaction([this.s.db.overlayToken.updateMany({ where: { liveId: id, revokedAt: null }, data: { revokedAt: new Date() } }), this.s.db.overlayToken.create({ data: { liveId: id, tokenHash: hash(token) } })]); await this.s.disconnectOverlays(id); return { url: `${process.env.PUBLIC_OVERLAY_URL ?? 'http://localhost:3000'}/overlay/${id}?token=${token}` }; }
  @Post(':id/overlay-token/revoke') async revoke(@Req() req: AuthedRequest, @Param('id') id: string) { this.editable(req); await this.s.live(id, req); await this.s.db.overlayToken.updateMany({ where: { liveId: id }, data: { revokedAt: new Date() } }); await this.s.disconnectOverlays(id); return { ok: true }; }
  @Post(':id/simulate') async simulate(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { this.editable(req); await this.s.live(id, req); const d = parse(simulationSchema, body); const event: LiveEvent = { eventId: crypto.randomUUID(), liveId: id, source: 'simulator', eventType: d.eventType, timestamp: new Date().toISOString(), user: d.user, payload: d.payload }; await this.s.publish(event, d.ai); return event; }
}

@Controller('overlay')
class OverlayController {
  constructor(private readonly s: Services) {}
  @Get(':id/snapshot') async snapshot(@Param('id') id: string, @Query('token') token: string) {
    await this.s.overlay(id, token);
    const scene = await this.s.db.sceneConfiguration.findUnique({ where: { liveId: id } });
    const cutoff = new Date(Date.now() - (scene?.inactiveTtlSeconds ?? 900) * 1000);
    const session = await this.s.db.liveSession.findFirst({ where: { liveId: id, events: { some: { type: 'room.connected' } } }, orderBy: { startedAt: 'desc' } });
    const sessionIds = session?.roomId ? (await this.s.db.liveSession.findMany({ where: { liveId: id, roomId: session.roomId }, select: { id: true } })).map(item => item.id) : session ? [session.id] : [];
    const [events, viewers, roomStats, leaderboard, audio, live] = await Promise.all([
      this.s.db.liveEvent.findMany({ where: { liveId: id, type: { not: 'room.stats' }, occurredAt: { gte: cutoff } }, orderBy: { createdAt: 'desc' }, take: 50, select: { payload: true } }),
      this.s.db.viewer.findMany({ where: { liveId: id, deletedAt: null, lastSeenAt: { gte: cutoff }, userKey: { not: '0' } }, orderBy: { lastSeenAt: 'desc' }, take: Math.min(40, scene?.maxCharacters ?? 40), select: { userKey: true, nickname: true, avatarUrl: true, lastSeenAt: true } }),
      sessionIds.length ? this.s.db.liveEvent.findFirst({ where: { liveId: id, sessionId: { in: sessionIds }, type: 'room.stats' }, orderBy: { createdAt: 'desc' }, select: { payload: true } }) : null,
      this.s.leaderboard(id),
      this.s.db.audioConfiguration.findUnique({ where: { liveId: id }, select: { woodenFishEnabled: true, woodenFishVolume: true, musicVolume: true, musicUrl: true, ttsVolume: true, voiceId: true, speakingRate: true, pitch: true } }),
      this.s.db.liveChannel.findUnique({ where: { id }, select: { status: true } }),
    ]);
    const latestRoomStats = roomStats?.payload as LiveEvent | undefined;
    const stoppedRoomStats = latestRoomStats && live?.status !== 'connected' ? { ...latestRoomStats, payload: { ...latestRoomStats.payload, viewerCount: 0 } } : null;
    const giftTotals = await this.s.db.giftEvent.groupBy({ by: ['viewerKey'], where: { liveId: id, viewerKey: { in: viewers.map(viewer => viewer.userKey) } }, _sum: { estimatedCoins: true } });
    return { events: events.reverse().map(x => x.payload), activeViewers: viewers, roomStats: stoppedRoomStats ?? latestRoomStats ?? null, leaderboard, vipViewerKeys: giftTotals.filter(item => (item._sum.estimatedCoins ?? 0) > 100).map(item => item.viewerKey), scene, audio };
  }
}

@Module({ controllers: [HealthController, AuthController, UsersController, LivesController, OverlayController], providers: [Services, SessionGuard] })
class AppModule {}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.use(helmet()); app.use(cookieParser());
  const origins = (process.env.CORS_ORIGINS ?? process.env.PUBLIC_APP_URL ?? 'http://localhost:3000').split(',');
  app.enableCors({ origin: origins, credentials: true });
  app.use((req: Request, _res: Response, next: () => void) => { if (['POST','PUT','PATCH','DELETE'].includes(req.method) && req.headers.origin && !origins.includes(req.headers.origin)) fail(403, 'Invalid origin'); next(); });
  const s = app.get(Services);
  const server = app.getHttpServer();
  const io = new Server(server, { cors: { origin: origins, credentials: true }, path: '/socket.io' });
  s.io = io;
  io.use(async (socket, next) => { try { const liveId = String(socket.handshake.auth.liveId ?? ''); const token = socket.handshake.auth.overlayToken; if (token) { await s.overlay(liveId, token); socket.data.overlay = true; } else { const req = { cookies: Object.fromEntries((socket.handshake.headers.cookie ?? '').split('; ').filter(Boolean).map(x => { const i = x.indexOf('='); return [x.slice(0,i), decodeURIComponent(x.slice(i+1))]; })) } as AuthedRequest; await s.auth(req); await s.live(liveId, req); } socket.data.liveId = liveId; next(); } catch { next(new Error('Unauthorized')); } });
  io.on('connection', socket => { socket.join(`live:${socket.data.liveId}`); });
  await s.subscriber.subscribe('live.events', 'speech.ready');
  s.subscriber.on('message', async (channel: string, message: string) => { try { if (channel === 'live.events') await s.publish(JSON.parse(message)); else { const job = JSON.parse(message); io.to(`live:${job.liveId}`).emit('speech.ready', job); } } catch (error) { console.error('Event processing failed', error instanceof Error ? error.message : 'unknown'); } });
  const shutdown = async () => { io.close(); await s.speechQueue.close(); await s.subscriber.quit(); await s.redis.quit(); await s.db.$disconnect(); await app.close(); process.exit(0); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  await app.listen(Number(process.env.API_PORT ?? 3001), process.env.API_HOST ?? '0.0.0.0');
}
main().catch(error => { console.error(error); process.exit(1); });
