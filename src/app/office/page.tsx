import type { Metadata } from "next";
import { ownerRequestContext } from "@/backend/auth/context";
import { getSessionContext } from "@/backend/auth/session";
import { getDashboardOrganization, getDatabase } from "@/backend/db";
import { loadChiefPanel } from "@/backend/tasks/chief-panel";
import { loadTaskSummaries } from "@/backend/tasks/views";
import { ExecutiveFloor } from "@/frontend/executive-floor/ExecutiveFloor";
import { submitGoalAction } from "./actions";

export const metadata: Metadata = {
  title: "Executive Floor · AI Empire HQ",
};
export const dynamic = "force-dynamic";

export default async function ExecutiveFloorPage() {
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  // Reads are server-side as the owner; writes (objectives) need a signed-in session.
  const tasks = db && org ? await loadTaskSummaries(db, ownerRequestContext(org.id)) : null;
  const signedIn = db ? (await getSessionContext(db)) !== null : false;
  const chief = db && org ? await loadChiefPanel(db, org.id, signedIn) : null;
  return <ExecutiveFloor tasks={tasks} testData={org?.isTestData ?? false} chief={chief} submitGoal={submitGoalAction} />;
}
