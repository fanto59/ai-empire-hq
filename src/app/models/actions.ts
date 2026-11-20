"use server";

import { revalidatePath } from "next/cache";
import { findModel, PROVIDER_LABELS } from "@/agents/providers/catalog";
import { getSessionContext } from "@/backend/auth/session";
import { getDatabase } from "@/backend/db";
import { ServiceError } from "@/backend/errors";
import { setAgentModel } from "@/backend/models/assignment";
import type { ModelFormState } from "@/frontend/models/ModelAssignmentForm";

/** Server Action: change which model powers an agent (administrators only). */
export async function setAgentModelAction(_prev: ModelFormState, form: FormData): Promise<ModelFormState> {
  const db = await getDatabase();
  if (!db) return { ok: false, message: "The database is not set up." };
  const ctx = await getSessionContext(db);
  if (!ctx) return { ok: false, message: "Your session has expired. Sign in again." };
  try {
    const r = await setAgentModel(db, ctx, { agentId: String(form.get("agentId") ?? ""), model: String(form.get("model") ?? "") });
    revalidatePath("/models");
    const label = findModel(r.model)?.label ?? r.model;
    return {
      ok: true,
      message: `${r.agentName} now uses ${label} (${PROVIDER_LABELS[r.provider]})${r.verified ? ", confirmed with the provider." : ". Not confirmed with the provider yet (it isn't connected or couldn't be reached)."}`,
    };
  } catch (e) {
    return { ok: false, message: e instanceof ServiceError ? e.message : "Could not change the model." };
  }
}
