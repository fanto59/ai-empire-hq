"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/backend/auth/session";
import { getDatabase } from "@/backend/db";
import { ServiceError } from "@/backend/errors";
import { archiveBusiness, createAgent, createBusiness, createProject, restoreBusiness, setBusinessStatus } from "@/backend/org/structure";
import type { AdminFormState } from "@/frontend/sectors/AdminForms";

/**
 * Server Actions for sector administration. Each re-validates the signed-in
 * session; the services enforce businesses:admin (or tasks:write for
 * projects) and organization-wide access. Agents can never call these.
 */
async function run(fn: (db: NonNullable<Awaited<ReturnType<typeof getDatabase>>>, ctx: NonNullable<Awaited<ReturnType<typeof getSessionContext>>>) => Promise<string>): Promise<AdminFormState> {
  const db = await getDatabase();
  if (!db) return { ok: false, message: "The database is not set up." };
  const ctx = await getSessionContext(db);
  if (!ctx) return { ok: false, message: "Your session has expired. Sign in again." };
  try {
    const message = await fn(db, ctx);
    revalidatePath("/sectors", "layout");
    revalidatePath("/agents");
    return { ok: true, message };
  } catch (e) {
    return { ok: false, message: e instanceof ServiceError ? e.message : "That did not work. Please try again." };
  }
}

const field = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};

export async function createBusinessAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return run(async (db, ctx) => {
    const b = await createBusiness(db, ctx, { name: field(form, "name"), sectorId: field(form, "sectorId"), description: field(form, "description") });
    return `${b.name} was added (status: planning). No work starts until you assign it.`;
  });
}

export async function businessStatusAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return run(async (db, ctx) => {
    const id = field(form, "businessId");
    const op = field(form, "op");
    if (op === "archive") return `${(await archiveBusiness(db, ctx, id)).name} was archived.`;
    if (op === "restore") return `${(await restoreBusiness(db, ctx, id)).name} was restored to planning.`;
    const b = await setBusinessStatus(db, ctx, id, op);
    return `${b.name} is now ${b.status}.`;
  });
}

export async function createAgentAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return run(async (db, ctx) => {
    const scope = field(form, "scope") ?? "";
    const [kind, id] = scope.split(":");
    const a = await createAgent(db, ctx, {
      name: field(form, "name"),
      role: field(form, "role"),
      sectorId: kind === "sector" ? id : undefined,
      businessId: kind === "business" ? id : undefined,
    });
    return `${a.displayName} was created with no tasks. Nothing runs until you give it an assignment.`;
  });
}

export async function createProjectAction(_prev: AdminFormState, form: FormData): Promise<AdminFormState> {
  return run(async (db, ctx) => {
    const scope = field(form, "scope") ?? "";
    const [kind, id] = scope.split(":");
    const p = await createProject(db, ctx, {
      title: field(form, "title"),
      businessId: kind === "business" ? id : undefined,
      sectorId: kind === "sector" ? id : undefined,
      ownerAgentId: field(form, "ownerAgentId"),
    });
    return `Project "${p.title}" was created.`;
  });
}
