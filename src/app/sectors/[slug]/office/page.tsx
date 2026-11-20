import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDashboardOrganization, getDatabase } from "@/backend/db";
import { loadSectorFloorInput } from "@/backend/org/sector-report";
import { SectorOffice } from "@/frontend/sectors/SectorOffice";
import { DatabaseSetupNotice } from "@/frontend/tasks/TaskStateBadge";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return { title: `${(await params).slug.replace(/-/g, " ")} office · AI Empire HQ` };
}

/**
 * A sector's office, built from its real records: active (non-archived)
 * businesses become rooms, and the sector's agents become the employees.
 * Live activity arrives through the authenticated event stream.
 */
export default async function SectorOfficePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await getDatabase();
  const org = db ? await getDashboardOrganization(db) : null;
  if (!db || !org) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <DatabaseSetupNotice />
      </main>
    );
  }
  const input = await loadSectorFloorInput(db, org.id, slug);
  if (!input) notFound();
  return <SectorOffice input={input} testData={org.isTestData} />;
}
