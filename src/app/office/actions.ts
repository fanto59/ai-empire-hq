"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/backend/auth/session";
import { getDatabase } from "@/backend/db";
import { ServiceError } from "@/backend/errors";
import { createExecutiveTask } from "@/backend/tasks/executive";
import type { GoalFormState } from "@/frontend/executive-floor/chief-types";

/** Owner objective → validated, persisted executive task → Chief AI Manager. */
export async function submitGoalAction(_prev: GoalFormState, form: FormData): Promise<GoalFormState> {
  const db = await getDatabase();
  if (!db) return { ok: false, message: "The database is not set up.", taskId: null };
  const ctx = await getSessionContext(db);
  if (!ctx) return { ok: false, message: "Your session has expired. Sign in again.", taskId: null };
  try {
    const key = String(form.get("idempotencyKey") ?? "") || `goal-${randomUUID()}`;
    const result = await createExecutiveTask(db, ctx, String(form.get("goal") ?? ""), key);
    revalidatePath("/office");
    return { ok: true, message: result.note, taskId: result.task.id };
  } catch (e) {
    return { ok: false, message: e instanceof ServiceError ? e.message : "Could not send the objective.", taskId: null };
  }
}
