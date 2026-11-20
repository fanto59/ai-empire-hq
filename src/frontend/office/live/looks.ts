import type { LiveAgentInfo } from "@/domain/live-office";
import type { CharacterAppearance, PrototypeCharacter } from "../sim/types";

/**
 * Deterministic look for a real agent (same agent → same look on every
 * floor and refresh). Purely cosmetic; derived from the agent id.
 */
const SKIN = [0x8d5a3b, 0xe0b18f, 0xf1c7a5, 0xc68642, 0x6b4423, 0xd9a07b];
const HAIR = [0x2b1d14, 0x8a3b1c, 0xb8bcc4, 0x1c1917, 0x5b3a1e, 0xd6a65a];
const JACKET = [0x1e2a44, 0x0f766e, 0xe5e7eb, 0x7c2d12, 0x312e81, 0x334155, 0x166534, 0x9d174d];
const ACCENT = [0xc9a227, 0x5eead4, 0x818cf8, 0xf472b6, 0x38bdf8, 0xfbbf24, 0x34d399];
const STYLES: CharacterAppearance["hairStyle"][] = ["short", "bun", "long"];
const ACCESSORIES: CharacterAppearance["accessory"][] = ["tie", "tablet", "glasses"];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function appearanceFor(agentId: string): CharacterAppearance {
  const h = hash(agentId);
  const pick = <T,>(list: readonly T[], shift: number) => list[(h >>> shift) % list.length]!;
  return {
    skin: pick(SKIN, 0),
    hair: pick(HAIR, 3),
    hairStyle: pick(STYLES, 6),
    jacket: pick(JACKET, 9),
    shirt: 0xf3f4f6,
    accent: pick(ACCENT, 12),
    trousers: 0x1f2937,
    shoes: 0x111111,
    heightScale: 0.96 + ((h >>> 15) % 10) / 100,
    accessory: pick(ACCESSORIES, 19),
  };
}

/** A renderable character for a real agent (no simulated fields). */
export function characterFor(agent: LiveAgentInfo, home: string, look?: PrototypeCharacter): PrototypeCharacter {
  return {
    id: agent.id,
    codename: agent.name,
    role: agent.role,
    business: "",
    project: "",
    plannedModel: `${agent.provider} · ${agent.model}`,
    homeWaypoint: home,
    agentSlug: agent.slug,
    appearance: look?.appearance ?? appearanceFor(agent.id),
  };
}
