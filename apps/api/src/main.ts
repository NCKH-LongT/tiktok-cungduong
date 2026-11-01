import 'reflect-metadata';
import { createHash, randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { Module, Injectable, Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Req, Res, UseGuards, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma, PrismaClient, RoleCode, EventSource, type PaymentOrder } from '@prisma/client';
import argon2 from 'argon2';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { z } from 'zod';
import type { Webhook, WebhookData } from '@payos/node';
import { giftDedupKey, hasLiveAccess, liveEventSchema, shouldAnswerComment, type LiveEvent } from '@cd/shared';
import { classifyComment } from '@cd/shared/smart-interactions';
import { encryptGeminiKey } from '@cd/shared/gemini-key';
import { DAY_PASS_VND, newOrderCode, payOSClient, settlePaidOrder } from './billing.js';
import { revenueWindow } from './revenue.js';
import { configuredOrigins } from './origins.js';
import { turnstileKeys } from './turnstile.js';
import { validYouTubeVideoUrl } from './youtube.js';
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
type AuthedRequest = Request & { principal?: { id: string; role: RoleCode; sessionId: string; accessUntil: Date | null } };

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
    req.principal = { id: session!.userId, role: session!.user.role, sessionId: session!.id, accessUntil: session!.user.accessUntil };
    return req.principal;
  }
  requireLiveAccess(principal: NonNullable<AuthedRequest['principal']>) {
    if (!hasLiveAccess(principal.role, principal.accessUntil)) fail(402, 'Nạp 50.000₫ để sử dụng LIVE trong 24 giờ');
  }
  async live(id: string, req: AuthedRequest, requireAccess = true) {
    parse(uuid, id);
    const principal = req.principal ?? await this.auth(req);
    if (requireAccess) this.requireLiveAccess(principal);
    const live = await this.db.liveChannel.findFirst({ where: { id, deletedAt: null, ...(principal.role === 'SUPER_ADMIN' ? {} : { ownerId: principal.id }) } });
    if (!live) fail(404, 'LIVE not found');
    return live;
  }
  async overlay(id: string, token: unknown) {
    parse(uuid, id);
    if (typeof token !== 'string' || token.length < 32) fail(401, 'Invalid overlay token');
    const active = await this.db.overlayToken.findFirst({ where: { liveId: id, tokenHash: hash(token as string), revokedAt: null, live: { deletedAt: null } }, include: { live: { include: { owner: { select: { role: true, accessUntil: true } } } } } });
    if (!active) fail(401, 'Invalid overlay token');
    if (!hasLiveAccess(active!.live.owner.role, active!.live.owner.accessUntil)) fail(402, 'LIVE access expired');
  }
  async disconnectOverlays(id: string) {
    for (const socket of await this.io?.in(`live:${id}`).fetchSockets() ?? []) {
      if (socket.data.overlay) socket.disconnect(true);
    }
  }
  async purgeLiveRuntime(id: string) {
    const jobs = await this.speechQueue.getJobs(['waiting', 'paused', 'delayed', 'prioritized', 'completed', 'failed', 'active'], 0, -1);
    for (const job of jobs) {
      if (job.data?.event?.liveId !== id) continue;
      try { await job.remove(); }
      catch { /* Active jobs are removed by the worker after they finish. */ }
    }
    for (const pattern of [`ai:cooldown:${id}:*`, `ai:comment:answered:${id}:*`, `ai:minute:*:${id}:*`]) {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = next;
        if (keys.length) await this.redis.del(...keys);
      } while (cursor !== '0');
    }
    await this.redis.del(`connector:lock:${id}`);
  }
  async deleteLive(id: string) {
    await this.stopLive(id);
    await this.db.liveChannel.update({ where: { id }, data: { deletedAt: new Date() } });
    this.io?.in(`live:${id}`).disconnectSockets(true);
    try {
      await this.purgeLiveRuntime(id);
      await this.db.liveChannel.delete({ where: { id } });
    } catch (error) {
      await this.db.liveChannel.updateMany({ where: { id }, data: { deletedAt: null } });
      throw error;
    }
  }
  async stopLive(id: string) {
    await this.db.liveChannel.update({ where: { id }, data: { status: 'stopped' } });
    await this.db.viewer.updateMany({ where: { liveId: id, deletedAt: null }, data: { deletedAt: new Date() } });
    this.io?.to(`live:${id}`).emit('live.status', { status: 'stopped' });
    await this.redis.publish('connector.stop', id);
    for (let attempt = 0; attempt < 20 && await this.redis.exists(`connector:lock:${id}`); attempt++) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return { status: 'stopped', connectorClosed: !(await this.redis.exists(`connector:lock:${id}`)) };
  }
  async publish(eventInput: unknown, includeSimulatorAI = false) {
    const event = parse(liveEventSchema, eventInput);
    const live = await this.db.liveChannel.findUnique({ where: { id: event.liveId }, include: { owner: { select: { role: true, accessUntil: true } } } });
    if (!live || live.deletedAt) return false;
    if (!hasLiveAccess(live.owner.role, live.owner.accessUntil)) { if (live.status !== 'stopped') await this.stopLive(live.id); return false; }
    if (event.source === 'tiktok' && live.status !== 'connected') return false;
    const userKey = event.user?.id ?? event.user?.uniqueId ?? null;
    const created = await this.db.liveEvent.createMany({ data: [{ eventId: event.eventId, liveId: event.liveId, sessionId: event.sessionId ?? null, source: event.source, type: event.eventType, userKey, payload: event as object, occurredAt: new Date(event.timestamp) }], skipDuplicates: true });
    if (!created.count) return false;
    if (userKey && event.eventType === 'viewer.leave') {
      await this.db.viewer.updateMany({ where: { liveId: event.liveId, userKey }, data: { deletedAt: new Date() } });
    } else if (userKey && event.user) {
      await this.db.viewer.upsert({ where: { liveId_userKey: { liveId: event.liveId, userKey } }, create: { liveId: event.liveId, userKey, nickname: event.user.nickname, avatarUrl: event.user.avatarUrl }, update: { nickname: event.user.nickname, ...(event.user.avatarUrl ? { avatarUrl: event.user.avatarUrl } : {}), lastSeenAt: new Date(), deletedAt: null } });
    }
    // Store the largest cumulative combo count. An x1 -> x5 -> x10 streak contributes 10, not 16.
    let giftChanged = false;
    if (event.eventType === 'gift.received') {
      const p = event.payload;
      const quantity = Math.max(1, Math.min(10000, Math.floor(Number(p.quantity) || 1)));
      const unitCoins = typeof p.estimatedCoins === 'number' && Number.isFinite(p.estimatedCoins)
        ? Math.max(0, Math.floor(p.estimatedCoins)) : null;
      const key = giftDedupKey(event);
      const data = {
        liveId: event.liveId, dedupKey: key, viewerKey: userKey ?? 'unknown',
        nickname: event.user?.nickname,
        giftId: typeof p.giftId === 'string' ? p.giftId : null,
        giftName: typeof p.giftName === 'string' ? p.giftName : 'Gift',
        quantity, estimatedCoins: unitCoins == null ? null : unitCoins * quantity,
        source: event.source, occurredAt: new Date(event.timestamp),
      };
      // The conditional update prevents an older combo update from decreasing the count.
      const changed = await this.db.$transaction(async tx => {
        const inserted = await tx.giftEvent.createMany({ data: [data], skipDuplicates: true });
        if (inserted.count) return true;
        const updated = await tx.giftEvent.updateMany({
          where: { dedupKey: key, quantity: { lt: quantity } },
          data: { quantity, estimatedCoins: data.estimatedCoins },
        });
        return updated.count > 0;
      });
      giftChanged = changed;
    }
    // Live events remain available to Farm animations; duplicates don't replay their effects.
    if (event.eventType !== 'gift.received' || giftChanged || event.payload.repeatEnd !== false) {
      this.io?.to(`live:${event.liveId}`).emit('live.event', event);
    }
    if (event.eventType === 'gift.received') {
      if (giftChanged) this.io?.to(`live:${event.liveId}`).emit('gift.leaderboard.changed', { liveId: event.liveId });
      // Thank once on the final combo signal, even if the cumulative count was saved earlier.
      if (event.payload.repeatEnd === false) return true;
      const firstFinal = await this.redis.set(`gift:final:${giftDedupKey(event)}`, '1', 'EX', 86400, 'NX');
      if (!firstFinal) return true;
    }
    if (event.source === 'tiktok' || includeSimulatorAI) await this.enqueueAI(event);
    return true;
  }
  async enqueueAI(event: LiveEvent) {
    if (!['chat.comment', 'gift.received', 'viewer.join'].includes(event.eventType)) return;
    const config = await this.db.aIConfiguration.findUnique({ where: { liveId: event.liveId } });
    if (!config?.enabled) return;
    if (event.eventType === 'chat.comment' && !shouldAnswerComment(event.payload.text)) return;
    // Fixed windows prevent hot LIVE rooms from extending batching indefinitely.
    const intent = event.eventType === 'chat.comment' ? classifyComment(event.payload.text) : 'OTHER';
    const batchType = event.eventType === 'gift.received' ? 'gift'
      : intent === 'BUDDHA_CHANT' ? 'chant'
      : intent.startsWith('PRAYER_') ? 'prayer' : null;
    if (batchType && event.user?.id && event.source === 'tiktok') {
      const windowMs = batchType === 'gift' ? 10000 : 8000;
      const windowId = Math.floor(Date.now() / windowMs);
      const identity = batchType === 'gift'
        ? String(event.payload.giftId ?? event.payload.giftName ?? 'unknown')
        : batchType === 'prayer' ? intent : 'chant';
      const batchKey = `ai:batch:${event.liveId}:${event.sessionId ?? 'room'}:${batchType}:${identity}:${windowId}`;
      const item = JSON.stringify({ userKey: event.user.id, nickname: event.user.nickname ?? 'phật tử', eventId: event.eventId, giftName: event.payload.giftName, intent });
      await this.redis.rpush(batchKey, item);
      await this.redis.expire(batchKey, 120);
      const scheduled = await this.redis.set(`ai:batch:scheduled:${batchKey}`, '1', 'EX', 120, 'NX');
      if (scheduled) {
        const live = await this.db.liveChannel.findUnique({ where: { id: event.liveId }, select: { ownerId: true } });
        if (!live) return;
        const quota = await this.db.userQuota.findUnique({ where: { userId: live.ownerId } });
        const dayKey = `ai:day:${live.ownerId}:${new Date().toISOString().slice(0, 10)}`;
        const count = await this.redis.incr(dayKey);
        if (count === 1) await this.redis.expire(dayKey, 172800);
        if (count > (quota?.maxAiPerDay ?? 100)) return;
        const delay = Math.max(250, (windowId + 1) * windowMs - Date.now() + 250);
        await this.speechQueue.add('generate-batch', { batchKey, batchType, liveId: event.liveId, event }, {
          jobId: hash(batchKey), delay, priority: batchType === 'gift' ? 1 : batchType === 'chant' ? 2 : 3,
          removeOnComplete: true, attempts: 2, backoff: { type: 'exponential', delay: 1000 },
        });
      }
      return;
    }
    if (event.eventType === 'gift.received' && event.payload.repeatEnd === false) return;
    const isJoin = event.eventType === 'viewer.join';
    const userKey = event.user?.id ?? event.user?.uniqueId ?? 'anon';
    if (isJoin && userKey === 'anon') return;
    let roomKey: string | undefined;
    if (isJoin) {
      const session = event.sessionId ? await this.db.liveSession.findUnique({ where: { id: event.sessionId }, select: { roomId: true } }) : null;
      roomKey = session?.roomId ?? event.sessionId ?? 'simulator';
      if (await this.db.aIWelcome.findUnique({ where: { liveId_roomKey_userKey: { liveId: event.liveId, roomKey, userKey } }, select: { liveId: true } })) return;
    }
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
    if (isJoin) {
      const created = await this.db.aIWelcome.createMany({ data: [{ liveId: event.liveId, roomKey: roomKey!, userKey }], skipDuplicates: true });
      if (!created.count) return;
    }
    try { await this.speechQueue.add('generate', { event }, { jobId: hash(event.eventId), priority, delay: isJoin ? 4000 : 0, removeOnComplete: true, removeOnFail: true, attempts: 2, backoff: { type: 'exponential', delay: 1000 } }); }
    catch (error) {
      if (isJoin && roomKey) await this.db.aIWelcome.deleteMany({ where: { liveId: event.liveId, roomKey, userKey } });
      throw error;
    }
    if (firstComment) await this.redis.set(`ai:comment:answered:${event.liveId}:${userKey}`, '1', 'EX', 86400);
  }
  async leaderboard(id: string, includeSimulator = false) {
    // Rank by the same merit points shown on the overlay. Gifts without a
    // known coin value contribute one point per item instead of sorting as NULL.
    const rows = await this.db.$queryRaw<{ viewerKey: string; gifts: bigint; points: bigint; estimatedCoins: bigint | null }[]>(Prisma.sql`
      SELECT "viewerKey", SUM(quantity)::bigint AS gifts,
             SUM(COALESCE("estimatedCoins", quantity))::bigint AS points,
             SUM("estimatedCoins")::bigint AS "estimatedCoins"
      FROM "GiftEvent"
      WHERE "liveId" = ${id}::uuid
        ${includeSimulator ? Prisma.empty : Prisma.sql`AND source = ${EventSource.tiktok}::"EventSource"`}
      GROUP BY "viewerKey"
      ORDER BY points DESC, gifts DESC, "viewerKey" ASC
      LIMIT 5
    `);
    const viewers = await this.db.viewer.findMany({ where: { liveId: id, userKey: { in: rows.map(r => r.viewerKey) } }, select: { userKey: true, nickname: true, avatarUrl: true } });
    const byKey = new Map(viewers.map(viewer => [viewer.userKey, viewer]));
    return rows.map(r => ({ viewerKey: r.viewerKey, nickname: byKey.get(r.viewerKey)?.nickname, avatarUrl: byKey.get(r.viewerKey)?.avatarUrl, gifts: Number(r.gifts), points: Number(r.points), estimatedCoins: r.estimatedCoins === null ? null : Number(r.estimatedCoins) }));
  }
}

