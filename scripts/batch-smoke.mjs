import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const base = process.env.SMOKE_BASE_URL ?? 'http://web:3000';
const db = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
let cookie = '';
async function request(path, method = 'GET', body) {
  const response = await fetch(base + '/api' + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const session = response.headers.get('set-cookie');
  if (session) cookie = session.split(';')[0];
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, label) {
  for (let index = 0; index < 120; index++) {
    const value = await predicate();
    if (value) return value;
    await wait(100);
  }
  throw new Error(`${label} timed out`);
}
await request('/auth/login', 'POST', { login: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
const live = await request('/lives', 'POST', { uniqueId: `batch_${randomUUID().slice(0, 8)}`, title: 'Batch smoke' });
try {
  await request(`/lives/${live.id}/ai-config`, 'PUT', { enabled: true, maxPerMinute: 60 });
  await request(`/lives/${live.id}/audio-config`, 'PUT', { ttsEnabled: false });
  const session = await db.liveSession.create({ data: { liveId: live.id, roomId: `batch-room-${randomUUID()}` } });
  await db.liveChannel.update({ where: { id: live.id }, data: { status: 'connected', lastConnectedAt: new Date() } });
  await db.liveEvent.create({ data: { eventId: randomUUID(), liveId: live.id, sessionId: session.id, source: 'tiktok', type: 'room.connected', occurredAt: new Date(), payload: { eventType: 'room.connected', payload: {} } } });
  const send = async (eventType, user, payload) => {
    const event = { eventId: randomUUID(), liveId: live.id, sessionId: session.id, source: 'tiktok', eventType, timestamp: new Date().toISOString(), user, payload };
    await redis.publish('live.events', JSON.stringify(event));
    return event;
  };
  await wait(5100 - Date.now() % 5000);
  await send('chat.comment', { id: 'viewer-a', nickname: 'An' }, { text: 'Hôm nay tôi buồn' });
  await wait(25);
  const second = await send('chat.comment', { id: 'viewer-a', nickname: 'An' }, { text: 'Có cách nào bình an hơn?' });
  const commentReply = await waitFor(() => db.aIInteraction.findFirst({ where: { liveId: live.id, sourceEventId: second.eventId } }), 'Comment batch');
  assert.ok(commentReply.answer?.includes('An'));
  assert.equal(await db.aIInteraction.count({ where: { liveId: live.id } }), 1);
  await wait(6100 - Date.now() % 6000);
  await send('gift.received', { id: 'viewer-a', nickname: 'An' }, { giftId: 'rose', giftName: 'Hoa hồng', quantity: 1, estimatedCoins: 1, repeatEnd: true });
  await send('gift.received', { id: 'viewer-b', nickname: 'Bình' }, { giftId: 'rose', giftName: 'Hoa hồng', quantity: 1, estimatedCoins: 1, repeatEnd: true });
  const giftReply = await waitFor(() => db.aIInteraction.findFirst({ where: { liveId: live.id, prompt: { startsWith: 'Batch gift' } } }), 'Gift batch');
  assert.ok(giftReply.answer?.includes('An') && giftReply.answer.includes('Bình'));
  assert.equal(await db.aIInteraction.count({ where: { liveId: live.id } }), 2);
  console.log('Batch smoke passed: two comments → one AI reply; two donors of one gift → one named thank-you');
} finally {
  await db.liveChannel.delete({ where: { id: live.id } });
  await db.$disconnect();
  await redis.quit();
}
