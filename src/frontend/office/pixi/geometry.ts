import type { Graphics } from "pixi.js";
import { DEFAULT_ISO } from "../iso";
import { shade } from "./palette";

const HW = DEFAULT_ISO.tileWidth / 2;
const HH = DEFAULT_ISO.tileHeight / 2;

/** Screen point for a (fractional) grid position at height z (px). */
export function iso(col: number, row: number, z = 0): [number, number] {
  return [(col - row) * HW, (col + row) * HH - z];
}

/** Flat polygon list for Graphics.poly(). */
export function pts(...points: [number, number][]): number[] {
  return points.flat();
}

export interface BoxRect {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/**
 * Draws an axis-aligned isometric box: top face plus the two faces visible
 * to the viewer (the +row face on the left, the +col face on the right).
 * Light comes from the upper left, so the right face is the darkest.
 */
export function isoBox(
  g: Graphics,
  r: BoxRect,
  z0: number,
  z1: number,
  color: number,
  options: { top?: number; left?: number; right?: number; alpha?: number } = {},
): void {
  const { col: c, row: w, cols, rows } = r;
  const alpha = options.alpha ?? 1;
  const top = options.top ?? color;
  const left = options.left ?? shade(color, 0.86);
  const right = options.right ?? shade(color, 0.72);

  const tT = iso(c, w, z1);
  const tR = iso(c + cols, w, z1);
  const tB = iso(c + cols, w + rows, z1);
  const tL = iso(c, w + rows, z1);
  const bR = iso(c + cols, w, z0);
  const bB = iso(c + cols, w + rows, z0);
  const bL = iso(c, w + rows, z0);

  if (z1 > z0) {
    g.poly(pts(tL, tB, bB, bL)).fill({ color: left, alpha });
    g.poly(pts(tB, tR, bR, bB)).fill({ color: right, alpha });
  }
  g.poly(pts(tT, tR, tB, tL)).fill({ color: top, alpha });
}

/** Floor-level diamond for a rect (z = 0 unless given). */
export function isoRect(g: Graphics, r: BoxRect, color: number, alpha = 1, z = 0): void {
  g.poly(
    pts(iso(r.col, r.row, z), iso(r.col + r.cols, r.row, z), iso(r.col + r.cols, r.row + r.rows, z), iso(r.col, r.row + r.rows, z)),
  ).fill({ color, alpha });
}

/** Text transform that lays text flat on the floor along the col axis. */
export const FLOOR_TEXT_SKEW = { x: -Math.atan2(HW, HH) , y: Math.atan2(HH, HW) };

/** Text transform that lays text on a wall running along the col axis. */
export const COL_WALL_TEXT_SKEW = { x: 0, y: Math.atan2(HH, HW) };

/** Text transform for a wall running along the row axis. */
export const ROW_WALL_TEXT_SKEW = { x: 0, y: -Math.atan2(HH, HW) };
