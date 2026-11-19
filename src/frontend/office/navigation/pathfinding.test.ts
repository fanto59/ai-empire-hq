import assert from "node:assert/strict";
import { test } from "node:test";
import type { FloorPlan } from "../floor/types";
import { buildNavGrid } from "./grid";
import { facingForStep, findPath } from "./pathfinding";

const base: FloorPlan = {
  id: "t",
  name: "Test",
  grid: { cols: 5, rows: 5 },
  rooms: [],
  partitions: [],
  furniture: [],
  wallFeatures: [],
  waypoints: [],
};

test("finds a shortest 4-connected path", () => {
  const path = findPath(buildNavGrid(base), { col: 0, row: 0 }, { col: 2, row: 2 });
  assert.ok(path);
  assert.equal(path.length, 4);
  assert.deepEqual(path.at(-1), { col: 2, row: 2 });
});

test("returns [] when already at the goal", () => {
  assert.deepEqual(findPath(buildNavGrid(base), { col: 1, row: 1 }, { col: 1, row: 1 }), []);
});

test("routes around furniture but walks through chairs", () => {
  const plan: FloorPlan = {
    ...base,
    furniture: [
      { id: "desk", kind: "desk", area: { col: 1, row: 0, cols: 1, rows: 4 }, facing: "sw" },
      { id: "chair", kind: "chair", area: { col: 1, row: 4, cols: 1, rows: 1 }, facing: "sw" },
    ],
  };
  const grid = buildNavGrid(plan);
  assert.equal(grid.isWalkable({ col: 1, row: 2 }), false);
  assert.equal(grid.isWalkable({ col: 1, row: 4 }), true);
  const path = findPath(grid, { col: 0, row: 0 }, { col: 2, row: 0 });
  assert.ok(path);
  assert.ok(path.some((t) => t.col === 1 && t.row === 4), "must pass through the gap at row 4");
});

test("partitions block crossings except at door gaps", () => {
  const plan: FloorPlan = {
    ...base,
    partitions: [{ axis: "row", at: 2, from: 0, to: 5, gaps: [4], style: "clear" }],
  };
  const grid = buildNavGrid(plan);
  assert.equal(grid.canStep({ col: 0, row: 1 }, { col: 0, row: 2 }), false);
  assert.equal(grid.canStep({ col: 4, row: 1 }, { col: 4, row: 2 }), true);
  const path = findPath(grid, { col: 0, row: 1 }, { col: 0, row: 2 });
  assert.ok(path);
  assert.ok(path.some((t) => t.col === 4 && t.row === 2), "must use the doorway");
});

test("returns null when the goal is unreachable", () => {
  const plan: FloorPlan = {
    ...base,
    partitions: [{ axis: "col", at: 3, from: 0, to: 5, gaps: [], style: "clear" }],
  };
  assert.equal(findPath(buildNavGrid(plan), { col: 0, row: 0 }, { col: 4, row: 4 }), null);
});

test("facingForStep maps grid steps to isometric facings", () => {
  const o = { col: 1, row: 1 };
  assert.equal(facingForStep(o, { col: 2, row: 1 }), "se");
  assert.equal(facingForStep(o, { col: 0, row: 1 }), "nw");
  assert.equal(facingForStep(o, { col: 1, row: 2 }), "sw");
  assert.equal(facingForStep(o, { col: 1, row: 0 }), "ne");
});
