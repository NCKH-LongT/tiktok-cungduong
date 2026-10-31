import assert from 'node:assert/strict';
import test from 'node:test';
import { addressViewer } from '../src/ai-text';

test('AI speech addresses the viewer by name and preserves the full answer', () => {
  const answer = 'Bạn hãy thở chậm. '.repeat(70).trim();
  const spoken = addressViewer(answer, 'Minh An');
  assert.ok(spoken.includes('Minh An'));
  assert.ok(!/\bbạn\b/iu.test(spoken));
  assert.ok(spoken.endsWith('Minh An hãy thở chậm.'));
  assert.ok(spoken.length > 900);
});
