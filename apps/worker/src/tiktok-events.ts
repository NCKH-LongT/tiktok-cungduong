import { randomUUID } from 'node:crypto';

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function asNumber(value: unknown): number | undefined {
  const result = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isFinite(result) ? result : undefined;
}

function identity(value: unknown): string | undefined {
  const text = asString(value) ?? (typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined);
  return text && text !== '0' ? text : undefined;
}

export function normalizeTikTokUser(raw: Record<string, unknown>) {
  const nested = asRecord(raw.user);
  const uniqueId = identity(nested.displayId) ?? identity(nested.uniqueId) ?? identity(raw.uniqueId);
  const id = identity(nested.id) ?? identity(raw.userId) ?? uniqueId;
  if (!id) return undefined;
  const avatar = [nested.avatarLarge, nested.avatarMedium, nested.avatarThumb]
    .map(image => asRecord(image).urlList)
    .flatMap(urls => Array.isArray(urls) ? urls : []);
  const avatarUrl = [...avatar, raw.profilePictureUrl].find(value => {
    if (typeof value !== 'string') return false;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }) as string | undefined;
  return {
    id,
    uniqueId,
    nickname: asString(nested.nickname) ?? asString(raw.nickname) ?? uniqueId ?? 'Người xem',
    avatarUrl,
  };
}

export function normalizeTikTokComment(raw: Record<string, unknown>): string {
  return asString(raw.content) ?? asString(raw.comment) ?? '';
}

export function normalizeTikTokGift(raw: Record<string, unknown>) {
  const details = asRecord(raw.giftDetails);
  const legacy = asRecord(raw.gift);
  const extended = asRecord(raw.extendedGiftInfo);
  const imageUrls = [
    ...[asRecord(details.giftImage).url, asRecord(legacy.giftImage).url, asRecord(extended.image).url]
      .flatMap(value => Array.isArray(value) ? value : []),
    raw.giftPictureUrl, extended.imageUrl,
  ];
  const giftImageUrl = imageUrls.find(value => {
    if (typeof value !== 'string') return false;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }) as string | undefined;
  const giftType = asNumber(details.giftType) ?? asNumber(legacy.giftType) ?? asNumber(raw.giftType);
  return {
    giftId: String(raw.giftId ?? ''),
    giftName: asString(details.giftName) ?? asString(legacy.name) ?? asString(raw.giftName) ?? 'Gift',
    giftImageUrl,
    quantity: asNumber(raw.repeatCount) ?? 1,
    comboId: asString(raw.groupId) ?? asString(raw.comboId),
    repeatCount: asNumber(raw.repeatCount),
    repeatEnd: giftType !== 1 || raw.repeatEnd === 1 || raw.repeatEnd === true,
    estimatedCoins: asNumber(details.diamondCount) ?? asNumber(legacy.diamondCount) ?? asNumber(extended.diamondCount) ?? asNumber(raw.diamondCount),
  };
}
// TikTok sometimes omits a combo/group id. Track the cumulative streak per
// viewer and gift so repeatCount 1..30 is stored as 30 items, not 465.
export function createGiftNormalizer() {
  const streaks = new Map<string, { id: string; count: number; at: number; ended: boolean }>();
  return (raw: Record<string, unknown>) => {
    const gift = normalizeTikTokGift(raw);
    const giftType = asNumber(asRecord(raw.giftDetails).giftType) ?? asNumber(asRecord(raw.gift).giftType) ?? asNumber(raw.giftType);
    if (gift.comboId || (giftType !== 1 && gift.repeatEnd && gift.quantity === 1)) return gift;
    const viewer = normalizeTikTokUser(raw)?.id;
    if (!viewer) return gift;
    const key = `${viewer}:${gift.giftId}`;
    const now = Date.now();
    const previous = streaks.get(key);
    const continuation = previous && !previous.ended && now - previous.at < 15000 &&
      (gift.quantity > previous.count || (gift.repeatEnd && gift.quantity === previous.count));
    const id = continuation ? previous.id : randomUUID();
    streaks.set(key, { id, count: gift.quantity, at: now, ended: gift.repeatEnd });
    if (streaks.size > 500) for (const [staleKey, value] of streaks) if (now - value.at > 15000) streaks.delete(staleKey);
    return { ...gift, comboId: id };
  };
}
