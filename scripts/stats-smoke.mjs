import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { io } from 'socket.io-client';

const base = process.env.SMOKE_BASE_URL ?? 'http://localhost:8090';
const db = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
let cookie = '';
let socket;
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
  await db.liveChannel.update({ where: { id: live.id }, data: { lastConnectedAt: session.startedAt } });
  await db.aIConfiguration.update({ where: { liveId: live.id }, data: { enabled: false } });
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
  await db.viewer.create({ data: { liveId: live.id, userKey: 'viewer-1', nickname: 'viewer-1', avatarUrl: 'https://example.invalid/avatar.png' } });
  const stats = await request('/lives/' + live.id + '/analytics');
  assert.equal(stats.currentViewers, 0);
  assert.equal(stats.totalViewers, 12);
  assert.equal(stats.uniqueJoiners, 2);
  assert.equal(stats.comments, 1);
  assert.equal(stats.likeEvents, 2);
  assert.equal(stats.hearts, 7);
  assert.equal(stats.shares, 1);
  assert.equal(stats.gifts, 3);
  assert.equal(stats.leaderboard[0].gifts, 3);
  assert.equal(stats.leaderboard[0].avatarUrl, 'https://example.invalid/avatar.png');
  assert.equal(stats.recentComments[0].text, 'Xin chào');
  assert.equal(stats.recentComments[0].viewerKey, 'viewer-1');
  assert.equal(stats.topGifts[0].giftName, 'Hoa hồng');
  const conversation = await request('/lives/' + live.id + '/conversation/viewer-1');
  assert.deepEqual(conversation.messages.map(message => [message.role, message.text]), [['viewer', 'Xin chào']]);
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
  await db.giftEvent.createMany({ data: [
    { liveId: live.id, dedupKey: randomUUID(), viewerKey: 'viewer-1', giftName: 'Quà khác', quantity: 1, estimatedCoins: 10, source: 'tiktok', occurredAt: new Date() },
    { liveId: live.id, dedupKey: randomUUID(), viewerKey: 'viewer-2', giftName: 'Quà lớn', quantity: 2, estimatedCoins: 100, source: 'tiktok', occurredAt: new Date() },
    { liveId: live.id, dedupKey: randomUUID(), viewerKey: 'viewer-3', giftName: 'Quà chưa rõ xu', quantity: 5, source: 'tiktok', occurredAt: new Date() },
    { liveId: live.id, dedupKey: randomUUID(), viewerKey: 'viewer-4', giftName: 'Quà cùng điểm', quantity: 5, source: 'tiktok', occurredAt: new Date() },
  ] });
  const ranked = await request('/lives/' + live.id + '/analytics');
  assert.deepEqual(ranked.leaderboard.map(row => row.viewerKey), ['viewer-2', 'viewer-1', 'viewer-3', 'viewer-4']);
  assert.deepEqual(ranked.leaderboard.map(row => row.points), [100, 13, 5, 5]);
  assert.deepEqual(ranked.leaderboard.map(row => row.gifts), [2, 4, 5, 5]);
  await db.liveChannel.update({ where: { id: live.id }, data: { status: 'connected' } });
  const overlay = new URL((await request('/lives/' + live.id + '/overlay-token/rotate', 'POST', {})).url);
  const snapshot = await request('/overlay/' + live.id + '/snapshot?token=' + encodeURIComponent(overlay.searchParams.get('token')));
  assert.deepEqual(snapshot.leaderboard.map(row => [row.viewerKey, row.points]), [
    ['viewer-2', 100], ['viewer-1', 13], ['viewer-3', 5], ['viewer-4', 5],
  ]);
  socket = io(process.env.SMOKE_SOCKET_URL ?? 'http://api:3001', { auth: { liveId: live.id, overlayToken: overlay.searchParams.get('token') }, transports: ['websocket'] });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Socket connect timeout')), 5000); socket.once('connect', () => { clearTimeout(timer); resolve(); }); socket.once('connect_error', reject); });
  const giftAnimations = [];
  socket.on('live.event', event => { if (event.eventType === 'gift.received') giftAnimations.push(event.eventId); });
  const resetAt = new Date(Date.now() + 1000);
  await db.liveChannel.update({ where: { id: live.id }, data: { lastConnectedAt: resetAt } });
  const reset = await request('/lives/' + live.id + '/analytics');
  assert.deepEqual(reset.leaderboard, []);
  assert.equal(reset.gifts, 0);
  const sendCombo = async (comboId, quantity) => {
    const event = { eventId: randomUUID(), liveId: live.id, sessionId: reconnected.id, source: 'tiktok', eventType: 'gift.received', timestamp: new Date(resetAt.getTime() + 1000).toISOString(), user: { id: 'viewer-1', nickname: 'viewer-1' }, payload: { giftId: 'rose', giftName: 'Hoa hồng', comboId, quantity, estimatedCoins: 1, repeatEnd: quantity >= 30 } };
    await redis.publish('live.events', JSON.stringify(event));
    for (let attempt = 0; attempt < 40; attempt++) {
      const row = await db.giftEvent.findFirst({ where: { liveId: live.id, dedupKey: `${live.id}:${reconnected.id}:viewer-1:rose:${comboId}` } });
      if (row?.quantity === quantity) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Combo update was not stored');
  };
  await sendCombo('combo-a', 20);
  await sendCombo('combo-a', 30);
  let current = await request('/lives/' + live.id + '/analytics');
  assert.equal(current.leaderboard[0].points, 30);
  assert.equal(current.gifts, 30);
  await sendCombo('combo-b', 20);
  current = await request('/lives/' + live.id + '/analytics');
  assert.equal(current.leaderboard[0].points, 50);
  assert.equal(current.gifts, 50);
  const beforeDuplicate = giftAnimations.length;
  const duplicate = { eventId: randomUUID(), liveId: live.id, sessionId: reconnected.id, source: 'tiktok', eventType: 'gift.received', timestamp: new Date(resetAt.getTime() + 1000).toISOString(), user: { id: 'viewer-1', nickname: 'viewer-1' }, payload: { giftId: 'rose', giftName: 'Hoa hồng', comboId: 'combo-a', quantity: 30, estimatedCoins: 1, repeatEnd: true } };
  await redis.publish('live.events', JSON.stringify(duplicate));
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await db.liveEvent.findUnique({ where: { eventId: duplicate.eventId } })) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(giftAnimations.length, beforeDuplicate, 'Duplicate final gift replayed its animation');
  console.log('Stats smoke passed: room totals, reconnect, merit ranking, LIVE reset and combo 20→30 + 20 = 50 CĐ');
} finally {
  socket?.disconnect();
  await db.liveChannel.delete({ where: { id: live.id } });
  await db.$disconnect();
  await redis.quit();
}
