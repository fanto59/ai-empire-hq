import type { FloorPlan, FurnitureItem, TileRect } from "./types";

/**
 * EXECUTIVE FLOOR - the first floor of AI Empire HQ.
 *
 *            back-left wall (col 0)        back-right wall (row 0)
 *   rows 0-5 | Chief AI Manager | Central PM | Conference room       |
 *   rows 6-7 | Executive corridor (sector elevator on the left wall)  |
 *   rows 8-15| Research department          | Executive project board |
 *              cols 0-11                      cols 12-21
 */
const rect = (col: number, row: number, cols = 1, rows = 1): TileRect => ({ col, row, cols, rows });

const chairs: FurnitureItem[] = [
  // Executive seats
  { id: "chair-chief", kind: "chair", area: rect(3, 1), facing: "sw" },
  { id: "chair-pm", kind: "chair", area: rect(9, 1), facing: "sw" },
  { id: "chair-chief-guest", kind: "chair", area: rect(3, 3), facing: "ne" },
  { id: "chair-pm-guest", kind: "chair", area: rect(9, 3), facing: "ne" },
  // Conference room
  ...[15, 16, 17].map<FurnitureItem>((c) => ({ id: `chair-conf-n${c}`, kind: "chair", area: rect(c, 1), facing: "sw" })),
  ...[15, 16, 17, 18].map<FurnitureItem>((c) => ({ id: `chair-conf-s${c}`, kind: "chair", area: rect(c, 4), facing: "ne" })),
  { id: "chair-conf-w", kind: "chair", area: rect(13, 3), facing: "se" },
  { id: "chair-conf-e", kind: "chair", area: rect(20, 2), facing: "nw" },
  // Research workstations: two rows of three desks, two seats each
  ...[9, 12].flatMap((row) =>
    [1, 2, 4, 5, 7, 8].map<FurnitureItem>((col) => ({
      id: `chair-research-${col}-${row}`,
      kind: "chair",
      area: rect(col, row),
      facing: "sw",
    })),
  ),
];

