import type { SimScript } from "./types";

/**
 * Scripted, looping scenarios. These are PLAYBACK, not intelligence: every
 * line below is hand-written demo content, and each step's events carry
 * origin "simulation".
 *
 * Together the three loops exercise all eight character states.
 */
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
        emit: { type: "run.started" },
      },
      { kind: "goto", waypoint: "conf.head", note: "Heading to the conference room" },
      {
        kind: "activity",
        state: "collaborating",
        durationMs: 8000,
        note: "Aligning priorities with VEGA",
        emit: { type: "message.created", text: "Proposes this week's focus: research pipeline." },
      },
      { kind: "goto", waypoint: "board.left", note: "Walking to the project board" },
      { kind: "activity", state: "idle", durationMs: 2500, note: "Reading the project board" },
      {
        kind: "activity",
        state: "waiting-approval",
        durationMs: 6000,
        note: "Waiting for owner approval",
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
        emit: { type: "run.started" },
      },
      { kind: "activity", state: "sitting", durationMs: 1500, note: "Checking the calendar" },
      { kind: "goto", waypoint: "conf.south-b", note: "Heading to the conference room" },
      {
        kind: "activity",
        state: "collaborating",
        durationMs: 8000,
        note: "Planning with ORION",
        emit: { type: "message.created", text: "Breaks the focus into three projects." },
      },
      { kind: "goto", waypoint: "board.right", note: "Walking to the project board" },
      {
        kind: "activity",
        state: "working",
        durationMs: 5500,
        note: "Moving cards on the project board",
        emit: { type: "tool.called", tool: "board.update", inputSummary: "Reorder backlog (simulated)" },
      },
      { kind: "goto", waypoint: "research.side", note: "Visiting the research department" },
      {
        kind: "activity",
        state: "collaborating",
        durationMs: 5000,
        note: "Checking in with LYRA",
        emit: { type: "message.created", text: "Asks for the market scan summary." },
      },
      {
        kind: "activity",
        state: "completed",
        durationMs: 2200,
        note: "Board groomed",
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
        emit: { type: "tool.called", tool: "research.search", inputSummary: "Sector candidates (simulated)" },
      },
      {
        kind: "activity",
        state: "failed",
        durationMs: 3500,
        note: "Source unavailable",
        emit: { type: "run.failed", errorCode: "SIM_SOURCE_UNAVAILABLE", message: "Simulated source timeout." },
      },
      { kind: "activity", state: "sitting", durationMs: 2000, note: "Preparing a retry" },
      {
        kind: "activity",
        state: "working",
        durationMs: 6000,
        note: "Retrying with a cached source",
        emit: { type: "run.step", summary: "Retry with cached source (simulated)." },
      },
      {
        kind: "activity",
        state: "completed",
        durationMs: 2400,
        note: "Market scan complete",
        emit: { type: "run.completed", summary: "Three sector candidates shortlisted." },
      },
      {
        kind: "activity",
        state: "waiting-approval",
        durationMs: 5000,
        note: "Waiting to publish findings",
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
        emit: { type: "message.created", text: "Presents the shortlist." },
      },
      {
        kind: "activity",
        state: "completed",
        durationMs: 2200,
        note: "Findings published",
        emit: { type: "run.completed", summary: "Findings published (simulated)." },
      },
      { kind: "goto", waypoint: "research.desk", note: "Returning to workstation R-2" },
    ],
  },
];
