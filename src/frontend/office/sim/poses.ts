import type { CharacterState, Posture } from "./types";

/**
 * PROCEDURAL POSES - one pure function shared by all characters, so every
 * character animates consistently. Inputs are the state, posture, and time;
 * the output is a small set of joint transforms the renderer applies to the
 * character's parts. No allocations: callers pass a reusable Pose object.
 *
 * Angles are radians, offsets are pixels at zoom 1. Positive arm/leg
 * rotation swings the limb toward the character's facing direction.
 */
export interface Pose {
  /** Whole-body vertical offset (bobbing, sitting down). */
  bodyY: number;
  torsoScaleY: number;
  headY: number;
  headTilt: number;
  armFront: number;
  armBack: number;
  legFront: number;
  legBack: number;
  /** 0..1 strength of the state badge pulse. */
  badgePulse: number;
  /** Speech-bubble dot phase for collaborating (0..3). */
  talkPhase: number;
}

export function createPose(): Pose {
  return {
    bodyY: 0,
    torsoScaleY: 1,
    headY: 0,
    headTilt: 0,
    armFront: 0,
    armBack: 0,
    legFront: 0,
    legBack: 0,
    badgePulse: 0,
    talkPhase: 0,
  };
}

const SEATED_DROP = 5;
const SEATED_LEG = 1.25;

/**
 * @param t       seconds since the simulation started (continuous clock)
 * @param tState  seconds since the current state began
 * @param phase   per-character offset so characters don't move in lockstep
 * @param motion  0..1 motion scale (reduced-motion users get a lower value)
 */
export function computePose(
  out: Pose,
  state: CharacterState,
  posture: Posture,
  t: number,
  tState: number,
  phase: number,
  motion = 1,
): Pose {
  const breathe = Math.sin((t + phase) * 2.1) * 0.6 * motion;
  const seated = posture === "sit" && state !== "walking";

  out.bodyY = seated ? SEATED_DROP : 0;
  out.torsoScaleY = 1;
  out.headY = breathe * 0.5;
  out.headTilt = 0;
  out.armFront = 0.06 + breathe * 0.03;
  out.armBack = -0.06 - breathe * 0.03;
  out.legFront = seated ? SEATED_LEG : 0;
  out.legBack = seated ? SEATED_LEG : 0;
  out.badgePulse = 0;
  out.talkPhase = 0;

  switch (state) {
    case "idle":
    case "sitting":
      out.bodyY += breathe * 0.4;
      break;

    case "walking": {
      const stride = Math.sin((t + phase) * 9.5);
      out.legFront = 0.5 * stride * motion;
      out.legBack = -0.5 * stride * motion;
      out.armFront = -0.42 * stride * motion;
      out.armBack = 0.42 * stride * motion;
      out.bodyY = -Math.abs(stride) * 1.6 * motion;
      break;
    }

    case "working": {
      if (seated) {
        // Typing: forearms forward, quick alternating taps, head slightly down.
        const tap = Math.sin((t + phase) * 16) * 0.07 * motion;
        out.armFront = 1.05 + tap;
        out.armBack = 1.05 - tap;
        out.headY = 0.8;
        out.headTilt = 0.05;
      } else {
        // Writing on the board: front arm raised and moving in small arcs.
        out.armFront = 2.3 + Math.sin((t + phase) * 3.4) * 0.18 * motion;
        out.armBack = -0.05;
        out.headTilt = -0.06;
      }
      break;
    }

    case "collaborating": {
      // Conversational gestures with a slow head turn.
      out.armFront = 0.9 + Math.sin((t + phase) * 2.7) * 0.45 * motion;
      out.armBack = seated ? 0.6 : -0.1 + Math.sin((t + phase) * 1.9) * 0.12 * motion;
      out.headTilt = Math.sin((t + phase) * 1.3) * 0.08 * motion;
      out.talkPhase = ((t * 2.2) % 3) * motion;
      break;
    }

    case "waiting-approval": {
      // Still and attentive; the amber badge carries the signal.
      out.armFront = 0.25;
      out.armBack = -0.25;
      out.badgePulse = 0.5 + 0.5 * Math.sin(t * 4.2);
      if (!seated) out.legFront = Math.max(0, Math.sin(t * 6)) * 0.12 * motion; // foot tap
      break;
    }

    case "completed": {
      // Brief raise of both arms, settling after ~0.9 s.
      const lift = tState < 0.9 ? Math.sin((tState / 0.9) * Math.PI) : 0;
      out.armFront = 0.1 + lift * 2.4;
      out.armBack = -0.1 - lift * 0.4;
      out.bodyY += -lift * 2 * motion;
      out.badgePulse = Math.max(0, 1 - tState / 1.5);
      break;
    }

    case "failed": {
      // Slumped: head down, shoulders compressed, arms hanging.
      out.headY = 2.2;
      out.headTilt = 0.2;
      out.torsoScaleY = 0.95;
      out.armFront = -0.02;
      out.armBack = 0.02;
      out.badgePulse = 0.5 + 0.5 * Math.sin(t * 5.5);
      break;
    }
  }
  return out;
}