@Injectable()
class SessionGuard implements CanActivate {
  constructor(private readonly services: Services) {}
  async canActivate(context: ExecutionContext) { await this.services.auth(context.switchToHttp().getRequest<AuthedRequest>()); return true; }
}

@Injectable()
class PaidGuard implements CanActivate {
  constructor(private readonly services: Services) {}
  canActivate(context: ExecutionContext) { const req = context.switchToHttp().getRequest<AuthedRequest>(); if ((req.method === 'GET' && req.path === '/lives') || (req.method === 'DELETE' && /^\/lives\/[0-9a-f-]{36}$/i.test(req.path))) return true; this.services.requireLiveAccess(req.principal!); return true; }
}

@Controller()
class HealthController {
  constructor(private readonly s: Services) {}
  @Get('health') health() { return { status: 'ok' }; }
  @Get('ready') async ready() { await this.s.db.$queryRaw`SELECT 1`; await this.s.redis.ping(); return { status: 'ready' }; }
  @Get('public-config') config() { return { turnstileSiteKey: turnstileKeys().siteKey }; }
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
    const turnstileSecretKey = turnstileKeys().secretKey;
    if (turnstileSecretKey) {
      if (!data.turnstileToken) fail(400, 'Turnstile required');
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: new URLSearchParams({ secret: turnstileSecretKey, response: data.turnstileToken! }), signal: AbortSignal.timeout(5000) });
      if (!response.ok) fail(502, 'Không kết nối được dịch vụ Turnstile');
      const verification = await response.json() as { success: boolean; 'error-codes'?: string[] };
      if (!verification.success) {
        const codes = verification['error-codes'] ?? [];
        console.warn('Turnstile verification failed:', codes.join(',') || 'unknown');
        if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) fail(503, 'Cấu hình Turnstile trên máy chủ chưa đúng');
        if (codes.includes('timeout-or-duplicate')) fail(403, 'Mã xác minh đã hết hạn hoặc được sử dụng; vui lòng thử lại');
        fail(403, 'Xác minh Turnstile không thành công; vui lòng thử lại');
      }
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

