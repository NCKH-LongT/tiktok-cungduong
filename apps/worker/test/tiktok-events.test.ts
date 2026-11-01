import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTikTokUser, normalizeTikTokComment, normalizeTikTokGift, asNumber } from '../src/tiktok-events';

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

test('ordinary gifts complete immediately; streak gifts wait for repeatEnd', () => {
  const ordinary = normalizeTikTokGift({ giftDetails: { giftType: 0, giftName: 'Hoa hồng', diamondCount: 1 }, repeatCount: 1, repeatEnd: false });
  assert.equal(ordinary.repeatEnd, true);
  assert.equal(ordinary.giftName, 'Hoa hồng');
  assert.equal(ordinary.estimatedCoins, 1);
  assert.equal(normalizeTikTokGift({ giftDetails: { giftType: 1 }, repeatEnd: false }).repeatEnd, false);
  assert.equal(normalizeTikTokGift({ giftDetails: { giftType: 1 }, repeatEnd: true }).repeatEnd, true);
});

test('gift images use the TikTok HTTPS image and reject unsafe URLs', () => {
  const gift = normalizeTikTokGift({ giftDetails: { giftImage: { url: ['https://example.invalid/rose.png'] } } });
  assert.equal(gift.giftImageUrl, 'https://example.invalid/rose.png');
  assert.equal(normalizeTikTokGift({ giftDetails: { giftImage: { url: ['javascript:alert(1)'] } } }).giftImageUrl, undefined);
  assert.equal(normalizeTikTokGift({ giftPictureUrl: 'https://example.invalid/legacy.png' }).giftImageUrl, 'https://example.invalid/legacy.png');
});
