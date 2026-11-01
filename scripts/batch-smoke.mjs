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
const adminCookie = cookie;
const suffix = randomUUID().slice(0, 8);
const email = `batch_${suffix}@example.invalid`;
const password = randomUUID() + randomUUID();
const user = await request('/users', 'POST', { email, username: `batch_${suffix}`, password, role: 'ADMIN' });
await request(`/users/${user.id}`, 'PATCH', { maxAiPerDay: 2 });
assert.equal((await request('/users')).find(item => item.id === user.id).aiLimitToday, 2);
await request('/auth/login', 'POST', { login: email, password });
const userCookie = cookie;
const live = await request('/lives', 'POST', { uniqueId: `batch_${suffix}`, title: 'Batch smoke' });
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
  assert.equal((await request(`/lives/${live.id}/ai-usage`)).used, 2);
  await wait(5100 - Date.now() % 5000);
  await send('chat.comment', { id: 'viewer-c', nickname: 'Chi' }, { text: 'Tôi đang cần lời khuyên' });
  await wait(5500);
  assert.equal(await db.aIInteraction.count({ where: { liveId: live.id } }), 2);
  assert.equal((await request(`/lives/${live.id}/ai-usage`)).used, 2);
  cookie = adminCookie;
  await request(`/users/${user.id}`, 'PATCH', { maxAiPerDay: 3 });
  cookie = userCookie;
  await wait(5100 - Date.now() % 5000);
  const afterIncrease = await send('chat.comment', { id: 'viewer-d', nickname: 'Dung' }, { text: 'Làm sao để bình tâm?' });
  await waitFor(() => db.aIInteraction.findFirst({ where: { liveId: live.id, sourceEventId: afterIncrease.eventId } }), 'Raised AI quota');
  assert.equal((await request(`/lives/${live.id}/ai-usage`)).used, 3);
  cookie = adminCookie;
  await request(`/users/${user.id}`, 'PATCH', { maxAiPerDay: 4 });
  cookie = userCookie;
  await wait(6100 - Date.now() % 6000);
  await send('gift.received', { id: 'viewer-a', nickname: 'An' }, { giftId: 'lotus', giftName: 'Hoa sen', quantity: 1, estimatedCoins: 1, repeatEnd: true });
  const singleGift = await waitFor(() => db.aIInteraction.findFirst({ where: { liveId: live.id, prompt: 'Batch gift, participants: 1' } }), 'Single-donor thank-you');
  assert.match(singleGift.answer, /tri ân phật tử An/);
  assert.doesNotMatch(singleGift.answer, /các phật tử/);
  console.log('Batch smoke passed: one/many donor wording, comment batching, and per-user AI quota at 2→3→4');
} finally {
  await db.liveChannel.delete({ where: { id: live.id } });
  cookie = adminCookie;
  await request(`/users/${user.id}`, 'DELETE').catch(() => {});
  await db.$disconnect();
  await redis.quit();
}
