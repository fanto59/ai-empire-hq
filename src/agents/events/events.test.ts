import assert from "node:assert/strict";
import { test } from "node:test";
import { createInMemoryEventBus } from "@/backend/events/event-bus";
import { deriveActivity } from "./derive";
import type { AgentExecutionEvent, EventOrigin } from "./types";
import { validateAgentEvent } from "./validate";

function event(origin: EventOrigin = "live"): AgentExecutionEvent {
  return {
    schemaVersion: 1,
    id: "e1",
    type: "tool.called",
    origin,
    occurredAt: "2026-01-01T00:00:00.000Z",
    sequence: 0,
    runId: "r1",
    agentId: "a1",
    businessId: null,
    projectId: null,
    taskId: null,
    payload: { toolCallId: "c1", tool: "search", inputSummary: "x" },
  } as AgentExecutionEvent;
}

test("validator accepts a well-formed event", () => {
  assert.equal(validateAgentEvent(event()).ok, true);
});

test("validator rejects malformed events", () => {
  assert.equal(validateAgentEvent(null).ok, false);
  assert.equal(validateAgentEvent({ ...event(), origin: "made-up" }).ok, false);
  assert.equal(validateAgentEvent({ ...event(), type: "nope" }).ok, false);
  assert.equal(validateAgentEvent({ ...event(), occurredAt: "yesterday" }).ok, false);
  assert.equal(validateAgentEvent({ ...event(), sequence: -1 }).ok, false);
});

test("deriveActivity maps events to activity and defaults to offline", () => {
  assert.equal(deriveActivity(undefined), "offline");
  assert.equal(deriveActivity(event()), "using-tool");
});

test("event bus never delivers simulation events to the backend", () => {
  const bus = createInMemoryEventBus();
  const received: string[] = [];
  bus.subscribe({}, (e) => received.push(e.origin));
  bus.publish(event("simulation"));
  bus.publish(event("live"));
  assert.deepEqual(received, ["live"]);
});

test("event bus filters by business", () => {
  const bus = createInMemoryEventBus();
  const received: unknown[] = [];
  bus.subscribe({ businessId: "b1" as never }, (e) => received.push(e.businessId));
  bus.publish(event());
  bus.publish({ ...event(), businessId: "b1" as never });
  assert.deepEqual(received, ["b1"]);
});
