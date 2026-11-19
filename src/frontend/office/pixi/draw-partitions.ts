import { Graphics } from "pixi.js";
import type { FloorPlan } from "../floor/types";
import { BIAS, zIndexFor } from "./depth";
import { iso, pts } from "./geometry";
import { PALETTE } from "./palette";

const HEIGHT = 50;

/**
 * Glass partitions, one Graphics per grid-line segment so each segment can
 * be depth-sorted against characters walking on either side.
 */
export function buildPartitionSegments(plan: FloorPlan): Graphics[] {
  const out: Graphics[] = [];
  for (const run of plan.partitions) {
    for (let i = run.from; i < run.to; i++) {
      if (run.gaps.includes(i)) continue;
      const a = run.axis === "row" ? iso(i, run.at) : iso(run.at, i);
      const b = run.axis === "row" ? iso(i + 1, run.at) : iso(run.at, i + 1);
      const up = (p: [number, number], z: number): [number, number] => [p[0], p[1] - z];

      const g = new Graphics({ label: `partition-${run.axis}${run.at}-${i}` });
      const frosted = run.style === "frosted";
      g.poly(pts(a, b, up(b, HEIGHT), up(a, HEIGHT))).fill({ color: PALETTE.glass, alpha: frosted ? 0.42 : 0.2 });
      if (frosted) g.poly(pts(up(a, 18), up(b, 18), up(b, 34), up(a, 34))).fill({ color: 0xffffff, alpha: 0.35 });
      // Rails and mullions.
      g.moveTo(...up(a, HEIGHT)).lineTo(...up(b, HEIGHT));
      g.stroke({ width: 2, color: PALETTE.glassFrame, alpha: 0.9 });
      g.moveTo(...a).lineTo(...b);
      g.stroke({ width: 2.5, color: PALETTE.glassFrame, alpha: 0.75 });
      const leftEnd = i === run.from || run.gaps.includes(i - 1);
      const rightEnd = i === run.to - 1 || run.gaps.includes(i + 1);
      for (const [p, isEnd] of [
        [a, leftEnd],
        [b, rightEnd],
      ] as const) {
        g.moveTo(...p).lineTo(...up(p, HEIGHT));
        g.stroke({ width: isEnd ? 2.5 : 1, color: PALETTE.glassFrame, alpha: isEnd ? 0.9 : 0.35 });
      }
      // Glare stripe.
      const m0: [number, number] = [a[0] + (b[0] - a[0]) * 0.25, a[1] + (b[1] - a[1]) * 0.25];
      const m1: [number, number] = [a[0] + (b[0] - a[0]) * 0.45, a[1] + (b[1] - a[1]) * 0.45];
      g.poly(pts(up(m0, 8), up(m1, 8), up(m1, HEIGHT - 10), up(m0, HEIGHT - 4))).fill({ color: 0xffffff, alpha: 0.14 });

      const key = run.at + i + 0.5;
      g.zIndex = zIndexFor(key, BIAS.partition);
      g.eventMode = "none";
      out.push(g);
    }
  }
  return out;
}
