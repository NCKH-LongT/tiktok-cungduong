import assert from 'node:assert/strict';
import { test } from 'node:test';
import { giftDedupKey, liveEventSchema } from '@cd/shared';
const liveId='33e11725-b07c-45ca-ac38-d0a327e5ffed';
const base={eventId:'event-1',source:'simulator',liveId,eventType:'gift.received',timestamp:new Date().toISOString(),user:{id:'viewer-1',nickname:'Minh'},payload:{giftId:'rose',comboId:'combo-1',repeatCount:2}};
test('validates normalized event and rejects unknown type',()=>{assert.equal(liveEventSchema.safeParse(base).success,true);assert.equal(liveEventSchema.safeParse({...base,eventType:'admin.grant'}).success,false)});
test('gift combo dedup key is stable across repeated delivery',()=>{const a=liveEventSchema.parse(base);const b=liveEventSchema.parse({...base,eventId:'event-2'});assert.equal(giftDedupKey(a),giftDedupKey(b))});
test('gift combo updates remain one donation',()=>{const a=liveEventSchema.parse(base);const b=liveEventSchema.parse({...base,payload:{...base.payload,repeatCount:3}});assert.equal(giftDedupKey(a),giftDedupKey(b))});
