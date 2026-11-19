import type { AgentExecutionEvent, DerivedAgentActivity } from "./types";

/**
 * Pure reducer: derives an agent's displayed activity from its most recent
 * real event. No event => "offline". This is what the virtual office uses to
 * pick animations, so the office can only ever reflect real execution.
 */
export function deriveActivity(latest: AgentExecutionEvent | undefined): DerivedAgentActivity {
  if (!latest) return "offline";
  switch (latest.type) {
    case "run.started":
    case "run.step":
    case "message.created":
    case "tool.result":
    case "approval.resolved":
      return "thinking";
    case "tool.called":
      return "using-tool";
    case "approval.requested":
      return "awaiting-approval";
    case "run.failed":
      return "error";
    case "run.completed":
    case "run.canceled":
    case "agent.handoff":
      return "idle";
  }
}
