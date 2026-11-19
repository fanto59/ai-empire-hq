# Virtual Office Rendering Architecture

Goal: an animated isometric office where each AI employee is a sprite whose
animation reflects **real** execution activity, with one wing per business.

Code: `src/frontend/office/`.

## Pipeline

```
Domain records (Business, AgentProfile)   Execution events
               │                                 │
               │                       deriveActivity() per agent
               ▼                                 ▼
          buildOfficeScene({ businesses, agents, activity })
                               │
                               ▼
                   OfficeScene  (plain data)
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
     SvgOfficePreview (now)        PixiOfficeRenderer (planned)
     server-rendered SVG           client-only canvas/WebGL
```

## Modules

| File | Role |
| --- | --- |
| `iso.ts` | 2:1 isometric math: `tileToScreen`, `screenToTile`, `depthOf`, `tileDiamond`. Shared by all renderers. |
| `scene.ts` | `OfficeScene` model and `buildOfficeScene()`. HQ core zones (Chief AI Manager, Central Project Manager) are always present; business wings come from `Business.officeLayout`. |
| `renderer.ts` | `OfficeRenderer` interface: `mount → update* → resize* → destroy`. |
| `SvgOfficePreview.tsx` | Zero-dependency preview renderer used today. |
| `OfficeViewport.tsx` | Stable entry point; pages never reference an engine directly. |

## Principles

1. **Scene is data, renderer is dumb.** Renderers only draw `OfficeScene`; no
   business logic, no fetching, no event handling.
2. **Engine-agnostic.** Swapping SVG → PixiJS (or adding a 3D view) requires
   no changes to pages, domain, or events.
3. **Activity is real.** Avatar animations map 1:1 from `DerivedAgentActivity`.
   No idle wandering or decorative "busy" loops that imply work.
4. **Depth sorting** uses `col + row` (painter's algorithm), computed in the
   scene so all renderers agree.

## PixiJS integration plan (not installed yet)

1. Add `pixi.js` (exact pinned version) in its own PR.
2. Create `src/frontend/office/pixi/pixi-renderer.ts` implementing
   `OfficeRenderer`:
   - `mount`: create `Application`, append canvas, load sprite atlas.
   - `update`: diff scene → create/move/remove sprites, set animation per
     `activity` (`offline`, `idle`, `thinking`, `using-tool`,
     `awaiting-approval`, `error`).
   - `resize`: resize renderer, re-center camera.
   - `destroy`: `app.destroy(true)`, release textures and tickers.
3. Create `PixiOfficeCanvas.tsx` (`"use client"`) that dynamically imports the
   renderer in `useEffect`, so PixiJS is excluded from SSR and the initial
   bundle.
4. `OfficeViewport` chooses Pixi when WebGL is available and
   `prefers-reduced-motion` is not set; otherwise keeps the SVG preview.
5. Live updates: subscribe to the (future, authenticated) SSE event stream,
   recompute activity, rebuild scene, call `update()`.

## Assets

- Sprite sheets in `public/office/` as texture atlases (original art only).
- Avatar `spriteKey` selects the sheet; `tint` personalizes it.
- CSP already permits `img-src blob: data:` and `worker-src blob:` for Pixi.

## Performance targets

- Pixi chunk loaded lazily, after first paint.
- Ticker paused when the tab is hidden.
- Target 60fps for ~200 avatars; use sprite batching and culling off-screen.
