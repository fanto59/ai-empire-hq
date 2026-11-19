import { Container, Graphics, Text } from "pixi.js";
import { PROJECT_BOARD_COLUMNS } from "../floor/executive-floor";
import type { FloorPlan, FurnitureItem } from "../floor/types";
import type { SimTask } from "../sim/types";
import { BIAS, tileKey, zIndexFor } from "./depth";
import { COL_WALL_TEXT_SKEW, iso, isoBox, pts, type BoxRect } from "./geometry";
import { PALETTE, UI_FONT, shade } from "./palette";

/**
 * Furniture is built as one display object PER TILE (see depth.ts), each
 * drawn in world coordinates. All of it is static except the project board
 * cards, which are redrawn only when simulated task statuses change.
 */
export interface FurnitureLayer {
  pieces: Container[];
  board: ProjectBoardView | null;
}

export function buildFurniture(plan: FloorPlan, ownerColors: Record<string, number>): FurnitureLayer {
  const pieces: Container[] = [];
  let board: ProjectBoardView | null = null;
  for (const item of plan.furniture) {
    if (item.kind === "project-board") {
      board = new ProjectBoardView(item, ownerColors);
      pieces.push(...board.pieces);
      continue;
    }
    for (let c = item.area.col; c < item.area.col + item.area.cols; c++) {
      for (let r = item.area.row; r < item.area.row + item.area.rows; r++) {
        pieces.push(...drawPiece(item, c, r));
      }
    }
  }
  return { pieces, board };
}

/** Tile rect with `inset` applied only on the item's outer edges. */
function tileRect(item: FurnitureItem, c: number, r: number, inset: number): BoxRect {
  const a = item.area;
  const l = c === a.col ? inset : 0;
  const rt = c === a.col + a.cols - 1 ? inset : 0;
  const t = r === a.row ? inset : 0;
  const b = r === a.row + a.rows - 1 ? inset : 0;
  return { col: c + l, row: r + t, cols: 1 - l - rt, rows: 1 - t - b };
}

function piece(c: number, r: number, bias: number = BIAS.furniture, label = ""): Graphics {
  const g = new Graphics({ label });
  g.zIndex = zIndexFor(tileKey(c, r), bias);
  g.eventMode = "none";
  return g;
}

