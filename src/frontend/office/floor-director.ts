import type { CharacterRuntime } from "./sim/types";

/**
 * What the PixiJS renderer needs from whatever drives the characters: the
 * scripted SimulationDirector or the LiveDirector (real events). Movement is
 * computed in the browser by `tick`; nothing per-frame ever calls a model.
 */
export interface FloorDirector {
  tick(dtMs: number): void;
  getSimTimeMs(): number;
  runtimes(): readonly CharacterRuntime[];
  getRuntime(id: string): CharacterRuntime | undefined;
}
