import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNavGrid } from "../navigation/grid";
import { findPath } from "../navigation/pathfinding";
import { EXECUTIVE_FLOOR } from "./executive-floor";

const plan = EXECUTIVE_FLOOR;
const grid = buildNavGrid(plan);

test("contains every required executive-floor area", () => {
  const rooms = plan.rooms.map((r) => r.id);
  for (const id of ["chief-office", "pm-office", "research", "conference", "board-lounge"] as const) {
    assert.ok(rooms.includes(id), `missing room ${id}`);
  }
  assert.ok(plan.furniture.some((f) => f.kind === "project-board"), "missing project board");
  assert.ok(plan.wallFeatures.some((f) => f.kind === "elevator"), "missing sector elevator");
  const researchDesks = plan.furniture.filter((f) => f.kind === "desk" && f.id.startsWith("research-desk"));
  assert.ok(researchDesks.length >= 4, "research needs workstations");
});

test("rooms tile the floor exactly once", () => {
  const seen = new Map<string, string>();
  for (const room of plan.rooms) {
    for (let c = room.area.col; c < room.area.col + room.area.cols; c++) {
      for (let r = room.area.row; r < room.area.row + room.area.rows; r++) {
        const k = `${c},${r}`;
        assert.ok(!seen.has(k), `tile ${k} in ${room.id} and ${seen.get(k)}`);
        seen.set(k, room.id);
      }
    }
  }
  assert.equal(seen.size, plan.grid.cols * plan.grid.rows);
});

test("furniture stays in bounds and never overlaps", () => {
  const seen = new Map<string, string>();
  for (const item of plan.furniture) {
    const { col, row, cols, rows } = item.area;
    assert.ok(col >= 0 && row >= 0 && col + cols <= plan.grid.cols && row + rows <= plan.grid.rows, item.id);
    for (let c = col; c < col + cols; c++) {
      for (let r = row; r < row + rows; r++) {
        const k = `${c},${r}`;
        assert.ok(!seen.has(k), `${item.id} overlaps ${seen.get(k)} at ${k}`);
        seen.set(k, item.id);
      }
    }
  }
});

test("seated waypoints sit on chairs whose facing matches", () => {
  for (const wp of plan.waypoints.filter((w) => w.posture === "sit")) {
    const chair = plan.furniture.find(
      (f) => f.kind === "chair" && f.area.col === wp.tile.col && f.area.row === wp.tile.row,
    );
    assert.ok(chair, `no chair under ${wp.id}`);
    assert.equal(chair.facing, wp.facing, `chair facing mismatch at ${wp.id}`);
  }
});

test("every waypoint is reachable from every other waypoint", () => {
  for (const a of plan.waypoints) {
    assert.ok(grid.isWalkable(a.tile), `${a.id} is not walkable`);
    for (const b of plan.waypoints) {
      assert.notEqual(findPath(grid, a.tile, b.tile), null, `${a.id} -> ${b.id} unreachable`);
    }
  }
});
