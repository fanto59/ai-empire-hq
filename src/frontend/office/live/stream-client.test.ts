import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConnectionStatus } from "./director";
import { connectLiveStream, type LiveSink } from "./stream-client";

/** Browser stream client against a fake EventSource: wiring, auth, reconnect with the last id. */
class FakeES {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeES[] = [];
  readyState = FakeES.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((ev: { data: string; lastEventId: string }) => void)[]>();
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeES.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: { data: string; lastEventId: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = FakeES.CLOSED;
  }
  open() {
    this.readyState = FakeES.OPEN;
    this.onopen?.();
  }
  emit(type: string, data: unknown, id = "") {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data), lastEventId: id });
  }
  fail(closed: boolean) {
    this.readyState = closed ? FakeES.CLOSED : FakeES.CONNECTING;
    this.onerror?.();
  }
}

function sink() {
  const log: string[] = [];
  const statuses: ConnectionStatus[] = [];
  const s: LiveSink = {
    applySnapshot: (x) => log.push(`snapshot:${x.cursor}`),
    ingest: (e) => log.push(`event:${e.streamId}`),
    applyHealth: () => log.push("health"),
    setConnection: (c) => statuses.push(c),
  };
  return { s, log, statuses };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test("stream client: snapshot, events and health reach the director; status follows the connection", () => {
  FakeES.instances = [];
  const k = sink();
  const stop = connectLiveStream(k.s, { EventSourceImpl: FakeES as unknown as typeof EventSource, fetchImpl: (async () => new Response(null, { status: 200 })) as typeof fetch });
  const es = FakeES.instances[0]!;
  assert.equal(es.url, "/api/v1/events/stream");
  es.open();
  es.emit("snapshot", { cursor: 7, agents: [], events: [], tasks: [], runs: [], serverTime: "" }, "7");
  es.emit("agent-event", { streamId: 8 }, "8");
  es.emit("health", { serverTime: "", tasks: [], runs: [] });
  assert.deepEqual(k.log, ["snapshot:7", "event:8", "health"]);
  assert.equal(k.statuses.at(-1), "live");
  es.fail(false); // the browser retries by itself with Last-Event-ID
  assert.equal(k.statuses.at(-1), "reconnecting");
  stop();
  assert.equal(es.readyState, FakeES.CLOSED);
});

test("stream client: a closed connection reconnects with ?after=<last id>; 401 stops retrying", async () => {
  FakeES.instances = [];
  const k = sink();
  let status = 503;
  const stop = connectLiveStream(k.s, { EventSourceImpl: FakeES as unknown as typeof EventSource, fetchImpl: (async () => new Response(null, { status })) as typeof fetch, maxBackoffMs: 1 });
  const es = FakeES.instances[0]!;
  es.open();
  es.emit("agent-event", { streamId: 42 }, "42");
  es.fail(true);
  await tick();
  await new Promise((r) => setTimeout(r, 1_100)); // first backoff is 1s
  const second = FakeES.instances[1]!;
  assert.equal(second.url, "/api/v1/events/stream?after=42", "missed events are requested from the last id");
  status = 401;
  second.fail(true);
  await tick();
  assert.equal(k.statuses.at(-1), "unauthorized");
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(FakeES.instances.length, 2, "no retries after 401");
  stop();
});