@Controller('billing')
class BillingController {
  constructor(private readonly s: Services) {}

  @Get('status') @UseGuards(SessionGuard) async status(@Req() req: AuthedRequest) {
    const userId = req.principal!.id;
    const pending = await this.s.db.paymentOrder.findFirst({ where: { userId, status: 'PENDING', checkoutUrl: { not: null } }, orderBy: { createdAt: 'desc' } });
    const payOS = payOSClient();
    if (pending && payOS && await this.s.redis.set(`billing:sync:${pending.id}`, '1', 'EX', 10, 'NX')) {
      try {
        const link = await payOS.paymentRequests.get(Number(pending.orderCode));
        if (link.orderCode === Number(pending.orderCode) && link.amount === pending.amount) {
          if (link.status === 'PAID') await settlePaidOrder(this.s.db, pending.orderCode, link.amountPaid, link.id);
          else if (['CANCELLED', 'EXPIRED', 'FAILED'].includes(link.status)) await this.s.db.paymentOrder.updateMany({ where: { id: pending.id, status: 'PENDING' }, data: { status: link.status } });
        }
      } catch (error) { console.warn('payOS payment status sync failed:', error instanceof Error ? error.message : 'unknown'); }
    }
    const [user, current] = await Promise.all([
      this.s.db.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true, accessUntil: true } }),
      this.s.db.paymentOrder.findFirst({ where: { userId, status: 'PENDING', checkoutUrl: { not: null }, createdAt: { gt: new Date(Date.now() - 15 * 60000) } }, orderBy: { createdAt: 'desc' }, select: { orderCode: true, checkoutUrl: true } }),
    ]);
    return { active: hasLiveAccess(user.role, user.accessUntil), adminFree: ['ADMIN', 'SUPER_ADMIN'].includes(user.role), paymentAvailable: Boolean(payOS), accessUntil: user.accessUntil, priceVnd: DAY_PASS_VND, durationHours: 24, pendingCheckoutUrl: current?.checkoutUrl ?? null, pendingOrderCode: current?.orderCode.toString() ?? null };
  }

  @Post('checkout') @UseGuards(SessionGuard) async checkout(@Req() req: AuthedRequest) {
    if (['ADMIN', 'SUPER_ADMIN'].includes(req.principal!.role)) fail(409, 'Admin access is already free');
    const payOS = payOSClient();
    if (!payOS) fail(503, 'payOS chưa được cấu hình');
    const lockKey = `billing:create:${req.principal!.id}`;
    const lockToken = randomBytes(16).toString('hex');
    if (await this.s.redis.set(lockKey, lockToken, 'EX', 30, 'NX') !== 'OK') fail(409, 'Đang tạo liên kết thanh toán, vui lòng đợi');
    try {
      const existing = await this.s.db.paymentOrder.findFirst({ where: { userId: req.principal!.id, status: 'PENDING', checkoutUrl: { not: null }, createdAt: { gt: new Date(Date.now() - 14 * 60000) } }, orderBy: { createdAt: 'desc' } });
      if (existing?.checkoutUrl) return { checkoutUrl: existing.checkoutUrl, orderCode: existing.orderCode.toString() };
      const appUrl = process.env.PUBLIC_APP_URL ?? 'http://localhost:8090';
      let order: PaymentOrder | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        try { order = await this.s.db.paymentOrder.create({ data: { userId: req.principal!.id, orderCode: newOrderCode(), amount: DAY_PASS_VND } }); break; }
        catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error; }
      }
      if (!order) fail(503, 'Không thể tạo mã đơn hàng');
      const createdOrder = order!;
      try {
        const link = await payOS!.paymentRequests.create({ orderCode: Number(createdOrder.orderCode), amount: DAY_PASS_VND, description: `CD24 ${createdOrder.orderCode}`, returnUrl: new URL('/?payment=success', appUrl).toString(), cancelUrl: new URL('/?payment=cancel', appUrl).toString(), expiredAt: Math.floor(Date.now() / 1000) + 15 * 60 });
        if (link.orderCode !== Number(createdOrder.orderCode) || link.amount !== DAY_PASS_VND || new URL(link.checkoutUrl).protocol !== 'https:') throw new Error('Invalid payOS checkout response');
        await this.s.db.paymentOrder.update({ where: { id: createdOrder.id }, data: { checkoutUrl: link.checkoutUrl, paymentLinkId: link.paymentLinkId } });
        return { checkoutUrl: link.checkoutUrl, orderCode: createdOrder.orderCode.toString() };
      } catch (error) {
        await this.s.db.paymentOrder.updateMany({ where: { id: createdOrder.id, status: 'PENDING' }, data: { status: 'FAILED' } });
        console.error('payOS checkout creation failed:', error instanceof Error ? error.message : 'unknown');
        fail(502, 'Không tạo được liên kết thanh toán payOS');
      }
    } finally {
      await this.s.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, lockKey, lockToken).catch(() => {});
    }
  }

  @Post('payos/webhook') async webhook(@Body() body: unknown) {
    const payOS = payOSClient();
    if (!payOS) fail(503, 'payOS chưa được cấu hình');
    let data: WebhookData;
    try { data = await payOS!.webhooks.verify(body as Webhook); }
    catch { fail(400, 'Invalid payOS webhook signature'); }
    const envelope = body as { code?: string; success?: boolean };
    if (envelope.code === '00' && envelope.success === true && data!.code === '00' && data!.currency === 'VND' && Number.isSafeInteger(data!.orderCode)) {
      await settlePaidOrder(this.s.db, BigInt(data!.orderCode), data!.amount, data!.paymentLinkId);
    }
    return { code: '00', desc: 'success' };
  }
}

