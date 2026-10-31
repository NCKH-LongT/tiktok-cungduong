import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTikTokUser, normalizeTikTokComment, asNumber } from '../src/tiktok-events';

test('member events use the nested TikTok user id when the top-level id is zero', () => {
  const first = normalizeTikTokUser({ userId: '0', user: { id: '7234567890123456789', displayId: 'viewer_one', nickname: 'Một' } });
  const second = normalizeTikTokUser({ userId: '0', user: { id: '8234567890123456789', displayId: 'viewer_two', nickname: 'Hai' } });
  assert.equal(first?.id, '7234567890123456789');
  assert.equal(second?.id, '8234567890123456789');
  assert.notEqual(first?.id, second?.id);
  assert.equal(first?.uniqueId, 'viewer_one');
  assert.equal(normalizeTikTokUser({ userId: '0' }), undefined);
});

test('room and like counters accept TikTok numeric strings', () => {
  assert.equal(asNumber('5820'), 5820);
  assert.equal(asNumber(12), 12);
  assert.equal(asNumber(''), undefined);
});

test('chat content is read from the TikTok protobuf content field', () => {
  assert.equal(normalizeTikTokComment({ content: 'Xin chào' }), 'Xin chào');
  assert.equal(normalizeTikTokComment({ comment: 'Legacy' }), 'Legacy');
});

test('avatar uses the TikTok user image and rejects unsafe URLs', () => {
  const user = normalizeTikTokUser({ user: { id: '123', avatarLarge: { urlList: ['https://example.invalid/avatar.png'] } } });
  assert.equal(user?.avatarUrl, 'https://example.invalid/avatar.png');
  assert.equal(normalizeTikTokUser({ user: { id: '456', avatarThumb: { urlList: ['javascript:alert(1)'] } } })?.avatarUrl, undefined);
});
