import { loadRuntimeConfig } from "@/infrastructure/config/env";
import { DisabledKnowledgeSync, type KnowledgeSyncAdapter } from "@/infrastructure/knowledge/sync";
import { KnowledgeService } from "./service";

export { KnowledgeService } from "./service";
export type { CreateNoteInput, ListNotesFilter, UpdateNoteInput } from "./service";
export { KnowledgeError } from "./errors";
export { businessAgentContext, ownerContext, type KnowledgeAccessContext } from "./access";

/** Server-side singletons (one per process). */
let service: KnowledgeService | null = null;
const sync: KnowledgeSyncAdapter = new DisabledKnowledgeSync();

export function getKnowledgeService(): KnowledgeService {
  service ??= new KnowledgeService({ root: loadRuntimeConfig().knowledgeVaultDir });
  return service;
}

export function getKnowledgeSync(): KnowledgeSyncAdapter {
  return sync;
}