export const EXECUTIVE_FLOOR: FloorPlan = {
  id: "executive-floor",
  name: "Executive Floor",
  grid: { cols: 22, rows: 16 },

  rooms: [
    { id: "chief-office", label: "Chief AI Manager", floorLabel: "Chief AI Manager", area: rect(0, 0, 6, 6), finish: "walnut" },
    { id: "pm-office", label: "Central Project Manager", floorLabel: "Project Manager", area: rect(6, 0, 6, 6), finish: "oak" },
    { id: "conference", label: "Conference Room", floorLabel: "Conference", area: rect(12, 0, 10, 6), finish: "carpet" },
    { id: "corridor", label: "Executive Corridor", floorLabel: "Executive Corridor", area: rect(0, 6, 22, 2), finish: "polished" },
    { id: "research", label: "Research Department", floorLabel: "Research", area: rect(0, 8, 12, 8), finish: "concrete" },
    { id: "board-lounge", label: "Executive Project Board", floorLabel: "Project Board", area: rect(12, 8, 10, 8), finish: "oak" },
  ],

  partitions: [
    { axis: "row", at: 6, from: 0, to: 22, gaps: [3, 9, 16, 17], style: "clear" },
    { axis: "col", at: 6, from: 0, to: 6, gaps: [], style: "frosted" },
    { axis: "col", at: 12, from: 0, to: 6, gaps: [], style: "frosted" },
    { axis: "row", at: 8, from: 0, to: 12, gaps: [3, 8], style: "clear" },
    { axis: "row", at: 8, from: 12, to: 22, gaps: [13, 21], style: "clear" },
    { axis: "col", at: 12, from: 8, to: 16, gaps: [11, 12], style: "clear" },
  ],

  furniture: [
    // Chief AI Manager office
    { id: "exec-desk", kind: "exec-desk", area: rect(2, 2, 2, 1), facing: "sw" },
    { id: "chief-sofa", kind: "sofa", area: rect(0, 3, 1, 2), facing: "se" },
    { id: "chief-plant", kind: "plant", area: rect(5, 0), facing: "sw" },
    // Central Project Manager office
    { id: "pm-desk", kind: "desk", area: rect(8, 2, 2, 1), facing: "sw" },
    { id: "pm-cabinet", kind: "cabinet", area: rect(6, 0, 2, 1), facing: "sw" },
    { id: "pm-plant", kind: "plant", area: rect(11, 0), facing: "sw" },
    // Conference room
    { id: "conference-table", kind: "conference-table", area: rect(14, 2, 6, 2), facing: "sw" },
    { id: "conf-plant", kind: "plant", area: rect(21, 0), facing: "sw" },
    // Research department
    ...[10, 13].flatMap((row) =>
      [1, 4, 7].map<FurnitureItem>((col) => ({
        id: `research-desk-${col}-${row}`,
        kind: "desk",
        area: rect(col, row, 2, 1),
        facing: "sw",
      })),
    ),
    { id: "research-cabinet", kind: "cabinet", area: rect(11, 9, 1, 2), facing: "nw" },
    { id: "research-plant-a", kind: "plant", area: rect(11, 15), facing: "sw" },
    { id: "research-plant-b", kind: "plant", area: rect(0, 15), facing: "sw" },
    // Executive project board + lounge
    { id: "project-board", kind: "project-board", area: rect(15, 8, 5, 1), facing: "sw" },
    { id: "lounge-sofa", kind: "sofa", area: rect(14, 14, 3, 1), facing: "ne" },
    { id: "lounge-table", kind: "coffee-table", area: rect(14, 13, 3, 1), facing: "ne" },
    { id: "lounge-plant-a", kind: "plant", area: rect(21, 9), facing: "sw" },
    { id: "lounge-plant-b", kind: "plant", area: rect(21, 15), facing: "sw" },
    ...chairs,
  ],

  wallFeatures: [
    { id: "chief-window", kind: "window", wall: "back-right", from: 1, to: 5 },
    { id: "pm-window", kind: "window", wall: "back-right", from: 8, to: 11 },
    { id: "conf-display", kind: "display", wall: "back-right", from: 15, to: 19 },
    { id: "chief-shelf", kind: "bookshelf", wall: "back-left", from: 0, to: 3 },
    { id: "sector-elevator", kind: "elevator", wall: "back-left", from: 6, to: 8 },
    { id: "research-window-a", kind: "window", wall: "back-left", from: 9, to: 12 },
    { id: "research-window-b", kind: "window", wall: "back-left", from: 12, to: 15 },
  ],

  waypoints: [
    { id: "chief.desk", label: "Chief AI Manager's desk", room: "chief-office", tile: { col: 3, row: 1 }, posture: "sit", facing: "sw" },
    { id: "chief.window", label: "Chief AI Manager's window", room: "chief-office", tile: { col: 1, row: 1 }, posture: "stand", facing: "ne" },
    { id: "pm.desk", label: "Project Manager's desk", room: "pm-office", tile: { col: 9, row: 1 }, posture: "sit", facing: "sw" },
    { id: "conf.head", label: "Conference room (north side)", room: "conference", tile: { col: 16, row: 1 }, posture: "sit", facing: "sw" },
    { id: "conf.south-a", label: "Conference room (south side)", room: "conference", tile: { col: 16, row: 4 }, posture: "sit", facing: "ne" },
    { id: "conf.south-b", label: "Conference room (south side)", room: "conference", tile: { col: 17, row: 4 }, posture: "sit", facing: "ne" },
    { id: "research.desk", label: "Research workstation R-2", room: "research", tile: { col: 4, row: 9 }, posture: "sit", facing: "sw" },
    { id: "research.side", label: "Beside workstation R-2", room: "research", tile: { col: 6, row: 9 }, posture: "stand", facing: "nw" },
    { id: "board.left", label: "Project board (left)", room: "board-lounge", tile: { col: 16, row: 10 }, posture: "stand", facing: "ne" },
    { id: "board.right", label: "Project board (right)", room: "board-lounge", tile: { col: 18, row: 10 }, posture: "stand", facing: "ne" },
    { id: "board.center", label: "Project board (center)", room: "board-lounge", tile: { col: 17, row: 11 }, posture: "stand", facing: "ne" },
    { id: "corridor.elevator", label: "Sector elevator", room: "corridor", tile: { col: 1, row: 7 }, posture: "stand", facing: "nw" },
  ],
};

