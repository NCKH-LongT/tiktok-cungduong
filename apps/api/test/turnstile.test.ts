import assert from 'node:assert/strict';
import { test } from 'node:test';
import { turnstileKeys } from '../src/turnstile.js';

test('local Turnstile testing requires an explicit flag and localhost', () => {
  const env = { PUBLIC_APP_URL: 'http://localhost:8090/', LOCAL_TURNSTILE_TEST: 'true', TURNSTILE_SITE_KEY: 'production-site', TURNSTILE_SECRET_KEY: 'production-secret' };
  assert.equal(turnstileKeys(env).siteKey, '1x00000000000000000000AA');
  assert.equal(turnstileKeys({ ...env, PUBLIC_APP_URL: 'https://farm-cong-duc.nongdanonline.cc' }).secretKey, 'production-secret');
  assert.equal(turnstileKeys({ ...env, LOCAL_TURNSTILE_TEST: 'false' }).siteKey, 'production-site');
});
