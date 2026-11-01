import assert from 'node:assert/strict';
import { test } from 'node:test';
import { perMinute } from '../src/provider-rate-limit.js';

test('provider limits accept bounded whole-number configuration', () => {
  assert.equal(perMinute('5', 10), 5);
  assert.equal(perMinute('0', 10), 10);
  assert.equal(perMinute('601', 10), 10);
  assert.equal(perMinute('2.5', 10), 10);
  assert.equal(perMinute(undefined, 10), 10);
});
