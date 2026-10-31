import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const base = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080';
const db = new PrismaClient();
let cookie = '';
async function request(path, method = 'GET', body) {
  const response = await fetch(base + '/api' + path, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const session = response.headers.get('set-cookie');
  if (session) cookie = session.split(';')[0];
  const data = await response.json();
  if (!response.ok) throw new Error(path + ' returned ' + response.status);
  return data;
}

const admin = await request('/auth/login', 'POST', { login: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
assert.ok(admin.id);
const live = await request('/lives', 'POST', { uniqueId: 'stats_' + randomUUID().slice(0, 8), title: 'Stats smoke' });
try {
  const roomId = 'stats-room-' + randomUUID();
  const session = await db.liveSession.create({ data: { liveId: live.id, roomId } });
  const events = [
    ['room.connected', null, {}],
    ['room.stats', null, { viewerCount: 2, totalViewers: 12 }],
    ['viewer.join', 'viewer-1', {}],
    ['viewer.join', 'viewer-2', {}],
    ['chat.comment', 'viewer-1', { text: 'Xin chào' }],
    ['viewer.like', 'viewer-1', { count: 5 }],
    ['viewer.like', 'viewer-2', { count: 2 }],
    ['viewer.share', 'viewer-1', {}],
  ];
  await db.liveEvent.createMany({ data: events.map(([type, userKey, payload]) => {
    const timestamp = new Date();
    return {
      eventId: randomUUID(), liveId: live.id, sessionId: session.id, source: 'tiktok',
      type, userKey, occurredAt: timestamp,
      payload: { eventId: randomUUID(), liveId: live.id, sessionId: session.id, source: 'tiktok', eventType: type, timestamp: timestamp.toISOString(), user: userKey ? { id: userKey, nickname: userKey } : undefined, payload },
    };
  }) });
  await db.giftEvent.create({ data: { liveId: live.id, dedupKey: randomUUID(), viewerKey: 'viewer-1', nickname: 'viewer-1', giftName: 'Hoa hồng', quantity: 3, source: 'tiktok', occurredAt: new Date() } });
  const stats = await request('/lives/' + live.id + '/analytics');
  assert.equal(stats.currentViewers, 0);
  assert.equal(stats.totalViewers, 12);
  assert.equal(stats.uniqueJoiners, 2);
  assert.equal(stats.comments, 1);
  assert.equal(stats.likeEvents, 2);
  assert.equal(stats.hearts, 7);
  assert.equal(stats.shares, 1);
  assert.equal(stats.gifts, 3);
  assert.equal(stats.recentComments[0].text, 'Xin chào');
  assert.equal(stats.topGifts[0].giftName, 'Hoa hồng');
  const reconnected = await db.liveSession.create({ data: { liveId: live.id, roomId } });
  const timestamp = new Date();
  await db.liveEvent.createMany({ data: [
    { eventId: randomUUID(), liveId: live.id, sessionId: reconnected.id, source: 'tiktok', type: 'room.connected', occurredAt: timestamp, payload: { eventType: 'room.connected', payload: { roomId } } },
    { eventId: randomUUID(), liveId: live.id, sessionId: reconnected.id, source: 'tiktok', type: 'chat.comment', userKey: 'viewer-2', occurredAt: timestamp, payload: { eventType: 'chat.comment', user: { id: 'viewer-2', nickname: 'viewer-2' }, payload: { text: 'Lần hai' } } },
  ] });
  const afterReconnect = await request('/lives/' + live.id + '/analytics');
  assert.equal(afterReconnect.comments, 2);
  assert.equal(afterReconnect.uniqueJoiners, 2);
  assert.equal(afterReconnect.gifts, 3);
  await db.liveSession.create({ data: { liveId: live.id, endedAt: new Date() } });
  const afterFailedAttempt = await request('/lives/' + live.id + '/analytics');
  assert.equal(afterFailedAttempt.uniqueJoiners, 2);
  assert.equal(afterFailedAttempt.comments, 2);
  console.log('Stats smoke passed: room totals, joiners, comments, gifts, likes, hearts, shares, reconnect and failed-session fallback');
} finally {
  await db.liveChannel.delete({ where: { id: live.id } });
  await db.$disconnect();
}
