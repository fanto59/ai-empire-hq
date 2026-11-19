/**
 * Executive Floor palette: restrained, architectural, enterprise. Light
 * materials on a deep navy backdrop with a single cool accent.
 */
export const PALETTE = {
  backdrop: 0x0b1220,
  slabTop: 0x1e293b,
  slabSide: 0x111827,

  floor: {
    walnut: 0xa7825f,
    oak: 0xd9c4a0,
    carpet: 0x8d99ad,
    concrete: 0xd3d8de,
    polished: 0xe8ebef,
  },

  wallRight: 0xeef1f5,
  wallLeft: 0xe1e6ec,
  wallCap: 0x8a96a8,
  baseboard: 0xc5ccd6,

  glass: 0xbcd7f2,
  glassFrame: 0x5b6b80,
  windowSky: 0x9fc4e8,
  windowSkyHigh: 0xd3e5f6,
  windowFrame: 0x6b7a8f,

  deskTop: 0xf5f7fa,
  deskSide: 0xc3cad4,
  walnut: 0x5d3f2c,
  walnutLight: 0x7a553c,
  conference: 0x3a2f29,
  metal: 0x9aa4b2,
  dark: 0x1f2937,
  screen: 0x0f172a,
  screenGlow: 0x60a5fa,
  chair: 0x2f3a4a,
  sofa: 0x4a5668,
  sofaCushion: 0x5b687c,
  cabinet: 0xe3e8ee,
  pot: 0xeef2f6,
  leaf: 0x2f855a,
  leafLight: 0x48a774,
  board: 0xfbfcfd,
  boardFrame: 0x334155,

  accent: 0x38bdf8,
  sim: 0xf59e0b,
  text: 0x0f172a,
  label: 0x475569,

  state: {
    working: 0x3b82f6,
    approval: 0xf59e0b,
    completed: 0x10b981,
    failed: 0xef4444,
  },

  task: {
    todo: 0x94a3b8,
    "in-progress": 0x3b82f6,
    "awaiting-approval": 0xf59e0b,
    done: 0x10b981,
    blocked: 0xef4444,
  },
} as const;

export const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Multiply an RGB color by `f` (f < 1 darkens, f > 1 lightens). */
export function shade(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((color & 0xff) * f));
  return (r << 16) | (g << 8) | b;
}
