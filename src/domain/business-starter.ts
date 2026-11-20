/**
 * BUSINESS STARTER KIT - the structure a new business gets when the owner
 * presses "Set up starter team" (src/backend/org/starter.ts).
 *
 * It contains NO facts about the business: only departments, roles, project
 * names and a profile TEMPLATE whose sections say "Not filled in yet". The
 * owner writes the real details; agents work only from what the owner wrote.
 */
export const NOT_FILLED = "_Not filled in yet._";

export interface StarterKit {
  departments: { slug: string; name: string }[];
  /** The business lead plus one specialist per department. */
  specialists: { department: string; title: string }[];
  projects: string[];
  profileSections: { heading: string; hint: string }[];
  /** Example assignments the page offers as one-click starting points (nothing is created until a person assigns one). */
  suggestedAssignments: { role: "lead" | string; title: string; instructions: string }[];
}

const NIGHTLIFE: StarterKit = {
  departments: [
    { slug: "events-bookings", name: "Events & Bookings" },
    { slug: "marketing-promotion", name: "Marketing & Promotion" },
    { slug: "operations-guest-experience", name: "Operations & Guest Experience" },
  ],
  specialists: [
    { department: "events-bookings", title: "Events & Bookings Specialist" },
    { department: "marketing-promotion", title: "Marketing & Promotion Specialist" },
    { department: "operations-guest-experience", title: "Guest Experience Specialist" },
  ],
  projects: ["Business profile & brand basics", "Event calendar & bookings", "Promotion plan", "Guest experience & operations checklist"],
  profileSections: [
    { heading: "What the business does", hint: "One or two sentences: the kind of events, the vibe, what makes it different." },
    { heading: "Audience", hint: "Who comes: age range, interests, where they hear about events." },
    { heading: "Cities, venues & partners", hint: "Where events happen and the venues or partners you already work with." },
    { heading: "Event formats & schedule", hint: "Recurring nights, special events, how often, typical capacity." },
    { heading: "Tickets & pricing", hint: "How tickets are sold and typical price ranges." },
    { heading: "Marketing channels", hint: "Social accounts, promoters, email lists (names only - never passwords)." },
    { heading: "Goals for the next 3 months", hint: "What success looks like this quarter." },
    { heading: "Rules for the agents", hint: "Anything the agents must always or never do (tone, topics, brands to avoid)." },
  ],
  suggestedAssignments: [
    {
      role: "lead",
      title: "Gap check of the business profile",
      instructions: "Read our business profile and list what is missing or unclear before we can plan events and promotion. Group the questions by department and suggest the order to answer them.",
    },
    {
      role: "events-bookings",
      title: "Draft an event planning checklist",
      instructions: "Draft a reusable planning checklist for one of our events, from booking the venue to the night itself, using only what our profile says. Mark anything that depends on missing information.",
    },
    {
      role: "marketing-promotion",
      title: "Outline a promotion plan for the next event",
      instructions: "Outline a promotion plan for our next event: channels, a posting timeline from 4 weeks out, and draft post ideas. Use only facts from our profile and list what you need from me. Do not post anything.",
    },
    {
      role: "operations-guest-experience",
      title: "Draft a guest experience checklist",
      instructions: "Draft a door-to-close guest experience checklist (entry, safety, staffing roles, closing) for our events, based on our profile. List the details you need from me.",
    },
  ],
};

const GENERIC: StarterKit = {
  departments: [
    { slug: "operations", name: "Operations" },
    { slug: "growth", name: "Growth & Marketing" },
  ],
  specialists: [
    { department: "operations", title: "Operations Specialist" },
    { department: "growth", title: "Growth Specialist" },
  ],
  projects: ["Business profile basics", "First 90-day plan"],
  profileSections: [
    { heading: "What the business does", hint: "One or two sentences." },
    { heading: "Customers", hint: "Who buys and why." },
    { heading: "Products or services", hint: "What is sold and how." },
    { heading: "Goals for the next 3 months", hint: "What success looks like this quarter." },
    { heading: "Rules for the agents", hint: "Anything the agents must always or never do." },
  ],
  suggestedAssignments: [
    {
      role: "lead",
      title: "Gap check of the business profile",
      instructions: "Read our business profile and list what is missing or unclear before we can make a 90-day plan. Suggest the order to answer the questions.",
    },
  ],
};

export function starterKitFor(sectorSlug: string | null): StarterKit {
  return sectorSlug === "nightlife-entertainment" ? NIGHTLIFE : GENERIC;
}

/** The profile template: every section is explicitly blank until the owner writes it. */
export function profileTemplate(businessName: string, kit: StarterKit): string {
  return [
    `> Written by the owner. Agents use ONLY what is written here; a section marked "Not filled in yet" means they must ask, not guess.`,
    "",
    ...kit.profileSections.flatMap((s) => [`## ${s.heading}`, `<!-- ${s.hint} -->`, NOT_FILLED, ""]),
  ]
    .join("\n")
    .replace(/\n+$/, "\n")
    .replace(/^/, `# ${businessName}\n\n`);
}

/** Share of profile sections that have real content (for the page's progress line). */
export function profileCompleteness(body: string): { filled: number; total: number } {
  const sections = body.split(/^## /m).slice(1);
  const filled = sections.filter((s) => {
    const content = s
      .split("\n")
      .slice(1)
      .join("\n")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(NOT_FILLED, "")
      .trim();
    return content.length > 0;
  }).length;
  return { filled, total: sections.length };
}
