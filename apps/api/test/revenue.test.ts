import assert from 'node:assert/strict';
import { test } from 'node:test';
import { revenueWindow } from '../src/revenue.js';

test('defaults to 30 Vietnam calendar days and includes the final day', () => {
  const range = revenueWindow(undefined, undefined, new Date('2026-11-01T01:00:00Z'));
  assert.deepEqual({ from: range.from, to: range.to }, { from: '2026-10-03', to: '2026-11-01' });
  assert.equal(range.start.toISOString(), '2026-10-02T17:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-11-01T17:00:00.000Z');
});

test('rejects invalid, reversed, and oversized revenue ranges', () => {
  assert.throws(() => revenueWindow('2026-02-30', '2026-03-01'));
  assert.throws(() => revenueWindow('2026-11-02', '2026-11-01'));
  assert.throws(() => revenueWindow('2025-01-01', '2026-11-01'));
});
