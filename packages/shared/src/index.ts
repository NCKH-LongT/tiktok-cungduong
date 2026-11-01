import { z } from 'zod';

export const eventTypes = ['room.connected','room.disconnected','viewer.join','viewer.leave','chat.comment','viewer.like','viewer.share','viewer.follow','gift.received','room.stats'] as const;
export const liveEventSchema = z.object({
  eventId: z.string().min(1).max(200),
  source: z.enum(['tiktok', 'simulator']),
  liveId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  eventType: z.enum(eventTypes),
  timestamp: z.iso.datetime(),
  user: z.object({ id: z.string().max(200).optional(), uniqueId: z.string().max(200).optional(), nickname: z.string().max(100).optional(), avatarUrl: z.url().optional() }).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type LiveEvent = z.infer<typeof liveEventSchema>;

export function hasLiveAccess(role: string, accessUntil: Date | string | null | undefined, now = new Date()): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN' || Boolean(accessUntil && new Date(accessUntil).getTime() > now.getTime());
}

export function giftDedupKey(event: LiveEvent): string {
  const p = event.payload;
  const combo = typeof p.comboId === 'string' ? p.comboId : '';
  const gift = typeof p.giftId === 'string' ? p.giftId : '';
  return combo ? `${event.liveId}:${event.sessionId ?? 'legacy'}:${event.user?.id ?? event.user?.uniqueId}:${gift}:${combo}` : event.eventId;
}

export function shouldAnswerComment(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const text = value.normalize('NFKC').trim().toLowerCase();
  if (!text || text.length > 300) return false;
  if ((text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) < 2) return false;
  if (/(https?:\/\/|www\.|api.?key|mật khẩu|password|system.?prompt|ignore previous|bỏ qua hướng dẫn|tiết lộ bí mật)/i.test(text)) return false;
  if (/(.)\1{12,}/u.test(text)) return false;
  return /[\p{L}\p{N}]/u.test(text);
}
