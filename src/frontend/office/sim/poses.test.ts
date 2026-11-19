import assert from "node:assert/strict";
import { test } from "node:test";
import { computePose, createPose } from "./poses";
import { CHARACTER_STATES } from "./types";

test("every state yields finite joint values in both postures", () => {
  const pose = createPose();
  for (const state of CHARACTER_STATES) {
    for (const posture of ["stand", "sit"] as const) {
      for (let t = 0; t < 5; t += 0.37) {
        computePose(pose, state, posture, t, t, 0.3);
        for (const [k, v] of Object.entries(pose)) assert.ok(Number.isFinite(v), `${state}/${posture} ${k}=${v}`);
      }
    }
  }
});

test("walking swings legs in opposition", () => {
  const pose = createPose();
  computePose(pose, "walking", "stand", 0.1, 0.1, 0);
  assert.ok(pose.legFront * pose.legBack < 0);
});

test("seated states lower the body; walking never sits", () => {
  const pose = createPose();
  computePose(pose, "working", "sit", 1, 1, 0);
  assert.ok(pose.bodyY > 3);
  computePose(pose, "walking", "sit", 1, 1, 0);
  assert.ok(pose.bodyY <= 0);
});

test("reduced motion damps animation amplitude", () => {
  const full = createPose();
  const reduced = createPose();
  computePose(full, "walking", "stand", 0.1, 0.1, 0, 1);
  computePose(reduced, "walking", "stand", 0.1, 0.1, 0, 0.2);
  assert.ok(Math.abs(reduced.legFront) < Math.abs(full.legFront));
});