@Controller('users') @UseGuards(SessionGuard)
class UsersController {
  constructor(private readonly s: Services) {}
  private admin(req: AuthedRequest) { if (!['SUPER_ADMIN', 'ADMIN'].includes(req.principal!.role)) fail(403, 'Forbidden'); }
  @Get() async list(@Req() req: AuthedRequest) {
    this.admin(req);
    const users = await this.s.db.user.findMany({ where: { deletedAt: null }, select: { id: true, email: true, username: true, role: true, active: true, ttsProvider: true, maxAiReplyWords: true, createdAt: true, quota: { select: { maxAiPerDay: true } } }, take: 100 });
    const day = new Date().toISOString().slice(0, 10);
    const counts = users.length ? await this.s.redis.mget(...users.map(user => `ai:day:${user.id}:${day}`)) : [];
    return users.map((user, index) => ({ id: user.id, email: user.email, username: user.username, role: user.role, active: user.active, ttsProvider: user.ttsProvider, maxAiReplyWords: user.maxAiReplyWords, createdAt: user.createdAt, aiUsageDay: day, aiUsedToday: Number(counts[index] ?? 0), aiLimitToday: user.quota?.maxAiPerDay ?? 100, canResetAiUsage: user.role !== 'SUPER_ADMIN' || req.principal!.role === 'SUPER_ADMIN' }));
  }
  @Post() async create(@Req() req: AuthedRequest, @Body() body: unknown) { this.admin(req); const d = parse(z.object({ email: z.email(), username: z.string().min(3), password: z.string().min(16), role: z.enum(['USER','VIEWER','ADMIN']).default('USER') }), body); if (d.role === 'ADMIN' && req.principal!.role !== 'SUPER_ADMIN') fail(403, 'Forbidden'); const user = await this.s.db.user.create({ data: { email: d.email, username: d.username, passwordHash: await argon2.hash(d.password, { type: argon2.argon2id }), role: d.role } }); await this.s.db.auditLog.create({ data: { actorId: req.principal!.id, action: 'user.create', targetId: user.id } }); return { id: user.id }; }
  @Patch(':id') async update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { this.admin(req); parse(uuid, id); const d = parse(z.object({ active: z.boolean().optional(), role: z.enum(['USER','VIEWER','ADMIN']).optional(), ttsProvider: z.enum(['google','local']).optional(), maxAiReplyWords: z.number().int().min(15).max(100).optional() }), body); const target = await this.s.db.user.findUnique({ where: { id } }); if (!target || (target.role === 'SUPER_ADMIN' && (d.active !== undefined || d.role !== undefined)) || (d.role === 'ADMIN' && req.principal!.role !== 'SUPER_ADMIN')) fail(403, 'Forbidden'); await this.s.db.user.update({ where: { id }, data: d }); if (d.active === false) await this.s.db.authSession.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } }); await this.s.db.auditLog.create({ data: { actorId: req.principal!.id, action: 'user.update', targetId: id } }); return { ok: true }; }
  @Post(':id/ai-usage/reset') async resetAiUsage(@Req() req: AuthedRequest, @Param('id') id: string) {
    this.admin(req);
    parse(uuid, id);
    const target = await this.s.db.user.findFirst({ where: { id, deletedAt: null }, select: { role: true } });
    if (!target) return fail(404, 'User not found');
    if (target.role === 'SUPER_ADMIN' && req.principal!.role !== 'SUPER_ADMIN') fail(403, 'Forbidden');
    const day = new Date().toISOString().slice(0, 10);
    const dayKey = `ai:day:${id}:${day}`;
    const previousUsed = Number(await this.s.redis.get(dayKey) ?? 0);
    await this.s.redis.del(dayKey, `${dayKey}:welcome`, `${dayKey}:repeat-comment`);
    await this.s.db.auditLog.create({ data: { actorId: req.principal!.id, action: 'user.ai_usage.reset', targetId: id, metadata: { day, previousUsed } } });
    return { day, used: 0 };
  }
  @Delete(':id') async remove(@Req() req: AuthedRequest, @Param('id') id: string) { this.admin(req); parse(uuid, id); const target = await this.s.db.user.findUnique({ where: { id } }); if (!target || target.role === 'SUPER_ADMIN') fail(403, 'Forbidden'); const now = new Date(); await this.s.db.$transaction([this.s.db.overlayToken.updateMany({ where: { live: { ownerId: id } }, data: { revokedAt: now } }), this.s.db.liveChannel.updateMany({ where: { ownerId: id }, data: { deletedAt: now, status: 'stopped' } }), this.s.db.user.update({ where: { id }, data: { active: false, deletedAt: now } }), this.s.db.authSession.updateMany({ where: { userId: id }, data: { revokedAt: now } }), this.s.db.auditLog.create({ data: { actorId: req.principal!.id, action: 'user.delete', targetId: id } })]); return { ok: true }; }
}

