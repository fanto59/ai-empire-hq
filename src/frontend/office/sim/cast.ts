import type { PrototypeCharacter } from "./types";

/**
 * The prototype cast. Codenames are deliberately non-human so nobody
 * mistakes them for staff, and every surface labels them as simulated.
 */
export const PROTOTYPE_CAST: readonly PrototypeCharacter[] = [
  {
    id: "sim-chief",
    codename: "ORION",
    role: "Chief AI Manager",
    business: "AI Empire HQ · Headquarters",
    project: "Executive Floor prototype",
    plannedModel: "Claude (Anthropic)",
    homeWaypoint: "chief.desk",
    agentSlug: "test-chief",
    appearance: {
      skin: 0x8d5a3b,
      hair: 0xb8bcc4,
      hairStyle: "short",
      jacket: 0x1e2a44,
      shirt: 0xf3f4f6,
      accent: 0xc9a227,
      trousers: 0x18213a,
      shoes: 0x111111,
      heightScale: 1.06,
      accessory: "tie",
    },
  },
  {
    id: "sim-pm",
    codename: "VEGA",
    role: "Central Project Manager",
    business: "AI Empire HQ · Headquarters",
    project: "Executive Floor prototype",
    plannedModel: "OpenAI",
    homeWaypoint: "pm.desk",
    agentSlug: "test-pm",
    appearance: {
      skin: 0xe0b18f,
      hair: 0x2b1d14,
      hairStyle: "bun",
      jacket: 0x0f766e,
      shirt: 0xe7f6f3,
      accent: 0x5eead4,
      trousers: 0x334155,
      shoes: 0x1f2937,
      heightScale: 1,
      accessory: "tablet",
    },
  },
  {
    id: "sim-research",
    codename: "LYRA",
    role: "Research Agent",
    business: "AI Empire HQ · Research",
    project: "Sector discovery (prototype)",
    plannedModel: "Grok (xAI)",
    homeWaypoint: "research.desk",
    agentSlug: "test-research",
    appearance: {
      skin: 0xf1c7a5,
      hair: 0x8a3b1c,
      hairStyle: "long",
      jacket: 0xe5e7eb,
      shirt: 0x4f46e5,
      accent: 0x818cf8,
      trousers: 0x3f3f46,
      shoes: 0x27272a,
      heightScale: 0.97,
      accessory: "glasses",
    },
  },
];