function drawPiece(item: FurnitureItem, c: number, r: number): Graphics[] {
  const a = item.area;
  const isFirstCol = c === a.col;
  const isLastCol = c === a.col + a.cols - 1;

  switch (item.kind) {
    case "desk": {
      const g = piece(c, r, BIAS.furniture, item.id);
      if (isFirstCol) isoBox(g, { col: c + 0.08, row: r + 0.12, cols: 0.07, rows: 0.76 }, 0, 18, PALETTE.deskSide);
      if (isLastCol) isoBox(g, { col: c + 0.85, row: r + 0.12, cols: 0.07, rows: 0.76 }, 0, 18, PALETTE.deskSide);
      isoBox(g, tileRect(item, c, r, 0.06), 18, 21, PALETTE.deskTop, { left: 0xdfe4ea, right: 0xc9d0d9 });
      // Keyboard on the sitter's side, monitor toward the viewer's side.
      isoBox(g, { col: c + 0.22, row: r + 0.14, cols: 0.4, rows: 0.14 }, 21, 22, 0xe2e8f0);
      isoBox(g, { col: c + 0.66, row: r + 0.42, cols: 0.06, rows: 0.04 }, 21, 25, PALETTE.metal);
      isoBox(g, { col: c + 0.5, row: r + 0.4, cols: 0.4, rows: 0.06 }, 25, 38, PALETTE.dark, { top: 0x374151 });
      g.poly(pts(iso(c + 0.5, r + 0.4, 38.5), iso(c + 0.9, r + 0.4, 38.5), iso(c + 0.9, r + 0.4, 40), iso(c + 0.5, r + 0.4, 40))).fill({
        color: PALETTE.screenGlow,
        alpha: 0.35,
      });
      return [g];
    }

    case "exec-desk": {
      const g = piece(c, r, BIAS.furniture, item.id);
      isoBox(g, tileRect(item, c, r, 0.04), 0, 20, PALETTE.walnut);
      isoBox(g, tileRect(item, c, r, 0.0), 20, 23, PALETTE.walnutLight, { top: shade(PALETTE.walnutLight, 1.15) });
      if (isFirstCol) {
        // Laptop facing the executive chair.
        isoBox(g, { col: c + 0.3, row: r + 0.18, cols: 0.42, rows: 0.28 }, 23, 24, 0xcbd5e1);
        isoBox(g, { col: c + 0.3, row: r + 0.46, cols: 0.42, rows: 0.03 }, 24, 36, 0x9ca3af, { top: 0xd1d5db });
      }
      if (isLastCol) {
        // Brass nameplate and a desk lamp.
        isoBox(g, { col: c + 0.25, row: r + 0.84, cols: 0.4, rows: 0.06 }, 23, 26, 0xc9a227);
        isoBox(g, { col: c + 0.74, row: r + 0.6, cols: 0.06, rows: 0.06 }, 23, 40, PALETTE.dark);
        isoBox(g, { col: c + 0.64, row: r + 0.52, cols: 0.24, rows: 0.2 }, 40, 44, 0xf8e7b5);
      }
      return [g];
    }

    case "conference-table": {
      const g = piece(c, r, BIAS.furniture, item.id);
      const centerCol = a.col + Math.floor(a.cols / 2);
      if ((c === centerCol - 2 || c === centerCol + 1) && r === a.row) {
        isoBox(g, { col: c + 0.3, row: r + 0.6, cols: 0.4, rows: 0.8 }, 0, 17, PALETTE.dark);
      }
      isoBox(g, tileRect(item, c, r, 0.08), 17, 21, PALETTE.conference, {
        top: shade(PALETTE.conference, 1.35),
        left: shade(PALETTE.conference, 0.9),
        right: shade(PALETTE.conference, 0.7),
      });
      // Notepads at seats along the table edges.
      if (r === a.row && c > a.col && c < a.col + a.cols - 1) isoBox(g, { col: c + 0.32, row: r + 0.16, cols: 0.3, rows: 0.22 }, 21, 21.5, 0xf8fafc);
      if (r === a.row + a.rows - 1 && c > a.col && c < a.col + a.cols - 1) isoBox(g, { col: c + 0.36, row: r + 0.6, cols: 0.3, rows: 0.22 }, 21, 21.5, 0xf8fafc);
      return [g];
    }

    case "chair":
      return drawChair(item, c, r);

    case "sofa": {
      const g = piece(c, r, BIAS.furniture, item.id);
      const base = tileRect(item, c, r, 0.06);
      isoBox(g, base, 2, 13, PALETTE.sofa);
      isoBox(g, { col: base.col + 0.04, row: base.row + 0.04, cols: base.cols - 0.08, rows: base.rows - 0.08 }, 13, 16, PALETTE.sofaCushion);
      const back: BoxRect =
        item.facing === "se"
          ? { col: base.col, row: base.row, cols: 0.24, rows: base.rows }
          : { col: base.col, row: base.row + base.rows - 0.24, cols: base.cols, rows: 0.24 };
      isoBox(g, back, 13, 28, shade(PALETTE.sofa, 1.08));
      return [g];
    }

    case "coffee-table": {
      const g = piece(c, r, BIAS.furniture, item.id);
      const top = tileRect(item, c, r, 0.12);
      if (isFirstCol || isLastCol) isoBox(g, { col: c + (isFirstCol ? 0.16 : 0.78), row: r + 0.3, cols: 0.06, rows: 0.4 }, 0, 9, PALETTE.dark);
      isoBox(g, top, 9, 11, 0xdbe3ec, { alpha: 0.95 });
      if (c === a.col + 1) isoBox(g, { col: c + 0.2, row: r + 0.3, cols: 0.35, rows: 0.28 }, 11, 13, 0x1e3a5f);
      return [g];
    }

    case "plant": {
      const g = piece(c, r, BIAS.furniture, item.id);
      isoBox(g, { col: c + 0.3, row: r + 0.3, cols: 0.4, rows: 0.4 }, 0, 15, PALETTE.pot);
      const [x, y] = iso(c + 0.5, r + 0.5, 15);
      const leaves: [number, number, number, number][] = [
        [-7, -6, 7, PALETTE.leaf],
        [7, -7, 7, PALETTE.leaf],
        [0, -14, 8, PALETTE.leafLight],
        [-5, -20, 6, PALETTE.leafLight],
        [5, -21, 6, PALETTE.leaf],
        [0, -27, 5, PALETTE.leafLight],
      ];
      for (const [dx, dy, rad, color] of leaves) g.ellipse(x + dx, y + dy, rad, rad * 1.15).fill(color);
      return [g];
    }

    case "cabinet": {
      const g = piece(c, r, BIAS.furniture, item.id);
      const box = tileRect(item, c, r, 0.08);
      isoBox(g, box, 0, 32, PALETTE.cabinet);
      for (const z of [11, 21]) {
        g.moveTo(...iso(box.col, box.row + box.rows, z)).lineTo(...iso(box.col + box.cols, box.row + box.rows, z));
        g.moveTo(...iso(box.col + box.cols, box.row, z)).lineTo(...iso(box.col + box.cols, box.row + box.rows, z));
      }
      g.stroke({ width: 1, color: 0x9aa4b2, alpha: 0.7 });
      return [g];
    }

    default:
      return [];
  }
}

