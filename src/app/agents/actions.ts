"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/backend/auth/session";
import { getDatabase } from "@/backend/db";
import { ServiceError } from "@/backend/errors";
import { assignWork } from "@/backend/tasks/assignments";
import type { AssignmentFormState } from "@/frontend/tasks/AssignmentForm";

export async function assignWorkAction(_prev: AssignmentFormState, form: FormData): Promise<AssignmentFormState> {
  const db = await getDatabase();
  if (!db) return { ok: false, message: "The database is not set up.", taskId: null };
  const ctx = await getSessionContext(db);
  if (!ctx) return { ok: false, message: "Your session has expired. Sign in again.", taskId: null };
  try {
    const r = await assignWork(
      db,
      ctx,
      {
        agentId: String(form.get("agentId") ?? ""),
        instructions: String(form.get("instructions") ?? ""),
        title: String(form.get("title") ?? "") || undefined,
        businessId: String(form.get("businessId") ?? "") || undefined,
      },
      String(form.get("idempotencyKey") ?? "") || `assign-${randomUUID()}`,
    );
    revalidatePath("/agents");
    return { ok: true, message: r.note, taskId: r.task.id };
  } catch (e) {
    return { ok: false, message: e instanceof ServiceError ? e.message : "Could not give the assignment.", taskId: null };
  }
}
