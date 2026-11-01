import assert from "node:assert/strict";
import { test } from "node:test";
import { frameAt, movementAnimation } from "../lib/battle-animation";

const metadata = {
  frames: { one: {}, two: {}, dead: {} },
  animations: {
    attack: {
      loop: false,
      frames: [
        { frameId: "one", durationMs: 75 },
        { frameId: "two", durationMs: 125 },
      ],
    },
    die: {
      loop: false,
      holdLastFrame: true,
      frames: [
        { frameId: "one", durationMs: 120 },
        { frameId: "dead", durationMs: 200 },
      ],
    },
  },
};

test("uses independent frame durations and exact boundaries", () => {
  assert.equal(frameAt(metadata, "attack", 74, false, 1), "one");
  assert.equal(frameAt(metadata, "attack", 75, false, 1), "two");
  assert.equal(frameAt(metadata, "attack", 199, false, 1), "two");
});

test("loops and applies speed without changing frame order", () => {
  assert.equal(frameAt(metadata, "attack", 200, true, 1), "one");
  assert.equal(frameAt(metadata, "attack", 40, true, 2), "two");
});

test("holds the final die frame and selects movement direction", () => {
  assert.equal(frameAt(metadata, "die", 10000, false, 1), "dead");
  assert.equal(movementAnimation(0, { move: {} }), "move");
  assert.equal(movementAnimation(2100, { move: {} }), "move");
  assert.equal(movementAnimation(0), "walk_right");
  assert.equal(movementAnimation(2100), "walk_left");
});
