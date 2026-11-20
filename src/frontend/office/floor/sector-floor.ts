import type { FloorPlan, FurnitureItem, PartitionRun, Room, TileRect, Waypoint, WallFeature } from "./types";

/**
 * SECTOR FLOOR GENERATOR (pure) - builds a sector's office from REAL records:
 * one office for the sector's own agents (manager + sector specialists) and
 * one room per (non-archived) business, each with desks for that business's
 * agents. Nothing here is invented: no records, no room.
 *
 *   rows 0-5   | Sector office | Business 1 | Business 2 | ...
 *   rows 6-7   | Corridor (elevator back to headquarters on the left wall)
 *   rows 8-13  | Business 3    | Business 4 | ... | Open workspace (filler)
 *
 * Each room seats up to 4 agents; further agents are listed as "not seated".
 */
export interface SectorFloorInput {
  sector: { slug: string; name: string };
  businesses: readonly { id: string; slug: string; name: string }[];
  agents: readonly { id: string; businessId: string | null; sectorId: string | null; role: string }[];
}

export interface Seat {
  rest: string;
  desk: string;
  roomId: string;
}

export interface SectorFloor {
  plan: FloorPlan;
  seats: Map<string, Seat>;
  /** Agents of this sector without a free desk. */
  overflow: string[];
  rooms: { roomId: string; businessId: string | null; label: string }[];
}

