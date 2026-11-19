import { Container, Graphics, Text } from "pixi.js";
import type { FloorPlan, Room, WallFeature } from "../floor/types";
import { COL_WALL_TEXT_SKEW, FLOOR_TEXT_SKEW, ROW_WALL_TEXT_SKEW, iso, isoRect, pts } from "./geometry";
import { PALETTE, UI_FONT, shade } from "./palette";

/**
 * Static architecture: slab, floors, back walls and wall features. Built
 * once; never redrawn. Everything here sits BEHIND all depth-sorted items.
 */
export const WALL_HEIGHT = 112;
const SLAB = 14;
const CAP = 0.22;

export interface StructureLayer {
  container: Container;
  /** Clickable sector elevator (on the back-left wall). */
  elevator: Graphics;
}

export function buildStructure(plan: FloorPlan): StructureLayer {
  const container = new Container({ label: "structure" });
  const g = new Graphics();
  container.addChild(g);

  drawSlab(g, plan);
  for (const room of plan.rooms) drawRoomFloor(g, room);
  drawBackWalls(g, plan);

  let elevator = new Graphics();
  for (const feature of plan.wallFeatures) {
    if (feature.kind === "elevator") elevator = drawElevator(container, feature);
    else drawWallFeature(g, container, feature);
  }

  for (const room of plan.rooms) container.addChild(floorLabel(room));

  return { container, elevator };
}

function drawSlab(g: Graphics, plan: FloorPlan) {
  const { cols, rows } = plan.grid;
  // Front-left face (along row = rows) and front-right face (along col = cols).
  g.poly(pts(iso(0, rows), iso(cols, rows), iso(cols, rows, -SLAB), iso(0, rows, -SLAB))).fill(PALETTE.slabTop);
  g.poly(pts(iso(cols, 0), iso(cols, rows), iso(cols, rows, -SLAB), iso(cols, 0, -SLAB))).fill(PALETTE.slabSide);
}

function drawRoomFloor(g: Graphics, room: Room) {
  const a = room.area;
  const color = PALETTE.floor[room.finish];
  isoRect(g, a, color);

  const line = shade(color, 0.9);
  if (room.finish === "walnut" || room.finish === "oak") {
    // Planks running along the col axis.
    for (let r = a.row + 1 / 3; r < a.row + a.rows; r += 1 / 3) {
      g.moveTo(...iso(a.col, r)).lineTo(...iso(a.col + a.cols, r));
    }
    g.stroke({ width: 1, color: line, alpha: 0.55 });
  } else if (room.finish === "concrete" || room.finish === "polished") {
    // Large-format tiles (2 x 2 grid cells).
    for (let c = a.col + 2; c < a.col + a.cols; c += 2) g.moveTo(...iso(c, a.row)).lineTo(...iso(c, a.row + a.rows));
    for (let r = a.row + 2; r < a.row + a.rows; r += 2) g.moveTo(...iso(a.col, r)).lineTo(...iso(a.col + a.cols, r));
    g.stroke({ width: 1, color: line, alpha: 0.5 });
  } else {
    // Carpet: a border inlay.
    const inset = 0.35;
    g.poly(
      pts(
        iso(a.col + inset, a.row + inset),
        iso(a.col + a.cols - inset, a.row + inset),
        iso(a.col + a.cols - inset, a.row + a.rows - inset),
        iso(a.col + inset, a.row + a.rows - inset),
      ),
    ).stroke({ width: 1.5, color: shade(color, 1.12), alpha: 0.8 });
  }
}

