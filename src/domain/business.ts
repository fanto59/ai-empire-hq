import type {
  AgentId,
  BusinessId,
  DepartmentId,
  HeadquartersId,
  IsoTimestamp,
  UserId,
} from "./ids";

/**
 * Headquarters is the single top-level tenant. It owns every business sector
 * and is where the Chief AI Manager and Central Project Manager live.
 */
export interface Headquarters {
  id: HeadquartersId;
  name: string;
  ownerUserId: UserId;
  chiefAiManagerAgentId: AgentId | null;
  centralProjectManagerAgentId: AgentId | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export type BusinessStatus = "planning" | "active" | "paused" | "archived";

/**
 * A Business is an independent sector. Every business-owned record carries a
 * `businessId`, and all data access is scoped by it (see docs/SECURITY.md,
 * "Business isolation").
 */
export interface Business {
  id: BusinessId;
  headquartersId: HeadquartersId;
  /** URL-safe unique key, e.g. "acme-store". */
  slug: string;
  name: string;
  description: string;
  sector: string;
  status: BusinessStatus;
  /** The agent that leads this business sector, if assigned. */
  leadAgentId: AgentId | null;
  /** Position of this sector's office wing on the HQ floor plan. */
  officeLayout: BusinessOfficeLayout;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface BusinessOfficeLayout {
  /** Tile origin of the wing on the isometric grid. */
  origin: { col: number; row: number };
  size: { cols: number; rows: number };
  /** Accent color (hex) used for the wing floor and badges. */
  accentColor: string;
}

export interface Department {
  id: DepartmentId;
  businessId: BusinessId;
  name: string;
  /** Free-form function label, e.g. "marketing", "operations", "research". */
  function: string;
  createdAt: IsoTimestamp;
}
