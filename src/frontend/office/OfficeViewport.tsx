import { SvgOfficePreview } from "./SvgOfficePreview";
import type { OfficeScene } from "./scene";

/**
 * Stable entry point for the virtual office. Pages render <OfficeViewport>
 * and never a specific engine. When PixiJS lands, this component gains a
 * client-side branch that dynamically imports the Pixi renderer and falls
 * back to the SVG preview (e.g. no WebGL, reduced-motion, server render).
 */
export function OfficeViewport({ scene }: { scene: OfficeScene }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 p-4">
      <SvgOfficePreview scene={scene} />
    </div>
  );
}
