# Virtual Office Rendering Architecture

Two renderers share the same isometric math (`src/frontend/office/iso.ts`):

| Renderer | Where | Purpose |
| --- | --- | --- |
| SVG preview | `/` (HQ dashboard) | Static, server-rendered floor plan built from real HQ data (`buildOfficeScene`). |
| PixiJS Executive Floor | `/office` | Interactive 2.5D prototype with three **simulated** characters. |

## Executive Floor (PixiJS 8)

```
floor/executive-floor.ts      FloorPlan data: rooms, partitions, furniture, wall features, waypoints
        │
navigation/grid.ts            walkable tiles + blocked partition crossings
navigation/pathfinding.ts     A* (4-connected iso grid)
        │
sim/scripts.ts + cast.ts      hand-written looping scenarios, prototype characters
sim/director.ts               SimulationDirector: tick(dt) → movement, states, simulated events
sim/poses.ts                  pure pose function: (state, posture, t) → joint transforms
        │
pixi/executive-floor-renderer.ts   Application, camera, input, frame loop
pixi/draw-structure.ts             slab, floors, back walls, windows, bookshelf, display, elevator
pixi/draw-furniture.ts             per-tile furniture pieces + ProjectBoardView
pixi/draw-partitions.ts            per-segment glass partitions
pixi/character-view.ts             procedural character (parts built once, animated by transforms)
pixi/depth.ts                      depth-ordering rules
        │
executive-floor/*.tsx         React shell: toolbar, legend, overview, inspector, board panel
```

Everything above the `pixi/` line is pure TypeScript with unit tests; it
knows nothing about PixiJS or React.

### Floor layout

```
 back-left wall (col 0)                          back-right wall (row 0)
 rows 0-5  | Chief AI Manager | Central PM      | Conference room        |
 rows 6-7  | Executive corridor — sector elevator on the left wall        |
 rows 8-15 | Research department (6 workstations) | Executive project board |
```

### Character states

Idle, Walking, Sitting, Working, Collaborating, Waiting for approval,
Completed, Failed. One shared pose function drives all characters, so the
animation language is consistent; each character differs in silhouette,
palette, hair, height, and accessory (tie, tablet, glasses). Badges above the
head: working (blue), collaborating (speech bubble), approval (amber
hourglass), completed (green check), failed (red "!").

### Depth sorting

Painter's algorithm with `zIndex = (col + row + 1) * 10 + bias` per tile
(see `pixi/depth.ts`). Large furniture is split into one piece per tile and
partitions into one segment per grid edge, so a single scalar key sorts
correctly against characters walking on any side. Walking characters use
the deeper of their current and next tile.

### Interaction

- Click/tap a character → inspector (also selectable from the side panel).
- Click the project board → board panel. Click the elevator → `/sectors`.
- Drag to pan, wheel or toolbar to zoom, **Fit** to reset, `Esc` to close.
- Pause and 1×/2×/4× speed control the simulation clock (animation follows it).

### Chromebook performance

- WebGL preferred (`preference: "webgl"`, `powerPreference: "low-power"`).
- Device pixel ratio capped at 2; world container is a render group so the
  camera transform is applied on the GPU.
- All geometry is built once; per frame only transforms change. The board
  redraws only when task statuses change. React re-renders on discrete
  simulation changes, never per frame.
- Ticker stops when the tab is hidden; **Battery saver** caps at 30 fps.
- `prefers-reduced-motion` damps gestures and bobbing.
- PixiJS is loaded with a dynamic import, so it is not in the initial bundle.

## Honesty rules for the prototype

- Characters have non-human codenames and a **SIM** chip on the canvas.
- A permanent "Simulation mode" banner sits above the floor.
- The inspector states "Not a real AI agent"; Model shows "Not connected"
  (with the *planned* provider); Cost is a `$0.00` placeholder.
- Every emitted event has `origin: "simulation"`, is tagged **SIM EVENT** in
  history, never leaves the browser, and is dropped by the backend event bus.
- Times are shown as simulation clock (`T+mm:ss`), not wall-clock.

## Connecting real agents later

Replace `SimulationDirector` with a director fed by the authenticated event
stream (SSE): same `CharacterRuntime`/`CharacterSnapshot` contract, movement
derived from task/room assignments, states derived via `deriveActivity`.
Remove the simulation labels only for characters backed by real agents.
