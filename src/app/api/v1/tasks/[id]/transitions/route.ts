import * as api from "@/backend/api/tasks-api";
import { getDatabase } from "@/backend/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return api.transitionTask({ db: await getDatabase() }, req, (await params).id);
}
