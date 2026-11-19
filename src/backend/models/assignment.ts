import { and, eq, inArray } from "drizzle-orm";
import { MODELS, WORK_TYPES, findModel, type ModelInfo, type ProviderId, type WorkType } from "@/agents/providers/catalog";
import { modelAvailability, PROVIDER_IDS, type ModelAvailability, type ProviderLookup } from "@/agents/providers/registry";
import type { Db } from "@/infrastructure/db/client";
import { agentPermissions, agents } from "@/infrastructure/db/schema";
import { writeAudit } from "../audit";
import type { RequestContext } from "../auth/context";
import { ServiceError } from "../errors";

/**
 * MODEL ASSIGNMENT - which provider and model powers each agent.
 *
 * Stored on the agent row (model_provider / model_name). Each task runs on
 * exactly ONE model: the one assigned to the agent doing it. The app never
 * fans a task out to several providers.
 *
 * Only people holding the `models:admin` scope with organization-wide access
 * may change an assignment (agents never can); every change is audited.
 * A model can be assigned only when the provider's LIVE model list confirms
 * it for the app's key. While a provider has no key, catalog models can be
 * pre-assigned but are marked unverified (they cannot run until a key is set).
 */
type AgentRow = typeof agents.$inferSelect;

export const DEFAULT_MODEL: Record<ProviderId, string> = {
  anthropic: WORK_TYPES.engineering.model,
  openai: WORK_TYPES.strategy.model,
  xai: WORK_TYPES.research.model,
};

export function workTypeFor(agent: Pick<AgentRow, "role">, permissions: ReadonlySet<string>): WorkType {
  if (permissions.has("research.web_search") || permissions.has("research.web_fetch")) return "research";
  if (agent.role === "chief-ai-manager" || agent.role === "central-project-manager") return "strategy";
  return "engineering";
}

export interface ResolvedModel {
  provider: ProviderId;
  model: string;
  info: ModelInfo | undefined;
  workType: WorkType;
  /** True when the agent row has no explicit valid choice and the work-type default applies. */
  isDefault: boolean;
}

const isProvider = (p: string | null): p is ProviderId => p !== null && (PROVIDER_IDS as readonly string[]).includes(p);

export function resolveAgentModel(agent: Pick<AgentRow, "role" | "modelProvider" | "modelName">, permissions: ReadonlySet<string>): ResolvedModel {
  const workType = workTypeFor(agent, permissions);
  if (isProvider(agent.modelProvider)) {
    const chosen = findModel(agent.modelName);
    if (chosen && chosen.provider === agent.modelProvider && chosen.assignable) {
      return { provider: chosen.provider, model: chosen.id, info: chosen, workType, isDefault: false };
    }
    const model = WORK_TYPES[workType].provider === agent.modelProvider ? WORK_TYPES[workType].model : DEFAULT_MODEL[agent.modelProvider];
    return { provider: agent.modelProvider, model, info: findModel(model), workType, isDefault: true };
  }
  const d = WORK_TYPES[workType];
  return { provider: d.provider, model: d.model, info: findModel(d.model), workType, isDefault: true };
}

export async function agentPermissionSet(db: Db, agentId: string): Promise<Set<string>> {
  return new Set((await db.select({ p: agentPermissions.permission }).from(agentPermissions).where(eq(agentPermissions.agentId, agentId))).map((r) => r.p));
}

export function assertModelAdmin(ctx: RequestContext): void {
  if (ctx.principal.kind !== "user") throw new ServiceError("forbidden", "Only people can change which model powers an agent.");
  if (!ctx.scopes.has("models:admin")) throw new ServiceError("forbidden", "Changing models needs an administrator token (models:admin scope).");
  if (ctx.businesses !== "*" || !ctx.hq) throw new ServiceError("forbidden", "Changing models needs organization-wide access.");
}

export interface SetModelInput {
  agentId: string;
  model: string;
}

