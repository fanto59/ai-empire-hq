import assert from "node:assert/strict";
import { test } from "node:test";
import { buildNavGrid } from "../navigation/grid";
import { findPath } from "../navigation/pathfinding";
import { buildSectorFloor } from "./sector-floor";
import type { FloorPlan } from "./types";

/** Generated sector floors must satisfy the same rules as the hand-made Executive Floor. */
const biz = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, slug: `biz-${i}`, name: `Business ${i}` }));

function assertValid(plan: FloorPlan) {
  const tiles = new Map<string, string>();
  for (const room of plan.rooms) {
    for (let c = room.area.col; c < room.area.col + room.area.cols; c++) {
      for (let r = room.area.row; r < room.area.row + room.area.rows; r++) {
        const k = `${c},${r}`;
        assert.ok(!tiles.has(k), `tile ${k} in ${room.id} and ${tiles.get(k)}`);
        tiles.set(k, room.id);
      }
    }
  }
  assert.equal(tiles.size, plan.grid.cols * plan.grid.rows, "rooms tile the floor exactly once");
  const used = new Map<string, string>();
  for (const item of plan.furniture) {
    const { col, row, cols, rows } = item.area;
    assert.ok(col >= 0 && row >= 0 && col + cols <= plan.grid.cols && row + rows <= plan.grid.rows, item.id);
    for (let c = col; c < col + cols; c++) for (let r = row; r < row + rows; r++) {
      assert.ok(!used.has(`${c},${r}`), `${item.id} overlaps ${used.get(`${c},${r}`)}`);
      used.set(`${c},${r}`, item.id);
    }
  }
  for (const wp of plan.waypoints.filter((w) => w.posture === "sit")) {
    const chair = plan.furniture.find((f) => f.kind === "chair" && f.area.col === wp.tile.col && f.area.row === wp.tile.row);
    assert.equal(chair?.facing, wp.facing, `chair under ${wp.id}`);
  }
  const grid = buildNavGrid(plan);
  const from = plan.waypoints.find((w) => w.id === "corridor.elevator")!;
  for (const w of plan.waypoints) {
    assert.ok(grid.isWalkable(w.tile), `${w.id} walkable`);
    assert.notEqual(findPath(grid, from.tile, w.tile), null, `${w.id} reachable from the elevator`);
  }
  assert.ok(plan.wallFeatures.some((f) => f.kind === "elevator"));
}

test("sector floors are valid for any number of businesses (0 to 9)", () => {
  for (let n = 0; n <= 9; n++) assertValid(buildSectorFloor({ sector: { slug: "s", name: "Sector" }, businesses: biz(n), agents: [] }).plan);
});

test("one room per real business, plus the sector office; nothing invented", () => {
  const floor = buildSectorFloor({
    sector: { slug: "nightlife-entertainment", name: "Nightlife & Entertainment" },
    businesses: [
      { id: "x", slug: "xyz-partys", name: "XYZ PARTYS" },
      { id: "e", slug: "305-events", name: "305 Events" },
      { id: "p", slug: "party-street", name: "Party Street" },
      { id: "s", slug: "713-society", name: "713 Society" },
    ],
    agents: [],
  });
  assert.deepEqual(floor.rooms.map((r) => r.label), ["Nightlife & Entertainment office", "XYZ PARTYS", "305 Events", "Party Street", "713 Society"]);
  assert.deepEqual(floor.rooms.map((r) => r.businessId), [null, "x", "e", "p", "s"]);
  assert.equal(floor.seats.size, 0, "no agents, no employees");
});

test("agents are seated in their own room: manager in the sector office, business agents with their business", () => {
  const floor = buildSectorFloor({
    sector: { slug: "s", name: "S" },
    businesses: biz(2),
    agents: [
      { id: "m", businessId: null, sectorId: "s1", role: "sector-manager" },
      { id: "a1", businessId: "b0", sectorId: null, role: "specialist" },
      { id: "a0", businessId: "b0", sectorId: null, role: "business-lead" },
      ...["c1", "c2", "c3", "c4", "c5"].map((id) => ({ id, businessId: "b1", sectorId: null, role: "specialist" })),
      { id: "gone", businessId: "archived-biz", sectorId: null, role: "specialist" },
    ],
  });
  assert.equal(floor.seats.get("m")?.roomId, "sector-office");
  assert.equal(floor.seats.get("a0")?.desk, "biz-biz-0.desk0", "the business lead takes the first desk");
  assert.equal(floor.seats.get("a1")?.roomId, "biz-biz-0");
  assert.deepEqual(floor.overflow.sort(), ["c5", "gone"], "4 desks per room; agents of archived businesses are not seated");
  const desks = [...floor.seats.values()].map((s) => s.desk);
  assert.equal(new Set(desks).size, desks.length, "no shared desks");
});
