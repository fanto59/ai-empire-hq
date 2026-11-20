import type { TilePoint } from "../iso";
import type { NavGrid } from "./grid";

/**
 * A* over the 4-connected isometric grid (characters walk along the iso
 * axes, which reads naturally in 2.5D). Returns the tiles to visit AFTER
 * `start`, ending with `goal`; [] if already there; null if unreachable.
 *
 * Grid sizes are tiny (hundreds of tiles), so a simple binary-heap-free
 * open list is fast enough and keeps the code obvious.
 */
const DIRS: readonly TilePoint[] = [
  { col: 1, row: 0 },
  { col: -1, row: 0 },
  { col: 0, row: 1 },
  { col: 0, row: -1 },
];

export function findPath(grid: NavGrid, start: TilePoint, goal: TilePoint): TilePoint[] | null {
  if (start.col === goal.col && start.row === goal.row) return [];
  if (!grid.isWalkable(goal) || !grid.isWalkable(start)) return null;

  const idx = (t: TilePoint) => t.row * grid.cols + t.col;
  const h = (t: TilePoint) => Math.abs(t.col - goal.col) + Math.abs(t.row - goal.row);

  const gScore = new Map<number, number>([[idx(start), 0]]);
  const cameFrom = new Map<number, TilePoint>();
  const open: { tile: TilePoint; f: number; g: number }[] = [{ tile: start, f: h(start), g: 0 }];
  const closed = new Set<number>();

  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i]!;
      const b = open[best]!;
      // Tie-break on lower h for straighter-looking paths.
      if (a.f < b.f || (a.f === b.f && a.f - a.g < b.f - b.g)) best = i;
    }
    const current = open.splice(best, 1)[0]!;
    const ci = idx(current.tile);
    if (closed.has(ci)) continue;
    closed.add(ci);

    if (current.tile.col === goal.col && current.tile.row === goal.row) {
      const path: TilePoint[] = [];
      let t: TilePoint | undefined = current.tile;
      while (t && !(t.col === start.col && t.row === start.row)) {
        path.unshift(t);
        t = cameFrom.get(idx(t));
      }
      return path;
    }

    for (const d of DIRS) {
      const next = { col: current.tile.col + d.col, row: current.tile.row + d.row };
      if (!grid.canStep(current.tile, next)) continue;
      const ni = idx(next);
      if (closed.has(ni)) continue;
      const g = current.g + 1;
      if (g < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, g);
        cameFrom.set(ni, current.tile);
        open.push({ tile: next, g, f: g + h(next) });
      }
    }
  }
  return null;
}

/** Iso facing for a unit step. */
export function facingForStep(from: TilePoint, to: TilePoint): "ne" | "nw" | "se" | "sw" {
  if (to.col > from.col) return "se";
  if (to.col < from.col) return "nw";
  if (to.row > from.row) return "sw";
  return "ne";
}
