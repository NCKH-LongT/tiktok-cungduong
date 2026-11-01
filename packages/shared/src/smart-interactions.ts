export type PriorityIntent = 'BUDDHA_CHANT' | 'PRAYER_PEACE' | 'PRAYER_HEALTH' | 'PRAYER_FAMILY' | 'PRAYER_STUDY' | 'PRAYER_WORK' | 'QUESTION' | 'OTHER';

export function normalizeVietnamese(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function classifyComment(value: unknown): PriorityIntent {
  if (typeof value !== 'string' || !value.trim()) return 'OTHER';
  const normalized = normalizeVietnamese(value);
  if (/(?:^|nammo)adidaphat(?:$|[a-z])/.test(normalized) && normalized.length < 120) return 'BUDDHA_CHANT';
  if (/\b(cau|mong|chuc)\b/i.test(value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd'))) {
    if (/(cha me|gia dinh|nguoi than|ca nha|bo me)/.test(value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))) return 'PRAYER_FAMILY';
    if (/(suc khoe|manh khoe|khoe manh)/.test(value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))) return 'PRAYER_HEALTH';
    if (/(thi|hoc|do dat)/.test(value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))) return 'PRAYER_STUDY';
    if (/(cong viec|lam an)/.test(value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, ''))) return 'PRAYER_WORK';
    return 'PRAYER_PEACE';
  }
  return /[?？]$/.test(value.trim()) ? 'QUESTION' : 'OTHER';
}

export function giftQuantityDelta(previous: number, incoming: number): number {
  if (!Number.isSafeInteger(incoming) || incoming < 1) return 0;
  return Math.max(0, incoming - Math.max(0, previous));
}

export function buildBatchSpeech(type: 'gift' | 'chant' | 'prayer', names: string[], giftName = ''): string {
  const unique = [...new Set(names.map(name => name.trim().slice(0, 60)).filter(Boolean))];
  const shown = unique.slice(0, 5).join(', ');
  const rest = unique.length > 5 ? ` và ${unique.length - 5} phật tử khác` : '';
  const audience = shown ? `các phật tử ${shown}${rest}` : 'quý phật tử';
  if (type === 'gift') return `Nam mô A Di Đà Phật. Xin tri ân ${audience} đã gửi tặng ${giftName.slice(0, 60) || 'quà'}. Kính chúc quý vị thân tâm an lạc.`;
  if (type === 'chant') return `Nam mô A Di Đà Phật. Xin cảm niệm ${audience} đã cùng niệm Phật. Kính chúc quý vị bình an.`;
  return `Nam mô A Di Đà Phật. Xin gửi lời cầu chúc bình an và sức khỏe đến ${audience} và gia đình.`;
}