@Controller('admin') @UseGuards(SessionGuard)
class AdminController {
  constructor(private readonly s: Services) {}

  @Get('revenue') async revenue(@Req() req: AuthedRequest, @Query('from') from?: string, @Query('to') to?: string) {
    if (req.principal!.role !== 'ADMIN' && req.principal!.role !== 'SUPER_ADMIN') fail(403, 'Forbidden');
    let range: ReturnType<typeof revenueWindow>;
    try { range = revenueWindow(from, to); } catch { return fail(400, 'Invalid revenue date range'); }
    const startUtc = range.start.toISOString().replace('T', ' ').replace('Z', '');
    const endUtc = range.end.toISOString().replace('T', ' ').replace('Z', '');

    type DayRow = { day: string; orders: bigint; amount: bigint };
    type UserRow = { userId: string; email: string; username: string; orders: bigint; amount: bigint };
    const [days, users] = await Promise.all([
      this.s.db.$queryRaw<DayRow[]>(Prisma.sql`
        SELECT to_char(("paidAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS day,
               COUNT(*)::bigint AS orders, SUM(amount)::bigint AS amount
        FROM "PaymentOrder"
        WHERE status = 'PAID' AND "paidAt" >= ${startUtc}::timestamp AND "paidAt" < ${endUtc}::timestamp
        GROUP BY 1 ORDER BY day DESC
      `),
      this.s.db.$queryRaw<UserRow[]>(Prisma.sql`
        SELECT p."userId", u.email, u.username,
               COUNT(*)::bigint AS orders, SUM(p.amount)::bigint AS amount
        FROM "PaymentOrder" p JOIN "User" u ON u.id = p."userId"
        WHERE p.status = 'PAID' AND p."paidAt" >= ${startUtc}::timestamp AND p."paidAt" < ${endUtc}::timestamp
        GROUP BY p."userId", u.email, u.username ORDER BY amount DESC, u.email ASC
      `),
    ]);
    const byDay = days.map(row => ({ day: row.day, orders: Number(row.orders), amountVnd: Number(row.amount) }));
    const byUser = users.map(row => ({ userId: row.userId, email: row.email, username: row.username, orders: Number(row.orders), amountVnd: Number(row.amount) }));
    return {
      from: range.from, to: range.to, timeZone: 'Asia/Ho_Chi_Minh',
      totalVnd: byDay.reduce((sum, row) => sum + row.amountVnd, 0),
      paidOrders: byDay.reduce((sum, row) => sum + row.orders, 0),
      payingUsers: byUser.length, byDay, byUser,
    };
  }
}

