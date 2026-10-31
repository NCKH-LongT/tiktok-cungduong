import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const base = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080';
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD required');
let cookie = '';
async function request(path, method = 'GET', body) {
  const response = await fetch(base + '/api' + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await response.json();
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return data;
}
await request('/auth/login', 'POST', { login: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
const suffix = randomUUID().slice(0, 8);
const adminCookie = cookie;
const testEmail = `ai_smoke_${suffix}@example.invalid`;
const testPassword = randomUUID() + randomUUID();
const testUser = await request('/users', 'POST', { email: testEmail, username: 'ai_smoke_' + suffix, password: testPassword });
await request('/auth/login', 'POST', { login: testEmail, password: testPassword });
const live = await request('/lives', 'POST', { uniqueId: 'ai_smoke_' + suffix, title: 'AI smoke ' + suffix });
let socket;
try {
  await request(`/lives/${live.id}/ai-config`, 'PUT', { enabled: true, personality: 'Thân thiện', cooldownMs: 1000 });
  const rotated = await request(`/lives/${live.id}/overlay-token/rotate`, 'POST');
  const token = new URL(rotated.url).searchParams.get('token');
  socket = io(process.env.SMOKE_SOCKET_URL ?? base, { auth: { liveId: live.id, overlayToken: token }, transports: ['websocket'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connect timeout')), 5000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
  });
  const speech = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('AI speech timeout')), 30000);
    socket.once('speech.ready', job => { clearTimeout(timer); resolve(job); });
  });
  const simulated = await request(`/lives/${live.id}/simulate`, 'POST', { eventType: 'chat.comment', user: { id: 'ai-smoke-viewer', nickname: 'Minh' }, payload: { text: 'Thiền là gì?' }, ai: true });
  assert.equal(simulated.source, 'simulator');
  const result = await speech;
  assert.equal(result.sourceEventId, simulated.eventId);
  assert.ok(result.text?.length > 0);
  if (process.env.EXPECT_TTS_AUDIO === '1') assert.ok(result.audio?.length > 100, 'Google TTS did not return audio');
  const giftSpeech = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Gift speech timeout')), 30000);
    socket.once('speech.ready', job => { clearTimeout(timer); resolve(job); });
  });
  const gifted = await request(`/lives/${live.id}/simulate`, 'POST', { eventType: 'gift.received', user: { id: 'ai-smoke-viewer', nickname: 'Minh' }, payload: { giftId: 'rose', giftName: 'Hoa hồng', quantity: 1 }, ai: true });
  const giftResult = await giftSpeech;
  assert.equal(giftResult.sourceEventId, gifted.eventId);
  assert.ok(giftResult.text.includes('Hoa hồng'));
  if (process.env.EXPECT_TTS_AUDIO === '1') assert.ok(giftResult.audio?.length > 100, 'Gift reply has no Google TTS audio');
  const history = await request(`/lives/${live.id}/ai-history`);
  assert.ok(history.some(item => item.answer === result.text));
  assert.ok(history.some(item => item.answer === giftResult.text));
  const analytics = await request(`/lives/${live.id}/analytics`);
  assert.equal(Object.keys(analytics.counts).length, 0);
  console.log('AI smoke passed: Gemini comment, gift thanks and Socket.IO; LIVE analytics unchanged');
} finally {
  socket?.disconnect();
  await request(`/lives/${live.id}`, 'DELETE');
  cookie = adminCookie;
  await request(`/users/${testUser.id}`, 'DELETE');
}
