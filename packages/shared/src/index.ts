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

export function giftDedupKey(event: LiveEvent): string {
  const p = event.payload;
  const combo = typeof p.comboId === 'string' ? p.comboId : '';
  const gift = typeof p.giftId === 'string' ? p.giftId : '';
  return combo ? `${event.liveId}:${event.user?.id ?? event.user?.uniqueId}:${gift}:${combo}` : event.eventId;
}
