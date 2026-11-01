import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVietnamese, classifyComment, giftQuantityDelta, buildBatchSpeech } from '@cd/shared/smart-interactions';

test('recognizes Vietnamese chant variants', () => {
  for (const text of ['A Di Đà Phật','adidaphat','ADIDAPHAT','nam mo a di da phat','NamMoADiDaPhat','a-di-da-phat 🙏']) {
    assert.equal(classifyComment(text), 'BUDDHA_CHANT', text);
  }
  assert.equal(normalizeVietnamese('A Di Đà Phật'), 'adidaphat');
});
test('groups prayer topics conservatively', () => {
  assert.equal(classifyComment('Cầu gia đình bình an'), 'PRAYER_FAMILY');
  assert.equal(classifyComment('Mong sức khỏe tốt'), 'PRAYER_HEALTH');
  assert.equal(classifyComment('Cầu thi đỗ'), 'PRAYER_STUDY');
});
test('combo updates count increments, not cumulative sum', () => {
  assert.equal(giftQuantityDelta(0, 1), 1);
  assert.equal(giftQuantityDelta(1, 5), 4);
  assert.equal(giftQuantityDelta(5, 10), 5);
  assert.equal(giftQuantityDelta(10, 10), 0);
  assert.equal(giftQuantityDelta(10, 5), 0);
});
test('batch speech includes each unique donor once', () => {
  const text = buildBatchSpeech('gift', ['An','An','Bình'], 'Hoa hồng');
  assert.equal(text.split('An').length - 1, 1);
  assert.match(text, /Bình/);
});
