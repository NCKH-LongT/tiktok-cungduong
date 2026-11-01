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
