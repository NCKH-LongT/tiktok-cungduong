import assert from 'node:assert/strict';
import test from 'node:test';
import { addressViewer, limitReplyWords } from '../src/ai-text';

test('AI speech addresses the viewer by name and preserves the full answer', () => {
  const answer = 'Bạn hãy thở chậm. '.repeat(70).trim();
  const spoken = addressViewer(answer, 'Minh An');
  assert.ok(spoken.includes('Minh An'));
  assert.ok(!/\bbạn\b/iu.test(spoken));
  assert.ok(spoken.endsWith('Minh An hãy thở chậm.'));
  assert.ok(spoken.length > 900);
});

test('Vietnamese AI replies keep the viewer name and stay inside the configured word limit', () => {
  const answer = addressViewer('Bạn hãy thở chậm, lắng nghe 🌸 và giữ lòng bình an. '.repeat(8), 'Minh An');
  const limited = limitReplyWords(answer, 20);
  assert.match(limited, /Minh An/u);
  assert.ok(limited.split(/\s+/u).length <= 20);
  assert.ok(limited.length < answer.length);
  assert.ok(limited.endsWith('…') || /[.!?]$/u.test(limited));
});
