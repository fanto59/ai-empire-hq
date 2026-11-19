import type { BusinessId } from "@/domain/ids";
import type { AgentExecutionEvent } from "@/agents/events";

/**
 * Transport-agnostic event bus for agent execution events.
 *
 * Today: an in-process implementation (single server instance, no
 * persistence). Later: swap for a durable broker (e.g. Postgres LISTEN/NOTIFY,
 * Redis streams, or a managed queue) behind the same interface - no caller
 * changes needed.
 */
export interface EventFilter {
  /** Business isolation: subscribers only ever receive their scope. */
  businessId?: BusinessId | null;
}

export type EventHandler = (event: AgentExecutionEvent) => void;

export interface AgentEventBus {
  publish(event: AgentExecutionEvent): void;
  subscribe(filter: EventFilter, handler: EventHandler): () => void;
}

export function createInMemoryEventBus(): AgentEventBus {
  const subscribers = new Set<{ filter: EventFilter; handler: EventHandler }>();

  return {
    publish(event) {
      // Rule: "test" events are never delivered outside test code paths.
      if (event.origin === "test" && process.env.NODE_ENV === "production") return;
      for (const sub of subscribers) {
        if (sub.filter.businessId !== undefined && sub.filter.businessId !== event.businessId) continue;
        sub.handler(event);
      }
    },
    subscribe(filter, handler) {
      const entry = { filter, handler };
      subscribers.add(entry);
      return () => {
        subscribers.delete(entry);
      };
    },
  };
}
