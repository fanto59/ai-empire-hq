import type { Container } from "pixi.js";

/**
 * Smooth pan/zoom camera for the world container. Inputs set a TARGET;
 * `step()` eases toward it every frame, so motion stays smooth even when
 * the frame rate is capped for battery saving.
 */
export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export class Camera {
  private x = 0;
  private y = 0;
  private zoom = 1;
  private tx = 0;
  private ty = 0;
  private tzoom = 1;
  private viewW = 1;
  private viewH = 1;
  /** True once the user has panned/zoomed; disables auto-fit on resize. */
  userMoved = false;

  static readonly MIN_ZOOM = 0.45;
  static readonly MAX_ZOOM = 2.6;

  private readonly world: Container;
  private readonly bounds: WorldBounds;

  constructor(world: Container, bounds: WorldBounds) {
    this.world = world;
    this.bounds = bounds;
  }

  resize(w: number, h: number) {
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
    if (!this.userMoved) this.fit(true);
  }

  /** Frame the whole floor. */
  fit(immediate = false) {
    const bw = this.bounds.maxX - this.bounds.minX;
    const bh = this.bounds.maxY - this.bounds.minY;
    const zoom = clamp(Math.min(this.viewW / bw, this.viewH / bh) * 0.94, Camera.MIN_ZOOM, Camera.MAX_ZOOM);
    this.lookAt((this.bounds.minX + this.bounds.maxX) / 2, (this.bounds.minY + this.bounds.maxY) / 2, zoom, immediate);
  }

  /** Center a world point at the given zoom. */
  lookAt(wx: number, wy: number, zoom = this.tzoom, immediate = false) {
    this.tzoom = clamp(zoom, Camera.MIN_ZOOM, Camera.MAX_ZOOM);
    this.tx = this.viewW / 2 - wx * this.tzoom;
    this.ty = this.viewH / 2 - wy * this.tzoom;
    if (immediate) this.snap();
  }

  panBy(dx: number, dy: number) {
    this.userMoved = true;
    this.tx += dx;
    this.ty += dy;
    this.x += dx;
    this.y += dy;
    this.apply();
  }

  /** Zoom by `factor` keeping screen point (sx, sy) fixed. */
  zoomAt(factor: number, sx = this.viewW / 2, sy = this.viewH / 2) {
    this.userMoved = true;
    const next = clamp(this.tzoom * factor, Camera.MIN_ZOOM, Camera.MAX_ZOOM);
    const wx = (sx - this.tx) / this.tzoom;
    const wy = (sy - this.ty) / this.tzoom;
    this.tzoom = next;
    this.tx = sx - wx * next;
    this.ty = sy - wy * next;
  }

  /** Ease toward the target. Returns true while still moving. */
  step(dtMs: number): boolean {
    const k = 1 - Math.exp(-dtMs / 90);
    const dx = this.tx - this.x;
    const dy = this.ty - this.y;
    const dz = this.tzoom - this.zoom;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05 && Math.abs(dz) < 0.0005) {
      if (dx || dy || dz) this.snap();
      return false;
    }
    this.x += dx * k;
    this.y += dy * k;
    this.zoom += dz * k;
    this.apply();
    return true;
  }

  private snap() {
    this.x = this.tx;
    this.y = this.ty;
    this.zoom = this.tzoom;
    this.apply();
  }

  private apply() {
    this.world.position.set(this.x, this.y);
    this.world.scale.set(this.zoom);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
