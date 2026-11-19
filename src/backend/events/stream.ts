import type { Db } from "@/infrastructure/db/client";
import { authenticate } from "../auth/api-tokens";
import type { RequestContext } from "../auth/context";
import { ServiceError } from "../errors";
import { currentCursor, loadHealth, loadSnapshot, readEventsAfter } from "./live-feed";

/**
 * AUTHENTICATED LIVE EVENT STREAM (Server-Sent Events)
 *
 *   GET /api/v1/events/stream        (dashboard session cookie or Bearer token, tasks:read)
 *
 * Messages:
 *   event: snapshot     id: <cursor>    full picture (on connect / large gap)
 *   event: agent-event  id: <streamId>  one stored execution event
 *   event: health                       run health + cost + task state (every few seconds)
 *   : ping                              keep-alive comment
 *
 * Browser refresh: a new connection gets a snapshot (replayed events).
 * Disconnects: EventSource reconnects with Last-Event-ID; the server sends
 * the events missed since that id (or a fresh snapshot when > MAX_GAP).
 * The connection closes itself after `maxMs`; the browser reconnects.
 */
export interface StreamOptions {
  lastEventId?: number | null;
  signal?: AbortSignal;
  pollMs?: number;
  healthMs?: number;
  pingMs?: number;
  maxMs?: number;
  now?: () => Date;
}

export const MAX_GAP = 500;
const IMMEDIATE_HEALTH = new Set(["run.started", "approval.requested", "approval.resolved", "run.completed", "run.failed", "run.canceled"]);
const LOOKBACK = 50;

export function createLiveStream(db: Db, ctx: RequestContext, opts: StreamOptions = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const now = opts.now ?? (() => new Date());
  const pollMs = opts.pollMs ?? 1_000;
  const healthMs = opts.healthMs ?? 5_000;
  const pingMs = opts.pingMs ?? 15_000;
  const maxMs = opts.maxMs ?? 10 * 60_000;
  const sent = new Set<number>();
  const runIds = new Set<string>();
  const taskIds = new Set<string>();
  let cursor = 0;
  let closed = false;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      opts.signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
    });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => {
        if (!closed) controller.enqueue(enc.encode(text));
      };
      const message = (event: string, data: unknown, id?: number) => write(`${id !== undefined ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      const remember = (runId: string, taskId: string) => {
        runIds.add(runId);
        taskIds.add(taskId);
        if (runIds.size > 200) runIds.delete(runIds.values().next().value!);
        if (taskIds.size > 200) taskIds.delete(taskIds.values().next().value!);
      };
      const sendSnapshot = async () => {
        const snap = await loadSnapshot(db, ctx, now());
        cursor = snap.cursor;
        sent.clear();
        for (const e of snap.events) {
          sent.add(e.streamId);
          remember(e.runId, e.taskId);
        }
        for (const r of snap.runs) remember(r.runId, r.taskId);
        message("snapshot", snap, snap.cursor);
      };
      const sendNew = async (origin: "live" | "replay") => {
        const events = await readEventsAfter(db, ctx, cursor, { lookback: LOOKBACK, limit: 300, origin });
        for (const e of events) {
          if (sent.has(e.streamId)) continue;
          sent.add(e.streamId);
          remember(e.runId, e.taskId);
          cursor = Math.max(cursor, e.streamId);
          message("agent-event", e, e.streamId);
        }
        if (sent.size > 2_000) for (const id of [...sent].sort((a, b) => a - b).slice(0, 1_000)) sent.delete(id);
        return events.some((e) => IMMEDIATE_HEALTH.has(e.type));
      };
      const sendHealth = async () => message("health", await loadHealth(db, ctx, [...runIds], [...taskIds], now()));

      try {
        write("retry: 3000\n\n");
        const last = opts.lastEventId;
        if (last !== null && last !== undefined && Number.isSafeInteger(last) && last >= 0) {
          // Reconnect: replay what was missed, unless the gap is too large.
          const head = await currentCursor(db, ctx);
          const missed = (await readEventsAfter(db, ctx, last, { limit: MAX_GAP + 1 })).length;
          if (head < last || missed > MAX_GAP) await sendSnapshot();
          else {
            // Events at or before the client's last id were delivered already:
            // mark the lookback window as sent so only missed events go out.
            for (const e of await readEventsAfter(db, ctx, last, { lookback: LOOKBACK, limit: LOOKBACK })) if (e.streamId <= last) sent.add(e.streamId);
            cursor = last;
            await sendNew("replay");
            await sendHealth();
          }
        } else {
          await sendSnapshot();
        }

        const started = Date.now();
        let lastHealth = Date.now();
        let lastPing = Date.now();
        while (!closed && !opts.signal?.aborted && Date.now() - started < maxMs) {
          await sleep(pollMs);
          if (opts.signal?.aborted) break;
          const changedTask = await sendNew("live");
          // Task state changes with these events: refresh it now instead of waiting for the timer.
          if (changedTask || Date.now() - lastHealth >= healthMs) {
            await sendHealth();
            // After a lifecycle event, check again ~1s later: the worker updates the task right after its event.
            lastHealth = changedTask ? Date.now() - healthMs + 1_000 : Date.now();
          }
          if (Date.now() - lastPing >= pingMs) {
            write(": ping\n\n");
            lastPing = Date.now();
          }
        }
      } catch (e) {
        if (!opts.signal?.aborted) {
          console.error("[live-stream] stopped:", e instanceof Error ? e.message : e);
          message("stream-error", { message: "The live stream hit a server error and will reconnect." });
        }
      } finally {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
}

/**
 * HTTP handler (framework-agnostic). `sessionContext` resolves the dashboard
 * cookie session; a Bearer token works too (same rules as the task API).
 */
export async function handleLiveStream(
  deps: { db: Db | null; sessionContext: (db: Db) => Promise<RequestContext | null>; streamOptions?: Omit<StreamOptions, "lastEventId" | "signal"> },
  req: Request,
): Promise<Response> {
  const fail = (status: number, message: string) => new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (!deps.db) return fail(503, "The database is not configured.");
  let ctx: RequestContext | null;
  try {
    ctx = req.headers.get("authorization") ? await authenticate(deps.db, req.headers.get("authorization")) : await deps.sessionContext(deps.db);
  } catch (e) {
    if (e instanceof ServiceError) return fail(e.status, e.message);
    throw e;
  }
  if (!ctx) return fail(401, "Sign in to see live agent activity.");
  if (!ctx.scopes.has("tasks:read")) return fail(403, "This token lacks the tasks:read scope.");

  const url = new URL(req.url);
  const raw = req.headers.get("last-event-id") ?? url.searchParams.get("after");
  const lastEventId = raw !== null && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
  const stream = createLiveStream(deps.db, ctx, { ...deps.streamOptions, lastEventId, signal: req.signal });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
