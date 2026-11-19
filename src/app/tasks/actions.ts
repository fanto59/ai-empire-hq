"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/backend/auth/session";
import { getDatabase } from "@/backend/db";
import { ServiceError } from "@/backend/errors";
import { createResearchTask } from "@/backend/tasks/research";

export interface ResearchFormState {
  ok: boolean;
  message: string | null;
  taskId: string | null;
}

/** Validated, authenticated, persisted; the worker picks it up from here. */
export async function createResearchTaskAction(_prev: ResearchFormState, form: FormData): Promise<ResearchFormState> {
  const db = await getDatabase();
  if (!db) return { ok: false, message: "The database is not set up.", taskId: null };
  const ctx = await getSessionContext(db);
  if (!ctx) return { ok: false, message: "Your session has expired. Sign in again.", taskId: null };
  // One submission per rendered form (the form carries a fresh key), so a
  // double click or a retried request never creates two tasks.
  const key = String(form.get("idempotencyKey") ?? "") || `research-${randomUUID()}`;
  try {
    const result = await createResearchTask(
      db,
      ctx,
      { businessId: String(form.get("businessId") ?? ""), question: String(form.get("question") ?? "") },
      key,
    );
    revalidatePath("/tasks");
    return { ok: true, message: `Research task created. ${result.note}`, taskId: result.task.id };
  } catch (e) {
    return { ok: false, message: e instanceof ServiceError ? e.message : "Could not create the task.", taskId: null };
  }
}