export interface SetModelResult {
  agentName: string;
  provider: ProviderId;
  model: string;
  verified: boolean;
  previous: { provider: string | null; model: string | null };
}

export async function setAgentModel(
  db: Db,
  ctx: RequestContext,
  input: SetModelInput,
  opts: { lookup?: ProviderLookup; availability?: Map<string, ModelAvailability>; now?: () => Date } = {},
): Promise<SetModelResult> {
  assertModelAdmin(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(input.agentId)) throw new ServiceError("invalid-input", "Unknown agent.");
  const info = findModel(input.model);
  if (!info || !info.assignable) throw new ServiceError("invalid-input", "Choose a model from the catalog.");

  const [agent] = await db.select().from(agents).where(and(eq(agents.id, input.agentId), eq(agents.organizationId, ctx.organizationId)));
  if (!agent) throw new ServiceError("not-found", "Agent not found.");
  if (agent.status === "retired") throw new ServiceError("invalid-input", "Retired agents cannot be reconfigured.");

  const perms = await agentPermissionSet(db, agent.id);
  if (workTypeFor(agent, perms) === "research" && !info.webSearch) {
    throw new ServiceError("invalid-input", `${info.label} has no web search with domain limits, which ${agent.displayName} needs for research.`);
  }

  // Verify against the provider's live model list (refreshed).
  const availability = opts.availability ?? (await modelAvailability(opts.lookup, { refresh: true }));
  const a = availability.get(info.id);
  if (a?.state === "unavailable") throw new ServiceError("invalid-input", `${info.label} is not offered to the app's ${info.provider} key right now.`);
  const verified = a?.state === "available";

  const now = opts.now?.() ?? new Date();
  await db.transaction(async (tx) => {
    await tx.update(agents).set({ modelProvider: info.provider, modelName: info.id, updatedAt: now }).where(eq(agents.id, agent.id));
    await writeAudit(tx, {
      organizationId: ctx.organizationId,
      businessId: agent.businessId,
      actor: { kind: "user", id: ctx.principal.id },
      action: "agent.model.changed",
      targetType: "agent",
      targetId: agent.id,
      metadata: { fromProvider: agent.modelProvider, fromModel: agent.modelName, toProvider: info.provider, toModel: info.id, verified },
      at: now,
    });
  });
  return { agentName: agent.displayName, provider: info.provider, model: info.id, verified, previous: { provider: agent.modelProvider, model: agent.modelName } };
}

export interface AgentModelRow {
  id: string;
  slug: string;
  name: string;
  role: string;
  status: string;
  workType: WorkType;
  provider: ProviderId;
  model: string;
  modelLabel: string;
  isDefault: boolean;
  /** Whether a worker runs this agent's tasks automatically. */
  runsAutomatically: boolean;
}

export async function listAgentModels(db: Db, organizationId: string): Promise<AgentModelRow[]> {
  const rows = await db.select().from(agents).where(and(eq(agents.organizationId, organizationId), inArray(agents.status, ["active", "draft", "disabled"])));
  const perms = rows.length
    ? await db.select({ agentId: agentPermissions.agentId, p: agentPermissions.permission }).from(agentPermissions).where(inArray(agentPermissions.agentId, rows.map((r) => r.id)))
    : [];
  return rows
    .map((a) => {
      const set = new Set(perms.filter((p) => p.agentId === a.id).map((p) => p.p));
      const r = resolveAgentModel(a, set);
      return {
        id: a.id,
        slug: a.slug,
        name: a.displayName,
        role: a.role,
        status: a.status,
        workType: r.workType,
        provider: r.provider,
        model: r.model,
        modelLabel: r.info?.label ?? r.model,
        isDefault: r.isDefault,
        runsAutomatically: a.status === "active" && (a.role === "chief-ai-manager" || set.has("research.web_search") || set.has("research.web_fetch")),
      };
    })
    .sort((x, y) => x.name.localeCompare(y.name));
}

export const ASSIGNABLE_MODELS = MODELS.filter((m) => m.assignable);
