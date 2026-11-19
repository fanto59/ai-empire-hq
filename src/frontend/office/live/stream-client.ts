import type { LiveEvent, LiveHealth, LiveSnapshot } from "@/domain/live-office";
import type { ConnectionStatus } from "./director";

/**
 * Browser side of the authenticated live stream (Server-Sent Events).
 *
 * - The dashboard session cookie (httpOnly) authenticates the request; no
 *   token ever reaches page scripts.
 * - EventSource reconnects by itself and sends Last-Event-ID, so missed
 *   events are replayed by the server. If the connection is closed for good
 *   (server restart, network change), we reconnect with `?after=<last id>`
 *   and exponential backoff. A 401/403 stops retrying ("unauthorized").
 * - Going offline (navigator) shows "offline"; coming back reconnects.
 */
export interface LiveSink {
  applySnapshot(s: LiveSnapshot): void;
  ingest(e: LiveEvent): unknown;
  applyHealth(h: LiveHealth): void;
  setConnection(s: ConnectionStatus): void;
}

export interface StreamClientOptions {
  url?: string;
  EventSourceImpl?: typeof EventSource;
  fetchImpl?: typeof fetch;
  maxBackoffMs?: number;
}

export function connectLiveStream(sink: LiveSink, opts: StreamClientOptions = {}): () => void {
  const url = opts.url ?? "/api/v1/events/stream";
  const ES = opts.EventSourceImpl ?? EventSource;
  const doFetch = opts.fetchImpl ?? fetch;
  let es: EventSource | null = null;
  let lastId: string | null = null;
  let stopped = false;
  let backoff = 1_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped per connection, so a late probe of an old connection can't override a newer one. */
  let generation = 0;

  /** Data arriving means the stream works - unless the browser says it is offline. */
  const markLive = () => {
    if (typeof navigator === "undefined" || navigator.onLine !== false) sink.setConnection("live");
  };

  const parse = <T,>(ev: MessageEvent): T | null => {
    try {
      return JSON.parse(String(ev.data)) as T;
    } catch {
      return null;
    }
  };

  const open = () => {
    if (stopped) return;
    const gen = ++generation;
    sink.setConnection(lastId ? "reconnecting" : "connecting");
    const src = new ES(lastId ? `${url}?after=${encodeURIComponent(lastId)}` : url, { withCredentials: true });
    es = src;
    src.onopen = () => {
      backoff = 1_000;
      markLive();
    };
    src.addEventListener("snapshot", (ev) => {
      const s = parse<LiveSnapshot>(ev as MessageEvent);
      if (!s) return;
      lastId = (ev as MessageEvent).lastEventId || String(s.cursor);
      sink.applySnapshot(s);
      markLive();
    });
    src.addEventListener("agent-event", (ev) => {
      const e = parse<LiveEvent>(ev as MessageEvent);
      if (!e) return;
      markLive(); // data is flowing
      lastId = (ev as MessageEvent).lastEventId || String(e.streamId);
      sink.ingest(e);
    });
    src.addEventListener("health", (ev) => {
      const h = parse<LiveHealth>(ev as MessageEvent);
      if (!h) return;
      markLive();
      sink.applyHealth(h);
    });
    src.addEventListener("stream-error", () => sink.setConnection("reconnecting"));
    src.onerror = () => {
      if (stopped || gen !== generation) return;
      if (src.readyState === ES.CONNECTING) {
        sink.setConnection("reconnecting"); // the browser retries with Last-Event-ID
        return;
      }
      // Closed for good: find out why before retrying.
      src.close();
      void (async () => {
        let status = 0;
        try {
          const ctl = new AbortController();
          const r = await doFetch(url, { credentials: "same-origin", signal: ctl.signal, headers: { accept: "text/event-stream" } });
          status = r.status;
          ctl.abort();
        } catch {
          status = 0;
        }
        if (stopped || gen !== generation) return; // a newer connection exists
        if (status === 401 || status === 403) {
          sink.setConnection("unauthorized");
          return;
        }
        sink.setConnection(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "reconnecting");
        timer = setTimeout(open, backoff);
        backoff = Math.min(backoff * 2, opts.maxBackoffMs ?? 30_000);
      })();
    };
  };

  const onOffline = () => sink.setConnection("offline");
  const onOnline = () => {
    if (es && es.readyState === ES.OPEN) return;
    es?.close();
    clearTimeout(timer);
    backoff = 1_000;
    open();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
  }
  open();

  return () => {
    stopped = true;
    clearTimeout(timer);
    es?.close();
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    }
  };
}
