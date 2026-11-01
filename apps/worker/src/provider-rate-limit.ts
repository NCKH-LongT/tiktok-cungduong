import type { Redis } from 'ioredis';

const reserveScript = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local previous = tonumber(redis.call('GET', KEYS[1]) or '0')
local slot = math.max(now, previous)
local interval = tonumber(ARGV[1])
redis.call('SET', KEYS[1], slot + interval, 'PX', math.max(120000, slot - now + interval + 60000))
return slot - now
`;

export function perMinute(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 600 ? parsed : fallback;
}

export async function waitForProviderSlot(redis: Redis, provider: 'gemini' | 'tts', perMinuteLimit: number): Promise<void> {
  const interval = Math.ceil(60000 / perMinuteLimit);
  const delay = Number(await redis.eval(reserveScript, 1, `provider:next:${provider}`, interval));
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
}
