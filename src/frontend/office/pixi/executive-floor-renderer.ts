// PixiJS compiles shaders with `new Function` by default; this polyfill keeps
// the app working under our strict Content-Security-Policy (no unsafe-eval).
import "pixi.js/unsafe-eval";
import { Application, Container, type FederatedPointerEvent } from "pixi.js";
import type { FloorHotspot, FloorPlan, RoomId } from "../floor/types";
import type { SimulationDirector } from "../sim/director";
import type { PrototypeCharacter } from "../sim/types";
import { Camera } from "./camera";
import { CharacterView } from "./character-view";
import { buildFurniture } from "./draw-furniture";
import { buildPartitionSegments } from "./draw-partitions";
import { WALL_HEIGHT, buildStructure } from "./draw-structure";
import { iso } from "./geometry";
import { PALETTE } from "./palette";

/**
 * EXECUTIVE FLOOR RENDERER (PixiJS v8)
 *
 * Scene graph:
 *   stage
 *   └─ world (render group: camera transform applied on the GPU)
 *      ├─ structure  - slab, floors, back walls, wall features (static)
 *      └─ sorted     - furniture pieces, partitions, characters (zIndex)
 *
 * Chromebook-minded choices: WebGL preferred (most reliable on ChromeOS),
 * device-pixel-ratio capped at 2, all geometry built once (animation is
 * transform-only), board redraws only on task changes, the ticker stops
 * while the tab is hidden, and an optional 30 fps battery-saver cap.
 */
export interface ExecutiveFloorRendererOptions {
  plan: FloorPlan;
  cast: readonly PrototypeCharacter[];
  director: SimulationDirector;
  reducedMotion: boolean;
  onSelectCharacter: (id: string | null) => void;
  onHotspot: (hotspot: FloorHotspot) => void;
}

export interface ExecutiveFloorHandle {
  readonly backend: string;
  setSelected(id: string | null): void;
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  focusCharacter(id: string): void;
  focusRoom(id: RoomId): void;
  setBatterySaver(on: boolean): void;
  destroy(): void;
}

const DRAG_THRESHOLD = 6;

export async function createExecutiveFloorRenderer(
  host: HTMLElement,
  options: ExecutiveFloorRendererOptions,
): Promise<ExecutiveFloorHandle> {
  const { plan, cast, director } = options;
  const app = new Application();
  await app.init({
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    background: PALETTE.backdrop,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    preference: "webgl",
    powerPreference: "low-power",
  });
  app.ticker.maxFPS = 60;
  app.canvas.style.display = "block";
  app.canvas.style.touchAction = "none";
  app.canvas.setAttribute("aria-hidden", "true");
  host.appendChild(app.canvas);

  // ---- scene ----------------------------------------------------------------
  const world = new Container({ label: "world", isRenderGroup: true });
  app.stage.addChild(world);

  const structure = buildStructure(plan);
  world.addChild(structure.container);

  const sorted = new Container({ label: "sorted", sortableChildren: true });
  world.addChild(sorted);

  const ownerColors = Object.fromEntries(cast.map((c) => [c.id, c.appearance.accent]));
  const furniture = buildFurniture(plan, ownerColors);
  for (const p of furniture.pieces) sorted.addChild(p);
  for (const p of buildPartitionSegments(plan)) sorted.addChild(p);

  // ---- interaction ----------------------------------------------------------
  let dragging = false;
  let dragDistance = 0;
  let last = { x: 0, y: 0 };
  const wasTap = () => dragDistance < DRAG_THRESHOLD;

  const views = new Map<string, CharacterView>();
  for (const character of cast) {
    const view = new CharacterView(character, (id) => {
      if (wasTap()) options.onSelectCharacter(id);
    });
    views.set(character.id, view);
    sorted.addChild(view.root);
  }

  structure.elevator.on("pointertap", () => {
    if (wasTap()) options.onHotspot("sector-elevator");
  });
  for (const p of furniture.board?.pieces ?? []) {
    p.on("pointertap", () => {
      if (wasTap()) options.onHotspot("project-board");
    });
  }

  const { cols, rows } = plan.grid;
  const camera = new Camera(world, {
    minX: iso(0, rows)[0] - 40,
    maxX: iso(cols, 0)[0] + 40,
    minY: iso(0, 0)[1] - WALL_HEIGHT - 30,
    maxY: iso(cols, rows)[1] + 40,
  });
  camera.resize(app.screen.width, app.screen.height);

  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  app.stage.on("pointerdown", (e: FederatedPointerEvent) => {
    dragging = true;
    dragDistance = 0;
    last = { x: e.global.x, y: e.global.y };
  });
  app.stage.on("globalpointermove", (e: FederatedPointerEvent) => {
    if (!dragging) return;
    const dx = e.global.x - last.x;
    const dy = e.global.y - last.y;
    last = { x: e.global.x, y: e.global.y };
    dragDistance += Math.abs(dx) + Math.abs(dy);
    if (dragDistance >= DRAG_THRESHOLD) camera.panBy(dx, dy);
  });
  const endDrag = () => {
    dragging = false;
  };
  app.stage.on("pointerup", endDrag);
  app.stage.on("pointerupoutside", endDrag);
  app.stage.on("pointertap", (e: FederatedPointerEvent) => {
    if (e.target === app.stage && wasTap()) options.onSelectCharacter(null);
  });

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rect = app.canvas.getBoundingClientRect();
    camera.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
  };
  app.canvas.addEventListener("wheel", onWheel, { passive: false });

  const resizeObserver = new ResizeObserver(() => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    app.renderer.resize(w, h);
    camera.resize(w, h);
  });
  resizeObserver.observe(host);

  const onVisibility = () => {
    if (document.hidden) app.ticker.stop();
    else app.ticker.start();
  };
  document.addEventListener("visibilitychange", onVisibility);

  // ---- frame loop -------------------------------------------------------------
  const motion = options.reducedMotion ? 0.25 : 1;
  app.ticker.add((ticker) => {
    director.tick(ticker.deltaMS);
    const t = director.getSimTimeMs() / 1000;
    for (const rt of director.runtimes()) views.get(rt.id)?.update(rt, t, motion);
    furniture.board?.update(director.getTasks());
    camera.step(ticker.deltaMS);
  });

  let destroyed = false;
  return {
    backend: app.renderer.name,
    setSelected(id) {
      for (const [vid, view] of views) view.setSelected(vid === id);
    },
    zoomIn: () => camera.zoomAt(1.25),
    zoomOut: () => camera.zoomAt(0.8),
    fit() {
      camera.userMoved = false;
      camera.fit();
    },
    focusCharacter(id) {
      const rt = director.getRuntime(id);
      if (!rt) return;
      const [x, y] = iso(rt.col + 0.5, rt.row + 0.5);
      camera.userMoved = true;
      camera.lookAt(x, y - 30, 1.6);
    },
    focusRoom(roomId) {
      const room = plan.rooms.find((r) => r.id === roomId);
      if (!room) return;
      const { col, row, cols: rc, rows: rr } = room.area;
      const [x, y] = iso(col + rc / 2, row + rr / 2);
      camera.userMoved = true;
      camera.lookAt(x, y - 20, 1.25);
    },
    setBatterySaver(on) {
      app.ticker.maxFPS = on ? 30 : 60;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      app.canvas.removeEventListener("wheel", onWheel);
      resizeObserver.disconnect();
      app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
    },
  };
}
