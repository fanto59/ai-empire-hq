import type { TilePoint } from "../iso";

/**
 * FLOOR PLAN MODEL - pure data describing one floor of the headquarters.
 * Renderers draw it, pathfinding walks it, the simulation targets its
 * waypoints. Nothing in here knows about PixiJS or React.
 *
 * Grid convention (matches iso.ts): `col` grows toward the bottom-right of
 * the screen, `row` toward the bottom-left. The two "back" walls run along
 * row = 0 (back-right) and col = 0 (back-left).
 */
export interface TileRect {
  col: number;
  row: number;
  cols: number;
  rows: number;
}

/** Screen-facing direction of a character or seat, in isometric terms. */
export type Facing = "ne" | "nw" | "se" | "sw";

export type FloorFinish = "walnut" | "oak" | "carpet" | "concrete" | "polished";

export type RoomId =
  | "chief-office"
  | "pm-office"
  | "conference"
  | "corridor"
  | "research"
  | "board-lounge";

export interface Room {
  id: RoomId;
  label: string;
  /** Short label painted on the floor. */
  floorLabel: string;
  area: TileRect;
  finish: FloorFinish;
}

/**
 * A straight run of glass partition along a grid line, with door gaps.
 * - axis "row": the line between row `at - 1` and row `at`, spanning
 *   columns [from, to).
 * - axis "col": the line between col `at - 1` and col `at`, spanning
 *   rows [from, to).
 * `gaps` lists the column (or row) indexes left open as doorways.
 */
export interface PartitionRun {
  axis: "row" | "col";
  at: number;
  from: number;
  to: number;
  gaps: number[];
  style: "clear" | "frosted";
}

export type FurnitureKind =
  | "exec-desk"
  | "desk"
  | "chair"
  | "conference-table"
  | "sofa"
  | "coffee-table"
  | "plant"
  | "cabinet"
  | "project-board";

export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  area: TileRect;
  /** Which way the item "faces" (seat direction, screen side, ...). */
  facing: Facing;
}

export type WallFeatureKind = "window" | "display" | "bookshelf" | "elevator";

export interface WallFeature {
  id: string;
  kind: WallFeatureKind;
  /** back-right wall runs along row 0; back-left wall runs along col 0. */
  wall: "back-right" | "back-left";
  /** Tile index range along the wall, [from, to). */
  from: number;
  to: number;
}

export type WaypointId = string;

export interface Waypoint {
  id: WaypointId;
  label: string;
  room: RoomId;
  tile: TilePoint;
  posture: "stand" | "sit";
  facing: Facing;
}

/** Things on the floor the user can click besides characters. */
export type FloorHotspot = "project-board" | "sector-elevator";

export interface FloorPlan {
  id: string;
  name: string;
  grid: { cols: number; rows: number };
  rooms: Room[];
  partitions: PartitionRun[];
  furniture: FurnitureItem[];
  wallFeatures: WallFeature[];
  waypoints: Waypoint[];
}
