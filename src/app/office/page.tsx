import type { Metadata } from "next";
import { ownerRequestContext } from "@/backend/auth/context";
import { getDashboardOrganization, getDatabase } from "@/backend/db";
import { loadTaskSummaries } from "@/backend/tasks/views";
import { ExecutiveFloor } from "@/frontend/executive-floor/ExecutiveFloor";

export const metadata: Metadata = {
  title: "Executive Floor · AI Empire HQ",
};
export const dynamic = "force-dynamic";

export default async function ExecutiveFloorPage() {
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  // No interactive login yet: server-rendered pages read as the owner.
  const tasks = db && org ? await loadTaskSummaries(db, ownerRequestContext(org.id)) : null;
  return <ExecutiveFloor tasks={tasks} testData={org?.isTestData ?? false} />;
}
