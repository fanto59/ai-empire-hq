/**
 * The organization's initial sector structure (as specified by the owner).
 *
 * Provisioning (src/backend/org/structure.ts) creates these as real database
 * records - sectors, businesses and one manager agent per sector - and is
 * idempotent: existing records are kept, never duplicated or overwritten.
 * Businesses are created in "planning" status; nothing runs automatically.
 */
export interface SectorDefinition {
  slug: string;
  name: string;
  description: string;
}

export const INITIAL_SECTORS: readonly SectorDefinition[] = [
  { slug: "nightlife-entertainment", name: "Nightlife & Entertainment", description: "Nightlife brands, events and entertainment businesses." },
  { slug: "e-commerce", name: "E-Commerce", description: "Online stores and direct-to-consumer businesses." },
  { slug: "investments-acquisitions", name: "Investments & Acquisitions", description: "Investment research, acquisitions and portfolio oversight." },
  { slug: "business-development", name: "Business Development", description: "New opportunities, partnerships and market discovery." },
  { slug: "technology-automation", name: "Technology & Automation", description: "Internal tools, automation and technology ventures." },
  { slug: "shared-services", name: "Shared Services", description: "Services shared across sectors (finance, legal, people, operations)." },
];

/** Distinct businesses under Nightlife & Entertainment. Each is its own record, budget and knowledge scope. */
export const INITIAL_BUSINESSES: readonly { sector: string; slug: string; name: string }[] = [
  { sector: "nightlife-entertainment", slug: "xyz-partys", name: "XYZ PARTYS" },
  { sector: "nightlife-entertainment", slug: "305-events", name: "305 Events" },
  { sector: "nightlife-entertainment", slug: "party-street", name: "Party Street" },
  { sector: "nightlife-entertainment", slug: "713-society", name: "713 Society" },
];

export const BUSINESS_STATUSES = ["planning", "active", "paused", "archived"] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

export const BUSINESS_STATUS_LABELS: Record<BusinessStatus, string> = {
  planning: "Planning",
  active: "Active",
  paused: "Paused",
  archived: "Archived",
};

/** Agent roles that can be created for a sector or business (HQ roles are fixed). */
export const CREATABLE_AGENT_ROLES = ["sector-manager", "business-lead", "specialist"] as const;
export type CreatableAgentRole = (typeof CREATABLE_AGENT_ROLES)[number];