function drawChair(item: FurnitureItem, c: number, r: number): Graphics[] {
  const backInFront = item.facing === "ne" || item.facing === "nw";
  const seat = piece(c, r, BIAS.seat, item.id);
  // Five-star base, gas lift, seat.
  seat.ellipse(...iso(c + 0.5, r + 0.5, 0), 11, 5.5).fill({ color: 0x000000, alpha: 0.12 });
  isoBox(seat, { col: c + 0.38, row: r + 0.38, cols: 0.24, rows: 0.24 }, 0, 2, PALETTE.dark);
  isoBox(seat, { col: c + 0.47, row: r + 0.47, cols: 0.06, rows: 0.06 }, 2, 9, PALETTE.metal);
  isoBox(seat, { col: c + 0.27, row: r + 0.27, cols: 0.46, rows: 0.46 }, 9, 12, PALETTE.chair, { top: shade(PALETTE.chair, 1.25) });

  const back = piece(c, r, backInFront ? BIAS.backrestFront : BIAS.seat, `${item.id}-back`);
  const rest: BoxRect =
    item.facing === "sw"
      ? { col: c + 0.28, row: r + 0.2, cols: 0.44, rows: 0.08 }
      : item.facing === "ne"
        ? { col: c + 0.28, row: r + 0.72, cols: 0.44, rows: 0.08 }
        : item.facing === "se"
          ? { col: c + 0.2, row: r + 0.28, cols: 0.08, rows: 0.44 }
          : { col: c + 0.72, row: r + 0.28, cols: 0.08, rows: 0.44 };
  isoBox(back, rest, 12, 30, PALETTE.chair, { top: shade(PALETTE.chair, 1.3) });
  return [seat, back];
}

/**
 * The executive project board: five columns, one per board tile. Card
 * colors reflect the simulated task owner; only the card layer redraws.
 */
export class ProjectBoardView {
  readonly pieces: Container[] = [];
  private readonly cardLayers: Graphics[] = [];
  private lastTasks: readonly SimTask[] | null = null;

