import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const base = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080';
if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD required');
let cookie = '';
async function request(path, method = 'GET', body, expected = 200) {
  const response = await fetch(base + '/api' + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
await request('/auth/login', 'POST', { login: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }, 201);
const adminCookie = cookie;
const suffix = randomUUID().slice(0, 8);
const email = `connection_smoke_${suffix}@example.invalid`;
const password = randomUUID() + randomUUID();
const user = await request('/users', 'POST', { email, username: `connection_smoke_${suffix}`, password }, 201);
await request('/auth/login', 'POST', { login: email, password }, 201);
const live = await request('/lives', 'POST', { uniqueId: `connection_smoke_${suffix}`, title: 'Connection smoke' }, 201);
let socket;
try {
  assert.equal((await request(`/lives/${live.id}/status`)).status, 'stopped');
  await request(`/lives/${live.id}/connect`, 'POST', {}, 409);
  socket = io(process.env.SMOKE_SOCKET_URL ?? base, { auth: { liveId: live.id }, extraHeaders: { Cookie: cookie }, transports: ['websocket'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Controller socket timeout')), 5000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
  });
  const statuses = [];
  socket.on('live.status', change => statuses.push(change.status));
  assert.equal((await request(`/lives/${live.id}/connect`, 'POST', {}, 201)).status, 'connecting');
  assert.equal((await request(`/lives/${live.id}/disconnect`, 'POST', undefined, 201)).status, 'stopped');
  assert.equal((await request(`/lives/${live.id}/status`)).status, 'stopped');
  assert.ok(statuses.includes('connecting') && statuses.includes('stopped'), 'Socket status was not broadcast');
  assert.equal((await request(`/lives/${live.id}/connect`, 'POST', {}, 201)).status, 'connecting');
  socket.disconnect();
  await new Promise(resolve => setTimeout(resolve, 2600));
  assert.equal((await request(`/lives/${live.id}/status`)).status, 'stopped');
  console.log('Connection smoke passed: explicit connect, immediate stop, status broadcast, automatic stop on dashboard exit');
} finally {
  socket?.disconnect();
  await request(`/lives/${live.id}`, 'DELETE');
  cookie = adminCookie;
  await request(`/users/${user.id}`, 'DELETE');
}
