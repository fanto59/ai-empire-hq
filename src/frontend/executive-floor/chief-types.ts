import type { TaskState } from "@/domain/task-lifecycle";
import type { PlanData } from "../tasks/PlanView";

/** Server-provided data for the Chief AI Manager panel (plain, serializable). */
export interface ChiefObjectiveView {
  taskId: string;
  goal: string;
  state: TaskState;
  costMicros: number;
  lastError: string | null;
  updatedAt: string;
  events: { id: string; type: string; text: string; tool: string | null; at: string }[];
  plan: PlanData | null;
  briefingPath: string | null;
  requestedWork: string[];
}

export interface ChiefPanelData {
  /** The Chief AI Manager agent exists and holds org.read. */
  agentReady: boolean;
  providerReady: boolean;
  providerReason: string;
  workerInProcess: boolean;
  signedIn: boolean;
  orgBudget: { limitMicros: number; spentMicros: number } | null;
  objectives: ChiefObjectiveView[];
}

export interface GoalFormState {
  ok: boolean;
  message: string | null;
  taskId: string | null;
}

export type SubmitGoalAction = (prev: GoalFormState, form: FormData) => Promise<GoalFormState>;
