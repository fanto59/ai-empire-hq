import type { SimScript, SimTask } from "./types";

/**
 * Scripted, looping scenarios. These are PLAYBACK, not intelligence: every
 * line below is hand-written demo content, and each step's events carry
 * origin "simulation".
 *
 * Together the three loops exercise all eight character states.
 */
export const SIM_TASKS: readonly SimTask[] = [
  { id: "t-priorities", title: "Review sector priorities", ownerId: "sim-chief", status: "todo" },
  { id: "t-budget", title: "Approve research budget", ownerId: "sim-chief", status: "todo" },
  { id: "t-plan", title: "Update executive plan", ownerId: "sim-pm", status: "todo" },
  { id: "t-board", title: "Groom project board", ownerId: "sim-pm", status: "todo" },
  { id: "t-scan", title: "Market scan: sector candidates", ownerId: "sim-research", status: "todo" },
  { id: "t-summary", title: "Summarize findings", ownerId: "sim-research", status: "todo" },
];

export const SIM_SCRIPTS: readonly SimScript[] = [
  {
    characterId: "sim-chief",
    steps: [
      { kind: "activity", state: "sitting", durationMs: 2500, note: "Settling in at the executive desk" },
      {
        kind: "activity",
        state: "working",
        durationMs: 6500,
        note: "Reviewing sector priorities",
        taskId: "t-priorities",
        emit: { type: "run.started" },
      },
      { kind: "goto", waypoint: "conf.head", note: "Heading to the conference room" },
      {
        kind: "activity",
        state: "collaborating",
        durationMs: 8000,
        note: "Aligning priorities with VEGA",
        taskId: "t-priorities",
        emit: { type: "message.created", text: "Proposes this week's focus: research pipeline." },
      },
      { kind: "goto", waypoint: "board.left", note: "Walking to the project board" },
      { kind: "activity", state: "idle", durationMs: 2500, note: "Reading the project board" },
      {
        kind: "activity",
        state: "waiting-approval",
        durationMs: 6000,
        note: "Waiting for owner approval",
        taskId: "t-budget",
        emit: {
          type: "approval.requested",
          action: "Allocate research budget",
          reason: "Spending requires human approval",
        },
      },
      {
        kind: "activity",
        state: "completed",
        durationMs: 2600,
        note: "Approval granted (simulated)",
        taskId: "t-budget",
        emit: { type: "run.completed", summary: "Priorities and budget confirmed." },
      },
      { kind: "goto", waypoint: "chief.window", note: "Stepping to the window" },
      { kind: "activity", state: "idle", durationMs: 3000, note: "Taking a moment at the window" },
      { kind: "goto", waypoint: "chief.desk", note: "Returning to the executive desk" },
    ],
  },
  {
    characterId: "sim-pm",
    steps: [
      {
        kind: "activity",
        state: "working",
        durationMs: 5500,
        note: "Updating the executive plan",
        taskId: "t-plan",
        emit: { type: "run.started" },
      },
      { kind: "activity", state: "sitting", durationMs: 1500, note: "Checking the calendar" },
      { kind: "goto", waypoint: "conf.south-b", note: "Heading to the conference room" },
      {
        kind: "activity",
        state: "collaborating",
        durationMs: 8000,
        note: "Planning with ORION",
        taskId: "t-plan",
        emit: { type: "message.created", text: "Breaks the focus into three projects." },
      },
      { kind: "goto", waypoint: "board.right", note: "Walking to the project board" },
      {
        kind: "activity",
        state: "working",
        durationMs: 5500,
        note: "Moving cards on the project board",
        taskId: "t-board",
        emit: { type: "tool.called", tool: "board.update", inputSummary: "Reorder backlog (simulated)" },
      },
      { kind: "goto", waypoint: "research.side", note: "Visiting the research department" },
      {
        kind: "activity",
        state: "collaborating",
        durationMs: 5000,
        note: "Checking in with LYRA",
        taskId: "t-board",
        emit: { type: "message.created", text: "Asks for the market scan summary." },
      },
      {
        kind: "activity",
        state: "completed",
        durationMs: 2200,
        note: "Board groomed",
        taskId: "t-board",
        emit: { type: "run.completed", summary: "Board and plan updated." },
      },
      { kind: "goto", waypoint: "pm.desk", note: "Returning to the PM office" },
    ],
  },
  {
    characterId: "sim-research",
    steps: [
      {
        kind: "activity",
        state: "working",
        durationMs: 7000,
        note: "Running a market scan",
        taskId: "t-scan",
        emit: { type: "tool.called", tool: "research.search", inputSummary: "Sector candidates (simulated)" },
      },
      {
        kind: "activity",
        state: "failed",
        durationMs: 3500,
        note: "Source unavailable",
        taskId: "t-scan",
        emit: { type: "run.failed", errorCode: "SIM_SOURCE_UNAVAILABLE", message: "Simulated source timeout." },
      },
      { kind: "activity", state: "sitting", durationMs: 2000, note: "Preparing a retry" },
      {
        kind: "activity",
        state: "working",
        durationMs: 6000,
        note: "Retrying with a cached source",
        taskId: "t-scan",
        emit: { type: "run.step", summary: "Retry with cached source (simulated)." },
      },
      {
        kind: "activity",
        state: "completed",
        durationMs: 2400,
        note: "Market scan complete",
        taskId: "t-scan",
        emit: { type: "run.completed", summary: "Three sector candidates shortlisted." },
      },
      {
        kind: "activity",
        state: "waiting-approval",
        durationMs: 5000,
        note: "Waiting to publish findings",
        taskId: "t-summary",
        emit: {
          type: "approval.requested",
          action: "Publish findings to the project board",
          reason: "Publishing requires human approval",
        },
      },
      { kind: "goto", waypoint: "board.center", note: "Walking to the project board" },
      {
        kind: "activity",
        state: "collaborating",
        durationMs: 6000,
        note: "Presenting findings at the board",
        taskId: "t-summary",
        emit: { type: "message.created", text: "Presents the shortlist." },
      },
      {
        kind: "activity",
        state: "completed",
        durationMs: 2200,
        note: "Findings published",
        taskId: "t-summary",
        emit: { type: "run.completed", summary: "Findings published (simulated)." },
      },
      { kind: "goto", waypoint: "research.desk", note: "Returning to workstation R-2" },
    ],
  },
];
