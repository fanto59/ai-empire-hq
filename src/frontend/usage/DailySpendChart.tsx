"use client";

import { useState } from "react";

/**
 * Daily API spend - one series, so no legend (the title names it).
 * Bars grow from one baseline with 4px rounded data-ends, a recessive grid,
 * a hover/focus tooltip per bar, and a table view for screen readers.
 * Bar color validated against the dark chart surface (dataviz validator).
 */
const BAR = "#2b9be0";
const W = 720;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 26, left: 52 };

export interface DailyPoint {
  date: string;
  costMicros: number;
  calls: number;
}

const usd = (micros: number) => (micros === 0 ? "$0" : micros < 10_000 ? `$${(micros / 1e6).toFixed(4)}` : `$${(micros / 1e6).toFixed(2)}`);
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function niceMax(v: number): number {
  if (v <= 0) return 10_000; // $0.01 axis when there is no spend yet
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

export function DailySpendChart({ data }: { data: DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.costMicros)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const band = innerW / data.length;
  const barW = Math.min(24, Math.max(4, band - 4));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const active = hover === null ? null : data[hover];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Daily API spend for the last ${data.length} days`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-slate-800" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 text-[11px] tabular-nums">
              {usd(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = PAD.left + i * band + (band - barW) / 2;
          const h = Math.max(0, y(0) - y(d.costMicros));
          const r = Math.min(4, h / 2, barW / 2);
          const top = y(0) - h;
          return (
            <g key={d.date}>
              {h > 0 && (
                <path
                  d={`M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${y(0)} Z`}
                  fill={BAR}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {/* Hit target: the whole column, bigger than the bar. */}
              <rect
                x={PAD.left + i * band}
                y={PAD.top}
                width={band}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${shortDate(d.date)}: ${usd(d.costMicros)}, ${d.calls} API call${d.calls === 1 ? "" : "s"}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="outline-none focus-visible:stroke-sky-400"
              />
              {(i % 7 === (data.length - 1) % 7 || i === data.length - 1) && (
                <text x={PAD.left + i * band + band / 2} y={H - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">
                  {shortDate(d.date)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-slate-600" strokeWidth={1} />
      </svg>
      {active && hover !== null && (
        <div
          role="status"
          className="pointer-events-none absolute top-0 rounded-md bg-slate-950 px-3 py-2 text-xs shadow-lg ring-1 ring-slate-700"
          style={{ left: `clamp(0px, calc(${((PAD.left + hover * band + band / 2) / W) * 100}% - 70px), calc(100% - 140px))` }}
        >
          <p className="text-slate-400">{shortDate(active.date)}</p>
          <p className="font-semibold text-slate-100 tabular-nums">{usd(active.costMicros)}</p>
          <p className="text-slate-400 tabular-nums">
            {active.calls} API call{active.calls === 1 ? "" : "s"}
          </p>
        </div>
      )}
      <details className="mt-2 text-xs text-slate-400">
        <summary className="cursor-pointer select-none hover:text-slate-200">Show as table</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 font-medium">Day (UTC)</th>
              <th className="py-1 text-right font-medium">Spend</th>
              <th className="py-1 text-right font-medium">API calls</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((d) => (
              <tr key={d.date} className="border-t border-slate-800">
                <td className="py-1">{d.date}</td>
                <td className="py-1 text-right text-slate-200">{usd(d.costMicros)}</td>
                <td className="py-1 text-right">{d.calls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
