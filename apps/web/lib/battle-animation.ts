export type BattleTimeline = {
  loop: boolean;
  holdLastFrame?: boolean;
  frames: { frameId: string; durationMs: number }[];
};

export function frameAt(
  meta: {
    frames: Record<string, unknown>;
    animations: Record<string, BattleTimeline>;
  },
  animation: string,
  elapsedMs: number,
  loopOverride: boolean,
  speed: number,
): string {
  const timeline = meta.animations[animation];
  if (!timeline?.frames.length) return Object.keys(meta.frames)[0] ?? "";
  const total = timeline.frames.reduce(
    (sum, frame) => sum + frame.durationMs,
    0,
  );
  if (total <= 0) return timeline.frames[0].frameId;
  let cursor = loopOverride
    ? (Math.max(0, elapsedMs) * speed) % total
    : Math.min(Math.max(0, elapsedMs) * speed, total - 1);
  for (const frame of timeline.frames) {
    if (cursor < frame.durationMs) return frame.frameId;
    cursor -= frame.durationMs;
  }
  return timeline.frames.at(-1)?.frameId ?? "";
}

export function movementAnimation(
  elapsedMs: number,
  animations: Record<string, unknown> = {},
): "move" | "walk_left" | "walk_right" {
  if (animations.move) return "move";
  return Math.cos(elapsedMs / 650) >= 0 ? "walk_right" : "walk_left";
}