  constructor(
    private readonly item: FurnitureItem,
    private readonly ownerColors: Record<string, number>,
  ) {
    const { col, row, cols } = item.area;
    for (let i = 0; i < cols; i++) {
      const c = col + i;
      const container = new Container({ label: `board-${i}` });
      container.zIndex = zIndexFor(tileKey(c, row), BIAS.furniture);
      container.eventMode = "static";
      container.cursor = "pointer";

      const g = new Graphics();
      if (i === 0) isoBox(g, { col: c + 0.02, row: row + 0.42, cols: 0.07, rows: 0.08 }, 0, 84, PALETTE.boardFrame);
      if (i === cols - 1) isoBox(g, { col: c + 0.91, row: row + 0.42, cols: 0.07, rows: 0.08 }, 0, 84, PALETTE.boardFrame);
      isoBox(g, { col: c, row: row + 0.44, cols: 1, rows: 0.06 }, 14, 80, PALETTE.board, {
        left: PALETTE.board,
        top: PALETTE.boardFrame,
        right: shade(PALETTE.board, 0.8),
      });
      // Frame rails and column header.
      g.poly(this.face(c, 0, 1, 76, 80)).fill(PALETTE.boardFrame);
      g.poly(this.face(c, 0, 1, 14, 17)).fill(PALETTE.boardFrame);
      g.poly(this.face(c, 0.06, 0.94, 62, 72)).fill(0xe8edf3);
      if (i > 0) g.poly(this.face(c, 0, 0.015, 17, 76)).fill({ color: PALETTE.boardFrame, alpha: 0.35 });
      container.addChild(g);

      const column = PROJECT_BOARD_COLUMNS[i];
      if (column) {
        const label = new Text({
          text: column.label.toUpperCase(),
          style: { fontFamily: UI_FONT, fontSize: 5.5, fontWeight: "700", fill: PALETTE.boardFrame, letterSpacing: 0.3 },
          resolution: 4,
        });
        const [x, y] = iso(c + 0.1, row + 0.5, 69.5);
        label.position.set(x, y);
        label.skew.set(COL_WALL_TEXT_SKEW.x, COL_WALL_TEXT_SKEW.y);
        container.addChild(label);
      }

      const cards = new Graphics();
      this.cardLayers.push(cards);
      container.addChild(cards);
      this.pieces.push(container);
    }
  }

  /** Quad on the board's front face: u along the column (0..1), z height. */
  private face(c: number, u0: number, u1: number, z0: number, z1: number): number[] {
    const row = this.item.area.row + 0.5;
    return pts(iso(c + u0, row, z0), iso(c + u1, row, z0), iso(c + u1, row, z1), iso(c + u0, row, z1));
  }

  update(tasks: readonly SimTask[]): void {
    if (tasks === this.lastTasks) return;
    this.lastTasks = tasks;
    const { col } = this.item.area;
    PROJECT_BOARD_COLUMNS.forEach((column, i) => {
      const g = this.cardLayers[i];
      if (!g) return;
      g.clear();
      const inColumn = tasks.filter((t) => t.status === column.status).slice(0, 4);
      inColumn.forEach((task, n) => {
        const z1 = 59 - n * 11;
        const z0 = z1 - 9;
        const c = col + i;
        g.poly(this.face(c, 0.08, 0.92, z0, z1)).fill(0xffffff);
        g.poly(this.face(c, 0.08, 0.92, z0, z1)).stroke({ width: 0.6, color: 0xcbd5e1 });
        g.poly(this.face(c, 0.08, 0.16, z0, z1)).fill(this.ownerColors[task.ownerId] ?? PALETTE.metal);
        g.poly(this.face(c, 0.22, 0.8, z1 - 3.5, z1 - 2.2)).fill({ color: 0x64748b, alpha: 0.7 });
        g.poly(this.face(c, 0.22, 0.6, z0 + 2.2, z0 + 3.4)).fill({ color: 0x94a3b8, alpha: 0.6 });
      });
    });
  }
}
