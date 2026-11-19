/**
 * Isometric projection math (2:1 "game" isometric). Pure functions shared by
 * every renderer (the current SVG preview and the future PixiJS renderer), so
 * layout is identical regardless of rendering backend.
 */
export interface TilePoint {
  col: number;
  row: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface IsoMetrics {
  tileWidth: number;
  tileHeight: number;
}

export const DEFAULT_ISO: IsoMetrics = { tileWidth: 64, tileHeight: 32 };

export function tileToScreen({ col, row }: TilePoint, m: IsoMetrics = DEFAULT_ISO): ScreenPoint {
  return {
    x: (col - row) * (m.tileWidth / 2),
    y: (col + row) * (m.tileHeight / 2),
  };
}

export function screenToTile({ x, y }: ScreenPoint, m: IsoMetrics = DEFAULT_ISO): TilePoint {
  const halfW = m.tileWidth / 2;
  const halfH = m.tileHeight / 2;
  return {
    col: Math.floor((x / halfW + y / halfH) / 2),
    row: Math.floor((y / halfH - x / halfW) / 2),
  };
}

/** Painter's-algorithm depth: higher values draw later (in front). */
export function depthOf({ col, row }: TilePoint): number {
  return col + row;
}

/** Diamond polygon points for one tile, as an SVG/Pixi-friendly list. */
export function tileDiamond(tile: TilePoint, m: IsoMetrics = DEFAULT_ISO): ScreenPoint[] {
  const { x, y } = tileToScreen(tile, m);
  const halfW = m.tileWidth / 2;
  const halfH = m.tileHeight / 2;
  return [
    { x, y },
    { x: x + halfW, y: y + halfH },
    { x, y: y + m.tileHeight },
    { x: x - halfW, y: y + halfH },
  ];
}
