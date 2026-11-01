export type PriorityIntent = 'BUDDHA_CHANT' | 'PRAYER_PEACE' | 'PRAYER_HEALTH' | 'PRAYER_FAMILY' | 'PRAYER_STUDY' | 'PRAYER_WORK' | 'QUESTION' | 'OTHER';

export function normalizeVietnamese(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function classifyComment(value: unknown): PriorityIntent {
  if (typeof value !== 'string' || !value.trim()) return 'OTHER';
  const normalized = normalizeVietnamese(value);
  const folded = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const words = folded.replace(/[^a-z0-9]+/g, ' ').trim();
  if (/^(?:nammo)?adidaphat$/.test(normalized) ||
      /^(?:nam\s*mo\s*)?a\s*di\s*da\s*phat(?:\s|$)/.test(words)) return 'BUDDHA_CHANT';
  if (/(?:^|\s)(?:cau|mong|chuc)(?:\s|$)/.test(words)) {
    if (/\b(?:cha me|gia dinh|nguoi than|ca nha|bo me)\b/.test(words)) return 'PRAYER_FAMILY';
    if (/\b(?:suc khoe|manh khoe|khoe manh)\b/.test(words)) return 'PRAYER_HEALTH';
    if (/\b(?:thi|hoc|do dat)\b/.test(words)) return 'PRAYER_STUDY';
    if (/\b(?:cong viec|lam an)\b/.test(words)) return 'PRAYER_WORK';
    return 'PRAYER_PEACE';
  }
  return /[?？]$/.test(value.trim()) ? 'QUESTION' : 'OTHER';
}

export function giftQuantityDelta(previous: number, incoming: number): number {
  if (!Number.isSafeInteger(incoming) || incoming < 1) return 0;
  return Math.max(0, incoming - Math.max(0, previous));
}

export function buildBatchSpeech(type: 'gift' | 'chant' | 'prayer', names: string[], giftName = '', participantCount = 0): string {
  const unique = [...new Set(names.map(name => name.trim().slice(0, 60)).filter(Boolean))];
  const shown = unique.slice(0, 5).join(', ');
  const count = Math.max(unique.length, participantCount);
  const remaining = count - Math.min(unique.length, 5);
  const rest = remaining > 0 ? ` và ${remaining} phật tử khác` : '';
  const audience = count === 1 ? `phật tử ${shown}` : shown ? `các phật tử ${shown}${rest}` : 'quý phật tử';
  if (type === 'gift') return `Nam mô A Di Đà Phật. Xin tri ân ${audience} đã gửi tặng ${giftName.slice(0, 60) || 'quà'}. ${count === 1 ? `Kính chúc ${shown} thân tâm an lạc.` : 'Kính chúc quý vị thân tâm an lạc.'}`;
  if (type === 'chant') return `Nam mô A Di Đà Phật. Xin cảm niệm ${audience} đã cùng niệm Phật. Kính chúc quý vị bình an.`;
  return `Nam mô A Di Đà Phật. Xin gửi lời cầu chúc bình an và sức khỏe đến ${audience} và gia đình.`;
}
