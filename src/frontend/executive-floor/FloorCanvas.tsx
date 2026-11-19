"use client";

import { useEffect, useRef, useState } from "react";
import type { FloorHotspot, FloorPlan } from "../office/floor/types";
import type { ExecutiveFloorHandle } from "../office/pixi/executive-floor-renderer";
import type { FloorDirector } from "../office/floor-director";
import type { PrototypeCharacter } from "../office/sim/types";

/**
 * Mounts the PixiJS renderer client-side only. PixiJS is loaded with a
 * dynamic import so it never runs during server rendering and stays out of
 * the initial JavaScript bundle.
 */
export interface FloorCanvasProps {
  plan: FloorPlan;
  cast: readonly PrototypeCharacter[];
  director: FloorDirector;
  onReady: (handle: ExecutiveFloorHandle | null) => void;
  onSelectCharacter: (id: string | null) => void;
  onHotspot: (hotspot: FloorHotspot) => void;
  /** Accessible description of what the canvas shows. */
  label?: string;
  mode?: "live" | "simulation";
}

export function FloorCanvas({ plan, cast, director, onReady, onSelectCharacter, onHotspot, label, mode = "simulation" }: FloorCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Keep callbacks fresh without re-creating the renderer.
  const callbacks = useRef({ onReady, onSelectCharacter, onHotspot });
  useEffect(() => {
    callbacks.current = { onReady, onSelectCharacter, onHotspot };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let handle: ExecutiveFloorHandle | null = null;
    let cancelled = false;

    (async () => {
      try {
        const { createExecutiveFloorRenderer } = await import("../office/pixi/executive-floor-renderer");
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const created = await createExecutiveFloorRenderer(host, {
          plan,
          cast,
          director,
          mode,
          reducedMotion,
          onSelectCharacter: (id) => callbacks.current.onSelectCharacter(id),
          onHotspot: (h) => callbacks.current.onHotspot(h),
        });
        if (cancelled) {
          created.destroy();
          return;
        }
        handle = created;
        setStatus("ready");
        callbacks.current.onReady(created);
      } catch (error) {
        console.error("Executive Floor renderer failed to start", error);
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      callbacks.current.onReady(null);
      handle?.destroy();
    };
  }, [plan, cast, director, mode]);

  return (
    <div className="absolute inset-0">
      <div
        ref={hostRef}
        role="img"
        aria-label={label ?? "Interactive isometric view of the Executive Floor."}
        className="absolute inset-0"
      />
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-400">
          Loading the Executive Floor…
        </div>
      )}
      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-300">
          <p>
            The 2.5D view could not start in this browser (WebGL unavailable). The panel on the right still works.
          </p>
        </div>
      )}
    </div>
  );
}
