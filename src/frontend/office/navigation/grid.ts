import type { TilePoint } from "../iso";
import type { FloorPlan } from "../floor/types";

/**
 * Walkability graph derived from a floor plan.
 * - Furniture blocks its tiles (chairs do not: they are seat targets).
 * - Partitions block movement ACROSS a grid line, except at door gaps.
 */
export interface NavGrid {
  cols: number;
  rows: number;
  isWalkable(tile: TilePoint): boolean;
  canStep(from: TilePoint, to: TilePoint): boolean;
}

const key = (col: number, row: number) => `${col},${row}`;

export function buildNavGrid(plan: FloorPlan): NavGrid {
  const { cols, rows } = plan.grid;
  const blocked = new Set<string>();
  for (const item of plan.furniture) {
    if (item.kind === "chair") continue;
    for (let c = item.area.col; c < item.area.col + item.area.cols; c++) {
      for (let r = item.area.row; r < item.area.row + item.area.rows; r++) blocked.add(key(c, r));
    }
  }

  // Blocked crossings, keyed by the tile on the low side of the line.
  const blockedRowLines = new Set<string>(); // between (c, at-1) and (c, at)
  const blockedColLines = new Set<string>(); // between (at-1, r) and (at, r)
  for (const run of plan.partitions) {
    for (let i = run.from; i < run.to; i++) {
      if (run.gaps.includes(i)) continue;
      if (run.axis === "row") blockedRowLines.add(key(i, run.at));
      else blockedColLines.add(key(run.at, i));
    }
  }

  const inBounds = ({ col, row }: TilePoint) => col >= 0 && row >= 0 && col < cols && row < rows;
  const isWalkable = (t: TilePoint) => inBounds(t) && !blocked.has(key(t.col, t.row));

  const canStep = (a: TilePoint, b: TilePoint) => {
    if (!isWalkable(a) || !isWalkable(b)) return false;
    const dc = b.col - a.col;
    const dr = b.row - a.row;
    if (Math.abs(dc) + Math.abs(dr) !== 1) return false;
    if (dr !== 0) return !blockedRowLines.has(key(a.col, Math.max(a.row, b.row)));
    return !blockedColLines.has(key(Math.max(a.col, b.col), a.row));
  };

  return { cols, rows, isWalkable, canStep };
}
