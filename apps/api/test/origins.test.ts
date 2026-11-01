import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuredOrigins } from '../src/origins.js';

test('browser Origin matches an app URL configured with a trailing slash', () => {
  const origins = configuredOrigins('http://localhost:8090/');
  assert.deepEqual(origins, ['http://localhost:8090']);
  assert.equal(origins.includes('http://localhost:8090'), true);
  assert.equal(origins.includes('https://untrusted.example'), false);
});

test('normalizes comma-separated CORS origins', () => {
  assert.deepEqual(configuredOrigins('https://example.com/, http://localhost:8090/'), ['https://example.com', 'http://localhost:8090']);
});