const W = 8; // room width (tiles)
const H = 6; // room depth (tiles)
const SEATS = 4;
const rect = (col: number, row: number, cols = 1, rows = 1): TileRect => ({ col, row, cols, rows });
const short = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function buildSectorFloor(input: SectorFloorInput): SectorFloor {
  const slots: { roomId: string; label: string; businessId: string | null; kind: "sector" | "business" | "filler" }[] = [
    { roomId: `sector-office`, label: `${input.sector.name} office`, businessId: null, kind: "sector" },
    ...input.businesses.map((b) => ({ roomId: `biz-${b.slug}`, label: b.name, businessId: b.id, kind: "business" as const })),
  ];
  const perRow = Math.max(2, Math.ceil(slots.length / 2));
  while (slots.length < perRow * 2) slots.push({ roomId: `open-${slots.length}`, label: "Open workspace", businessId: null, kind: "filler" });

  const cols = perRow * W;
  const rows = 2 * H + 2;
  const rooms: Room[] = [];
  const furniture: FurnitureItem[] = [];
  const waypoints: Waypoint[] = [];
  const wallFeatures: WallFeature[] = [];
  const partitions: PartitionRun[] = [];
  const topGaps: number[] = [];
  const bottomGaps: number[] = [];
  const seatSpots = new Map<string, { desks: string[]; rests: string[] }>();

  slots.forEach((slot, i) => {
    const top = i < perRow;
    const c0 = (top ? i : i - perRow) * W;
    const r0 = top ? 0 : H + 2;
    rooms.push({ id: slot.roomId, label: slot.label, floorLabel: short(slot.label), area: rect(c0, r0, W, H), finish: slot.kind === "sector" ? "walnut" : slot.kind === "business" ? "oak" : "carpet" });
    (top ? topGaps : bottomGaps).push(c0 + 3, c0 + 4); // doorway to the corridor
    furniture.push({ id: `${slot.roomId}-plant`, kind: "plant", area: rect(c0 + 7, r0), facing: "sw" });
    if (top) wallFeatures.push({ id: `${slot.roomId}-window`, kind: "window", wall: "back-right", from: c0 + 1, to: c0 + 7 });

    if (slot.kind === "filler") {
      furniture.push({ id: `${slot.roomId}-sofa`, kind: "sofa", area: rect(c0 + 2, r0 + 3, 3, 1), facing: "ne" });
      return;
    }
    const desks: string[] = [];
    const rests: string[] = [];
    for (let k = 0; k < SEATS; k++) {
      const dc = k % 2 === 0 ? 1 : 4;
      const dr = k < 2 ? 1 : 3;
      const chair = { col: c0 + dc + 1, row: r0 + dr };
      furniture.push({ id: `${slot.roomId}-chair-${k}`, kind: "chair", area: rect(chair.col, chair.row), facing: "sw" });
      furniture.push({ id: `${slot.roomId}-desk-${k}`, kind: slot.kind === "sector" && k === 0 ? "exec-desk" : "desk", area: rect(c0 + dc, r0 + dr + 1, 2, 1), facing: "sw" });
      const desk = `${slot.roomId}.desk${k}`;
      waypoints.push({ id: desk, label: `${slot.label} desk ${k + 1}`, room: slot.roomId, tile: chair, posture: "sit", facing: "sw" });
      desks.push(desk);
    }
    const restTiles = [
      { col: c0 + 6, row: r0 + 5 },
      { col: c0 + 7, row: r0 + 5 },
      { col: c0 + 7, row: r0 + 3 },
      { col: c0 + 7, row: r0 + 1 },
    ];
    restTiles.forEach((tile, k) => {
      const id = `${slot.roomId}.rest${k}`;
      waypoints.push({ id, label: `${slot.label}`, room: slot.roomId, tile, posture: "stand", facing: "nw" });
      rests.push(id);
    });
    seatSpots.set(slot.businessId ?? "sector", { desks, rests });
  });

  rooms.push({ id: "corridor", label: `${input.sector.name} corridor`, floorLabel: short(input.sector.name, 30), area: rect(0, H, cols, 2), finish: "polished" });
  partitions.push({ axis: "row", at: H, from: 0, to: cols, gaps: topGaps, style: "clear" });
  partitions.push({ axis: "row", at: H + 2, from: 0, to: cols, gaps: bottomGaps, style: "clear" });
  for (let i = 1; i < perRow; i++) {
    partitions.push({ axis: "col", at: i * W, from: 0, to: H, gaps: [], style: "frosted" });
    partitions.push({ axis: "col", at: i * W, from: H + 2, to: rows, gaps: [], style: "frosted" });
  }
  wallFeatures.push({ id: "left-window-top", kind: "window", wall: "back-left", from: 1, to: 5 });
  wallFeatures.push({ id: "hq-elevator", kind: "elevator", wall: "back-left", from: H, to: H + 2 });
  wallFeatures.push({ id: "left-window-bottom", kind: "window", wall: "back-left", from: H + 3, to: rows - 1 });
  waypoints.push({ id: "corridor.elevator", label: "Elevator to headquarters", room: "corridor", tile: { col: 0, row: H }, posture: "stand", facing: "nw" });

  // Seats: the sector's own agents in the sector office (managers first), business agents in their room.
  const seats = new Map<string, Seat>();
  const overflow: string[] = [];
  const order = (r: string) => (r === "sector-manager" ? 0 : r === "business-lead" ? 1 : 2);
  const groups = new Map<string, string[]>();
  for (const a of [...input.agents].sort((x, y) => order(x.role) - order(y.role) || x.id.localeCompare(y.id))) {
    const key = a.businessId ?? (a.sectorId ? "sector" : null);
    if (key === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), a.id]);
  }
  for (const [key, agentIds] of groups) {
    const spots = seatSpots.get(key);
    agentIds.forEach((id, k) => {
      if (spots && k < spots.desks.length) seats.set(id, { desk: spots.desks[k]!, rest: spots.rests[k]!, roomId: key === "sector" ? "sector-office" : `biz-${input.businesses.find((b) => b.id === key)!.slug}` });
      else overflow.push(id);
    });
  }

  return {
    plan: { id: `sector-${input.sector.slug}`, name: `${input.sector.name} floor`, grid: { cols, rows }, rooms, partitions, furniture, wallFeatures, waypoints },
    seats,
    overflow,
    rooms: slots.filter((s) => s.kind !== "filler").map((s) => ({ roomId: s.roomId, businessId: s.businessId, label: s.label })),
  };
}
