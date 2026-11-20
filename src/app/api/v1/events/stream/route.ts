import { getSessionContext } from "@/backend/auth/session";
import { getDatabase } from "@/backend/db";
import { handleLiveStream } from "@/backend/events/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Authenticated Server-Sent Events stream of real agent execution events. */
export async function GET(req: Request) {
  return handleLiveStream({ db: await getDatabase(), sessionContext: getSessionContext }, req);
}