function drawBackWalls(g: Graphics, plan: FloorPlan) {
  const { cols, rows } = plan.grid;
  const H = WALL_HEIGHT;
  // Back-right wall (row 0).
  g.poly(pts(iso(0, 0), iso(cols, 0), iso(cols, 0, H), iso(0, 0, H))).fill(PALETTE.wallRight);
  g.poly(pts(iso(0, 0), iso(cols, 0), iso(cols, 0, 5), iso(0, 0, 5))).fill(PALETTE.baseboard);
  g.poly(pts(iso(0, 0, H), iso(cols, 0, H), iso(cols, -CAP, H), iso(-CAP, -CAP, H))).fill(PALETTE.wallCap);
  // End cap of the back-right wall.
  g.poly(pts(iso(cols, 0, H), iso(cols, -CAP, H), iso(cols, -CAP), iso(cols, 0))).fill(shade(PALETTE.wallCap, 0.8));

  // Back-left wall (col 0).
  g.poly(pts(iso(0, 0), iso(0, rows), iso(0, rows, H), iso(0, 0, H))).fill(PALETTE.wallLeft);
  g.poly(pts(iso(0, 0), iso(0, rows), iso(0, rows, 5), iso(0, 0, 5))).fill(shade(PALETTE.baseboard, 0.95));
  g.poly(pts(iso(0, 0, H), iso(0, rows, H), iso(-CAP, rows, H), iso(-CAP, -CAP, H))).fill(shade(PALETTE.wallCap, 1.08));
  g.poly(pts(iso(0, rows, H), iso(-CAP, rows, H), iso(-CAP, rows), iso(0, rows))).fill(shade(PALETTE.wallCap, 0.9));

  // Soft ambient-occlusion line where walls meet the floor.
  g.moveTo(...iso(0, rows)).lineTo(...iso(0, 0)).lineTo(...iso(cols, 0));
  g.stroke({ width: 2, color: 0x000000, alpha: 0.08 });
}

/** Point on a back wall: `t` runs along the wall, `z` is height. */
function wallPoint(wall: WallFeature["wall"], t: number, z: number): [number, number] {
  return wall === "back-right" ? iso(t, 0, z) : iso(0, t, z);
}

function wallQuad(wall: WallFeature["wall"], t0: number, t1: number, z0: number, z1: number): number[] {
  return pts(wallPoint(wall, t0, z0), wallPoint(wall, t1, z0), wallPoint(wall, t1, z1), wallPoint(wall, t0, z1));
}

function drawWallFeature(g: Graphics, container: Container, f: WallFeature) {
  const { wall, from, to } = f;
  if (f.kind === "window") {
    const z0 = 26;
    const z1 = 100;
    g.poly(wallQuad(wall, from + 0.1, to - 0.1, z0 - 3, z1 + 3)).fill(PALETTE.windowFrame);
    g.poly(wallQuad(wall, from + 0.16, to - 0.16, z0, z1)).fill(PALETTE.windowSky);
    g.poly(wallQuad(wall, from + 0.16, to - 0.16, (z0 + z1) / 2 + 8, z1)).fill({ color: PALETTE.windowSkyHigh, alpha: 0.7 });
    // Distant skyline silhouette.
    const span = to - from - 0.32;
    const heights = [0.35, 0.55, 0.25, 0.7, 0.45, 0.3, 0.6, 0.4];
    const n = Math.max(3, Math.round(span * 3));
    for (let i = 0; i < n; i++) {
      const t0 = from + 0.16 + (span * i) / n;
      const t1 = t0 + span / n - 0.03;
      const h = heights[i % heights.length]! * (z1 - z0) * 0.55;
      g.poly(wallQuad(wall, t0, t1, z0, z0 + h)).fill({ color: 0x7f9fc0, alpha: 0.55 });
    }
    for (let t = from + 1; t < to; t += 1) g.poly(wallQuad(wall, t - 0.03, t + 0.03, z0, z1)).fill(PALETTE.windowFrame);
    g.poly(wallQuad(wall, from + 0.05, to - 0.05, z0 - 6, z0 - 2)).fill(shade(PALETTE.wallCap, 1.2));
    return;
  }

  if (f.kind === "display") {
    g.poly(wallQuad(wall, from, to, 38, 90)).fill(PALETTE.dark);
    g.poly(wallQuad(wall, from + 0.08, to - 0.08, 42, 86)).fill(0x13233d);
    // Muted chart bars, clearly decorative.
    for (let i = 0; i < 6; i++) {
      const t0 = from + 0.5 + i * 0.45;
      g.poly(wallQuad(wall, t0, t0 + 0.25, 48, 52 + ((i * 7) % 15) + 6)).fill({ color: PALETTE.screenGlow, alpha: 0.35 });
    }
    const label = new Text({
      text: "PROTOTYPE · SIMULATION",
      style: { fontFamily: UI_FONT, fontSize: 9, fontWeight: "700", fill: 0xfbbf24, letterSpacing: 1.5 },
      resolution: 3,
    });
    const [x, y] = wallPoint(wall, from + 0.35, 82);
    label.position.set(x, y);
    label.skew.set(wall === "back-right" ? COL_WALL_TEXT_SKEW.x : ROW_WALL_TEXT_SKEW.x, wall === "back-right" ? COL_WALL_TEXT_SKEW.y : ROW_WALL_TEXT_SKEW.y);
    container.addChild(label);
    return;
  }

  if (f.kind === "bookshelf") {
    g.poly(wallQuad(wall, from + 0.1, to - 0.1, 0, 84)).fill(PALETTE.walnut);
    const books = [0x1e3a5f, 0x7c2d12, 0xd6c7a1, 0x334155, 0x14532d, 0x9a3412, 0xe5e7eb];
    for (let shelf = 0; shelf < 4; shelf++) {
      const z = 6 + shelf * 20;
      g.poly(wallQuad(wall, from + 0.16, to - 0.16, z, z + 17)).fill(shade(PALETTE.walnut, 0.7));
      let t = from + 0.2;
      let i = shelf * 3;
      while (t < to - 0.3) {
        const w = 0.07 + ((i * 13) % 5) * 0.015;
        const h = 11 + ((i * 7) % 5);
        g.poly(wallQuad(wall, t, t + w, z, z + h)).fill(books[i % books.length]!);
        t += w + 0.012;
        i++;
        if (i % 9 === 0) t += 0.18;
      }
    }
  }
}

