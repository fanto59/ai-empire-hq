import type { OfficeScene } from "./scene";

/**
 * Imperative renderer contract for engines that own a canvas (PixiJS).
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
 * Future: `pixi` resolves to `() => import("./pixi/pixi-renderer")`.
 * PixiJS is intentionally NOT installed yet (see docs/VIRTUAL_OFFICE.md).
 */
export const AVAILABLE_RENDERERS: readonly OfficeRendererKind[] = ["svg-preview"];
