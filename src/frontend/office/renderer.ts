import type { OfficeScene } from "./scene";

/**
 * Generic scene-renderer contract for data-driven floors (e.g. future sector
 * floors built from real Business/AgentProfile records via buildOfficeScene).
 * The Executive Floor prototype uses the richer `ExecutiveFloorHandle` in
 * pixi/executive-floor-renderer.ts; both follow the same rules below.
 *
 * Lifecycle (driven by <OfficeViewport>):
 *   mount(container) -> update(scene)* -> resize(w, h)* -> destroy()
 *
 * Rules for implementations:
 * - Client-only. Load via dynamic import() inside a "use client" component so
 *   the engine never runs during server rendering and stays out of the
 *   initial JS bundle.
 * - Treat the scene as immutable input; diff internally if needed.
 * - destroy() must release GPU resources, tickers, and listeners.
 * - Emit interactions (e.g. avatar clicked) through `onSelect`, never by
 *   mutating app state directly.
 */
export interface OfficeRendererOptions {
  onSelectAgent?: (agentId: string) => void;
}

export interface OfficeRenderer {
  mount(container: HTMLElement, options?: OfficeRendererOptions): Promise<void>;
  update(scene: OfficeScene): void;
  resize(width: number, height: number): void;
  destroy(): void;
}

export type OfficeRendererKind = "svg-preview" | "pixi";

/**
 * - svg-preview: static, server-rendered floor plan (HQ dashboard).
 * - pixi: the interactive Executive Floor (`pixi/executive-floor-renderer.ts`),
 *   loaded with a dynamic import by `executive-floor/FloorCanvas.tsx`.
 */
export const AVAILABLE_RENDERERS: readonly OfficeRendererKind[] = ["svg-preview", "pixi"];