@Controller('lives') @UseGuards(SessionGuard, PaidGuard)
class LivesController {
  constructor(private readonly s: Services) {}
  private editable(req: AuthedRequest) { if (req.principal!.role === 'VIEWER') fail(403, 'Read only'); }
  @Get() async list(@Req() req: AuthedRequest) { return this.s.db.liveChannel.findMany({ where: { ownerId: req.principal!.id, deletedAt: null }, orderBy: { createdAt: 'desc' } }); }
  @Post() async create(@Req() req: AuthedRequest, @Body() body: unknown) { this.editable(req); const d = parse(liveSchema, body); const quota = await this.s.db.userQuota.findUnique({ where: { userId: req.principal!.id } }); const count = await this.s.db.liveChannel.count({ where: { ownerId: req.principal!.id, deletedAt: null } }); if (count >= (quota?.maxLives ?? 3)) fail(403, 'LIVE quota reached'); return this.s.db.liveChannel.create({ data: { ...d, ownerId: req.principal!.id, ai: { create: {} }, audio: { create: {} }, scene: { create: {} } } }); }
  @Get(':id') async get(@Req() req: AuthedRequest, @Param('id') id: string) { return this.s.live(id, req); }
  @Patch(':id') async update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { this.editable(req); await this.s.live(id, req); const d = parse(liveSchema.partial().extend({ autoReconnect: z.boolean().optional() }), body); return this.s.db.liveChannel.update({ where: { id }, data: d }); }
  @Delete(':id') async remove(@Req() req: AuthedRequest, @Param('id') id: string) { this.editable(req); await this.s.live(id, req, false); await this.s.deleteLive(id); return { ok: true }; }
  @Post(':id/connect') async connect(@Req() req: AuthedRequest, @Param('id') id: string) {
    this.editable(req);
    const live = (await this.s.live(id, req))!;
    if (process.env.TIKTOK_CONNECTOR_MODE !== 'tiktok') fail(503, 'TikTok connector disabled; use simulator');
    const controllers = await this.s.io?.in(`live:${id}`).fetchSockets() ?? [];
    if (!controllers.some(socket => socket.data.controller)) fail(409, 'Open the LIVE dashboard before connecting TikTok');
    if (live.status === 'connecting' || live.status === 'connected') return { status: live.status };
    await this.s.db.liveChannel.update({ where: { id }, data: { status: 'connecting', autoReconnect: false } });
    this.s.io?.to(`live:${id}`).emit('live.status', { status: 'connecting' });
    return { status: 'connecting' };
  }
  @Post(':id/disconnect') async disconnect(@Req() req: AuthedRequest, @Param('id') id: string) { this.editable(req); await this.s.live(id, req); return this.s.stopLive(id); }
  @Get(':id/status') async status(@Req() req: AuthedRequest, @Param('id') id: string) { const live = await this.s.live(id, req); const [lastEvent, connectorLock] = await Promise.all([this.s.db.liveEvent.findFirst({ where: { liveId: id, source: EventSource.tiktok }, orderBy: { createdAt: 'desc' }, select: { occurredAt: true } }), this.s.redis.exists(`connector:lock:${id}`)]); return { status: live!.status, connectorClosed: !connectorLock, lastConnectedAt: live!.lastConnectedAt, lastEventAt: lastEvent?.occurredAt ?? null }; }
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
      this.s.db.liveEvent.findMany({ where: { ...where, type: 'chat.comment' }, orderBy: { createdAt: 'desc' }, take: 100, select: { userKey: true, payload: true, occurredAt: true } }),
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
      recentComments: commentRows.map(row => { const event = row.payload as { user?: { nickname?: string }; payload?: { text?: string } }; return { viewerKey: row.userKey, nickname: event.user?.nickname ?? 'Người xem', text: event.payload?.text ?? '', at: row.occurredAt }; }).filter(item => item.text.trim()).slice(0, 30),
      recentGifts: giftRows.map(row => ({ nickname: row.nickname ?? 'Người xem', giftName: row.giftName, quantity: row.quantity, at: row.occurredAt })),
      topGifts: topGiftRows.map(row => ({ giftName: row.giftName, quantity: row._sum.quantity ?? 0 })),
      leaderboard: await this.s.leaderboard(id),
    };
  }
  @Get(':id/ai-config') async ai(@Req() req: AuthedRequest, @Param('id') id: string) { await this.s.live(id, req); const config = await this.s.db.aIConfiguration.findUnique({ where: { liveId: id }, select: { enabled: true, personality: true, customPrompt: true, cooldownMs: true, maxPerMinute: true, encryptedApiKey: true } }); return config && { enabled: config.enabled, personality: config.personality, customPrompt: config.customPrompt, cooldownMs: config.cooldownMs, maxPerMinute: config.maxPerMinute, hasCustomApiKey: Boolean(config.encryptedApiKey) }; }
  @Get(':id/ai-usage') async aiUsage(@Req() req: AuthedRequest, @Param('id') id: string) { const live = (await this.s.live(id, req))!; const quota = await this.s.db.userQuota.findUnique({ where: { userId: live.ownerId } }); const limit = quota?.maxAiPerDay ?? 100; const ttsLimit = quota?.maxTtsPerDay ?? 100; const day = new Date().toISOString().slice(0, 10); const [aiCount, ttsCount] = await this.s.redis.mget(`ai:day:${live.ownerId}:${day}`, `tts:day:${live.ownerId}:${day}`); const used = Number(aiCount ?? 0), ttsUsed = Number(ttsCount ?? 0); return { day, used, limit, remaining: Math.max(0, limit - used), ttsUsed, ttsLimit, ttsRemaining: Math.max(0, ttsLimit - ttsUsed) }; }
  @Get(':id/ai-history') async aiHistory(@Req() req: AuthedRequest, @Param('id') id: string) { await this.s.live(id, req); return this.s.db.aIInteraction.findMany({ where: { liveId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, answer: true, status: true, createdAt: true } }); }
  @Get(':id/conversation/:viewerKey') async conversation(@Req() req: AuthedRequest, @Param('id') id: string, @Param('viewerKey') viewerKey: string) {
    await this.s.live(id, req);
    if (!viewerKey || viewerKey.length > 200) fail(400, 'Invalid viewer key');
    const comments = await this.s.db.liveEvent.findMany({ where: { liveId: id, userKey: viewerKey, type: 'chat.comment' }, orderBy: { createdAt: 'desc' }, take: 50, select: { eventId: true, payload: true, occurredAt: true } });
    const replies = await this.s.db.aIInteraction.findMany({ where: { liveId: id, sourceEventId: { in: comments.map(comment => comment.eventId) } }, select: { sourceEventId: true, answer: true, createdAt: true } });
    const byEvent = new Map(replies.map(reply => [reply.sourceEventId, reply]));
    return { viewerKey, messages: comments.reverse().flatMap(comment => {
      const event = comment.payload as { payload?: { text?: string } };
      const reply = byEvent.get(comment.eventId);
      return [{ role: 'viewer', text: event.payload?.text ?? '', at: comment.occurredAt }, ...(reply?.answer ? [{ role: 'ai', text: reply.answer, at: reply.createdAt }] : [])];
    }) };
  }
  @Put(':id/ai-config') async setAi(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { this.editable(req); await this.s.live(id, req); const { apiKey, ...d } = parse(z.object({ enabled: z.boolean().optional(), personality: z.string().max(100).optional(), customPrompt: z.string().max(2000).nullable().optional(), cooldownMs: z.number().int().min(1000).max(3600000).optional(), maxPerMinute: z.number().int().min(1).max(60).optional(), apiKey: z.string().trim().min(20).max(256).regex(/^\S+$/).nullable().optional() }), body); const encryptedApiKey = apiKey === undefined ? undefined : apiKey === null ? null : (() => { try { return encryptGeminiKey(apiKey, process.env.ENCRYPTION_KEY); } catch { fail(503, 'Máy chủ chưa cấu hình ENCRYPTION_KEY đủ mạnh'); } })(); const saved = await this.s.db.aIConfiguration.update({ where: { liveId: id }, data: { ...d, encryptedApiKey }, select: { enabled: true, personality: true, customPrompt: true, cooldownMs: true, maxPerMinute: true, encryptedApiKey: true } }); return { enabled: saved.enabled, personality: saved.personality, customPrompt: saved.customPrompt, cooldownMs: saved.cooldownMs, maxPerMinute: saved.maxPerMinute, hasCustomApiKey: Boolean(saved.encryptedApiKey) }; }
  @Get(':id/audio-config') async audio(@Req() req: AuthedRequest, @Param('id') id: string) { await this.s.live(id, req); return this.s.db.audioConfiguration.findUnique({ where: { liveId: id } }); }
  @Put(':id/audio-config') async setAudio(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: unknown) { this.editable(req); await this.s.live(id, req); const d = parse(z.object({ musicUrl: z.url().nullable().optional(), musicVolume: z.number().int().min(0).max(100).optional(), ttsVolume: z.number().int().min(0).max(100).optional(), ttsEnabled: z.boolean().optional(), voiceId: z.enum(['vi-VN-Standard-A','vi-VN-Standard-D','vi-VN-Neural2-A','vi-VN-Neural2-D']).optional(), localVoice: z.enum(['bao_kim','khanh_vy','ngoc_huyen','phuong_linh','quynh_nhu','gia_bao','hoang_nam','huu_dat','quang_huy','thanh_phong']).optional(), speakingRate: z.number().min(0.5).max(2).optional(), pitch: z.number().min(-10).max(10).optional(), woodenFishEnabled: z.boolean().optional(), woodenFishVolume: z.number().int().min(0).max(100).optional() }), body); if (d.musicUrl && !validYouTubeVideoUrl(d.musicUrl)) fail(400, 'Cần URL video YouTube hợp lệ (watch, live, shorts hoặc youtu.be)'); const saved = await this.s.db.audioConfiguration.update({ where: { liveId: id }, data: d }); this.s.io?.to(`live:${id}`).emit('live.config', { audio: saved }); return saved; }
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
    return { events: events.reverse().map(x => x.payload), activeViewers: viewers, roomStats: stoppedRoomStats ?? latestRoomStats ?? null, leaderboard, vipViewerKeys: giftTotals.filter(item => (item._sum.estimatedCoins ?? 0) > 100).map(item => item.viewerKey), giftCoinsByViewer: Object.fromEntries(giftTotals.map(item => [item.viewerKey, item._sum.estimatedCoins ?? 0])), scene, audio, status: live?.status ?? 'stopped' };
  }
}

