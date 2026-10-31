import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liveEventSchema } from '@cd/shared';
test('TikTok source requires a UUID LIVE id and UTC timestamp',()=>{const input={eventId:'1',source:'tiktok',liveId:'not-a-uuid',eventType:'viewer.join',timestamp:'yesterday',payload:{}};assert.equal(liveEventSchema.safeParse(input).success,false)});
