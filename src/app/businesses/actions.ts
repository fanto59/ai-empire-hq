"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/backend/auth/session";
import { getDatabase } from "@/backend/db";
import { ServiceError } from "@/backend/errors";
import { getKnowledgeService, KnowledgeError } from "@/backend/knowledge";
import { saveBusinessProfile, setupBusinessStarter } from "@/backend/org/starter";
import type { AdminFormState } from "@/frontend/sectors/AdminForms";

/**
 * Business page actions. Each re-validates the signed-in session; the
 * services enforce businesses:admin and organization-wide access, and audit.
 */
async function run(fn: (db: NonNullable<Awaited<ReturnType<typeof getDatabase>>>, ctx: NonNullable<Awaited<ReturnType<typeof getSessionContext>>>) => Promise<string>): Promise<AdminFormState> {
  const db = await getDatabase();
  if (!db) return { ok: false, message: "The database is not set up." };
  const ctx = await getSessionContext(db);
  if (!ctx) return { ok: false, message: "Your session has expired. Sign in again." };
  try {
    const message = await fn(db, ctx);
    revalidatePath("/businesses", "layout");
    revalidatePath("/sectors", "layout");
    revalidatePath("/agents");
    return { ok: true, message };
  } catch (e) {
    if (e instanceof ServiceError || e instanceof KnowledgeError) return { ok: false, message: e.message };
    return { ok: false, message: "That did not work. Please try again." };
  }
}

const str = (form: FormData, key: string) => (typeof form.get(key) === "string" ? (form.get(key) as string) : "");

export async function starterAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return run(async (db, ctx) => {
    const r = await setupBusinessStarter(db, getKnowledgeService(), ctx, str(form, "businessId"));
    const made = r.departmentsCreated + r.agentsCreated + r.projectsCreated;
    if (made === 0 && !r.profileCreated) return "Already set up; nothing was changed.";
    return `Saved by the server: ${r.departmentsCreated} departments, ${r.agentsCreated} agents, ${r.projectsCreated} proposed projects${r.profileCreated ? ", and a blank profile to fill in" : ""}. No work was started.`;
  });
}

export async function saveProfileAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return run(async (db, ctx) => {
    await saveBusinessProfile(db, getKnowledgeService(), ctx, str(form, "businessId"), str(form, "body"));
    return "Profile saved by the server.";
  });
}