@Module({ controllers: [HealthController, AuthController, BillingController, UsersController, AdminController, LivesController, OverlayController], providers: [Services, SessionGuard, PaidGuard] })
class AppModule {}

async function main() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  app.use(helmet()); app.use(cookieParser());
  const origins = configuredOrigins(process.env.CORS_ORIGINS ?? process.env.PUBLIC_APP_URL ?? 'http://localhost:3000');
  app.enableCors({ origin: origins, credentials: true });
  app.use((req: Request, _res: Response, next: () => void) => { if (req.path !== '/billing/payos/webhook' && ['POST','PUT','PATCH','DELETE'].includes(req.method) && req.headers.origin && !origins.includes(req.headers.origin)) fail(403, 'Invalid origin'); next(); });
  const s = app.get(Services);
  await s.db.liveChannel.updateMany({ where: { status: { in: ['connecting', 'connected', 'unavailable'] } }, data: { status: 'stopped' } });
  const server = app.getHttpServer();
  const io = new Server(server, { cors: { origin: origins, credentials: true }, path: '/socket.io' });
  s.io = io;
  io.use(async (socket, next) => { try { const liveId = String(socket.handshake.auth.liveId ?? ''); const token = socket.handshake.auth.overlayToken; if (token) { await s.overlay(liveId, token); socket.data.overlay = true; } else { const req = { cookies: Object.fromEntries((socket.handshake.headers.cookie ?? '').split('; ').filter(Boolean).map(x => { const i = x.indexOf('='); return [x.slice(0,i), decodeURIComponent(x.slice(i+1))]; })) } as AuthedRequest; await s.auth(req); await s.live(liveId, req); socket.data.controller = true; } socket.data.liveId = liveId; next(); } catch { next(new Error('Unauthorized')); } });
  const stopTimers = new Map<string, ReturnType<typeof setTimeout>>();
  io.on('connection', socket => {
    const liveId = String(socket.data.liveId);
    socket.join(`live:${liveId}`);
    void s.db.liveChannel.findUnique({ where: { id: liveId }, select: { status: true } }).then(live => {
      if (live && socket.connected) socket.emit('live.status', { status: live.status });
    }).catch(error => console.error('LIVE status sync failed', error));
    if (socket.data.controller) {
      const timer = stopTimers.get(liveId);
      if (timer) clearTimeout(timer);
      stopTimers.delete(liveId);
      socket.on('disconnect', () => {
        const pending = setTimeout(() => {
          stopTimers.delete(liveId);
          void (async () => {
            const controllers = await io.in(`live:${liveId}`).fetchSockets();
            if (controllers.some(peer => peer.data.controller)) return;
            const live = await s.db.liveChannel.findUnique({ where: { id: liveId }, select: { status: true } });
            if (live?.status === 'connecting' || live?.status === 'connected') await s.stopLive(liveId);
          })().catch(error => console.error('Automatic LIVE stop failed', error));
        }, 2000);
        stopTimers.set(liveId, pending);
      });
    }
  });
  await s.subscriber.subscribe('live.events', 'speech.ready', 'connector.status');
  s.subscriber.on('message', async (channel: string, message: string) => { try { if (channel === 'live.events') await s.publish(JSON.parse(message)); else if (channel === 'connector.status') { const change = JSON.parse(message); const live = await s.db.liveChannel.findUnique({ where: { id: change.liveId }, select: { status: true } }); if (live?.status === change.status) io.to(`live:${change.liveId}`).emit('live.status', { status: change.status }); } else { const job = JSON.parse(message); io.to(`live:${job.liveId}`).emit('speech.ready', job); } } catch (error) { console.error('Event processing failed', error instanceof Error ? error.message : 'unknown'); } });
  const shutdown = async () => { io.close(); await s.speechQueue.close(); await s.subscriber.quit(); await s.redis.quit(); await s.db.$disconnect(); await app.close(); process.exit(0); };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  await app.listen(Number(process.env.API_PORT ?? 3001), process.env.API_HOST ?? '0.0.0.0');
}
main().catch(error => { console.error(error); process.exit(1); });