function drawElevator(container: Container, f: WallFeature): Graphics {
  const { wall, from, to } = f;
  const g = new Graphics({ label: "sector-elevator" });
  g.poly(wallQuad(wall, from + 0.15, to - 0.15, 0, 96)).fill(PALETTE.metal);
  g.poly(wallQuad(wall, from + 0.3, to - 0.3, 0, 80)).fill(0xc9d1db);
  const mid = (from + to) / 2;
  g.poly(wallQuad(wall, mid - 0.015, mid + 0.015, 0, 80)).fill(0x7b8796);
  // Indicator panel above the doors.
  g.poly(wallQuad(wall, from + 0.45, to - 0.45, 84, 93)).fill(PALETTE.screen);
  // Floor marker in front of the doors.
  g.poly(pts(iso(0.05, from + 0.3), iso(0.8, from + 0.3), iso(0.8, to - 0.3), iso(0.05, to - 0.3))).fill({
    color: PALETTE.accent,
    alpha: 0.18,
  });
  g.eventMode = "static";
  g.cursor = "pointer";
  container.addChild(g);

  const label = new Text({
    text: "SECTORS",
    style: { fontFamily: UI_FONT, fontSize: 8, fontWeight: "700", fill: PALETTE.accent, letterSpacing: 1 },
    resolution: 3,
  });
  const [x, y] = wallPoint(wall, mid, 88.5);
  label.anchor.set(0.5, 0.5);
  label.position.set(x, y);
  label.skew.set(ROW_WALL_TEXT_SKEW.x, ROW_WALL_TEXT_SKEW.y);
  label.eventMode = "none";
  container.addChild(label);
  return g;
}

function floorLabel(room: Room): Text {
  const text = new Text({
    text: room.floorLabel.toUpperCase(),
    style: { fontFamily: UI_FONT, fontSize: 10, fontWeight: "700", fill: PALETTE.text, letterSpacing: 1.6 },
    resolution: 3,
  });
  text.alpha = 0.42;
  const { col, row, rows } = room.area;
  const [x, y] = iso(col + 0.35, row + rows - 0.45);
  text.position.set(x, y);
  text.skew.set(FLOOR_TEXT_SKEW.x, FLOOR_TEXT_SKEW.y);
  text.scale.set(1, 0.9);
  text.anchor.set(0, 1);
  text.eventMode = "none";
  return text;
}
