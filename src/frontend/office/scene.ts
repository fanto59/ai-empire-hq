import type { AgentProfile, Business } from "@/domain";
import type { AgentId } from "@/domain/ids";
import type { DerivedAgentActivity } from "@/agents/events/types";
import { depthOf, type TilePoint } from "./iso";

/**
 * OFFICE SCENE MODEL - renderer-independent description of what to draw.
 *
 * Data flow:  domain records + derived activity  ->  buildOfficeScene()
 *             ->  OfficeScene  ->  OfficeRenderer (SVG today, PixiJS later)
 *
 * The scene is plain serializable data. Renderers never read domain records
 * or events directly; they only draw scenes. This keeps PixiJS (or any other
 * engine) swappable and keeps rendering free of business logic.
 */
export interface SceneZone {
  key: string;
  label: string;
  kind: "hq-core" | "business-wing";
  origin: TilePoint;
  size: { cols: number; rows: number };
  color: string;
}

export interface SceneAvatar {
  agentId: AgentId;
  label: string;
  spriteKey: string;
  tint: string;
  tile: TilePoint;
  activity: DerivedAgentActivity;
  depth: number;
}

export interface OfficeScene {
  grid: { cols: number; rows: number };
  zones: SceneZone[];
  /** Sorted back-to-front by depth. */
  avatars: SceneAvatar[];
}

/** The HQ core is always present: it is structure, not activity. */
export const HQ_CORE_ZONES: readonly SceneZone[] = [
  {
    key: "hq:chief-ai-manager",
    label: "Chief AI Manager",
    kind: "hq-core",
    origin: { col: 0, row: 0 },
    size: { cols: 4, rows: 4 },
    color: "#6366f1",
  },
  {
    key: "hq:central-project-manager",
    label: "Central Project Manager",
    kind: "hq-core",
    origin: { col: 5, row: 0 },
    size: { cols: 4, rows: 4 },
    color: "#0ea5e9",
  },
];

export interface BuildSceneInput {
  businesses: Business[];
  agents: AgentProfile[];
  /** Activity derived from real events; agents missing here are "offline". */
  activity: ReadonlyMap<AgentId, DerivedAgentActivity>;
}

export function buildOfficeScene({ businesses, agents, activity }: BuildSceneInput): OfficeScene {
  const zones: SceneZone[] = [
    ...HQ_CORE_ZONES,
    ...businesses
      .filter((b) => b.status !== "archived")
      .map<SceneZone>((b) => ({
        key: `business:${b.id}`,
        label: b.name,
        kind: "business-wing",
        origin: b.officeLayout.origin,
        size: b.officeLayout.size,
        color: b.officeLayout.accentColor,
      })),
  ];

  const avatars = agents
    .filter((a) => a.lifecycle === "enabled")
    .map<SceneAvatar>((a) => ({
      agentId: a.id,
      label: a.displayName,
      spriteKey: a.avatar.spriteKey,
      tint: a.avatar.tint,
      tile: a.avatar.desk,
      activity: activity.get(a.id) ?? "offline",
      depth: depthOf(a.avatar.desk),
    }))
    .sort((a, b) => a.depth - b.depth);

  const cols = Math.max(...zones.map((z) => z.origin.col + z.size.cols));
  const rows = Math.max(...zones.map((z) => z.origin.row + z.size.rows));

  return { grid: { cols, rows }, zones, avatars };
}
