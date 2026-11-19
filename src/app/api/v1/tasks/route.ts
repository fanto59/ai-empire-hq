import * as api from "@/backend/api/tasks-api";
import { getDatabase } from "@/backend/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return api.listTasks({ db: await getDatabase() }, req);
}

export async function POST(req: Request) {
  return api.createTask({ db: await getDatabase() }, req);
}
