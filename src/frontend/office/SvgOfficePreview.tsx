import { DEFAULT_ISO, tileDiamond, tileToScreen, type ScreenPoint } from "./iso";
import type { OfficeScene, SceneZone } from "./scene";

/**
 * Lightweight, dependency-free renderer used until PixiJS is introduced.
 * Draws zones (floors) and avatars from an OfficeScene. Renders on the server
 * as static SVG - no client JS required.
 */
function points(list: ScreenPoint[]): string {
  return list.map((p) => `${p.x},${p.y}`).join(" ");
}

function zoneFloor(zone: SceneZone): ScreenPoint[] {
  const { origin, size } = zone;
  const top = tileDiamond(origin)[0]!;
  const right = tileDiamond({ col: origin.col + size.cols - 1, row: origin.row })[1]!;
  const bottom = tileDiamond({ col: origin.col + size.cols - 1, row: origin.row + size.rows - 1 })[2]!;
  const left = tileDiamond({ col: origin.col, row: origin.row + size.rows - 1 })[3]!;
  return [top, right, bottom, left];
}

export function SvgOfficePreview({ scene }: { scene: OfficeScene }) {
  const { tileWidth, tileHeight } = DEFAULT_ISO;
  const { cols, rows } = scene.grid;
  const minX = -rows * (tileWidth / 2);
  const width = (cols + rows) * (tileWidth / 2);
  const height = (cols + rows) * (tileHeight / 2);
  const pad = 24;

  return (
    <svg
      role="img"
      aria-label="Isometric headquarters floor plan"
      viewBox={`${minX - pad} ${-pad} ${width + pad * 2} ${height + pad * 2}`}
      className="h-auto w-full"
    >
      {Array.from({ length: cols * rows }, (_, i) => {
        const tile = { col: i % cols, row: Math.floor(i / cols) };
        return (
          <polygon
            key={`t-${tile.col}-${tile.row}`}
            points={points(tileDiamond(tile))}
            className="fill-slate-900 stroke-slate-800"
            strokeWidth={1}
          />
        );
      })}

      {scene.zones.map((zone) => {
        const floor = zoneFloor(zone);
        const center = tileToScreen({
          col: zone.origin.col + zone.size.cols / 2,
          row: zone.origin.row + zone.size.rows / 2,
        });
        return (
          <g key={zone.key}>
            <polygon
              points={points(floor)}
              fill={zone.color}
              fillOpacity={0.18}
              stroke={zone.color}
              strokeWidth={2}
            />
            <text
              x={center.x}
              y={center.y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-slate-200 text-[11px] font-medium"
            >
              {zone.label}
            </text>
          </g>
        );
      })}

      {scene.avatars.map((avatar) => {
        const { x, y } = tileToScreen(avatar.tile);
        return (
          <g key={avatar.agentId} data-activity={avatar.activity}>
            <circle cx={x} cy={y + tileHeight / 2 - 10} r={8} fill={avatar.tint} />
            <title>{`${avatar.label} - ${avatar.activity}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
