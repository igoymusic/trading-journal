// Small charts drawn as SVG: the score radar, donuts, the P&L histogram, the weekday heat map,
// hold time vs P&L, daily bars and the drawdown curve. Every mark shows its numbers on hover.

import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HeatCell, HistogramBin, TradeScore } from '../core/visuals';
import { HEAT_HOURS } from '../core/visuals';
import { chartTones, colors, withAlpha } from './colors';
import { signedUsd, shortDate } from './format';

/** Colors for groups that aren't wins or losses (calls vs puts, setups, ...), in a fixed order; they follow the theme. */
export const categoryColors = () => chartTones().series;
// Gridlines, labels and the gray "Other" slice, in the theme's colors.
const tone = chartTones;

/** Width of an element, kept up to date as the window resizes. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** A tooltip that follows the pointer over a chart. */
function useTip(shared?: React.RefObject<HTMLDivElement>) {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const own = useRef<HTMLDivElement>(null);
  const box = shared ?? own;
  const show = (e: React.MouseEvent, body: ReactNode) => setTip({ x: e.clientX, y: e.clientY, body });
  const hide = () => setTip(null);
  const el = tip && <ChartTip x={tip.x} y={tip.y}>{tip.body}</ChartTip>;
  return { box, show, hide, el };
}

/**
 * Drawn on the page itself (not inside the chart's panel) and kept fully inside the window: it sits
 * beside the pointer, flips to the other side near the right edge, and slides up or down near the top or bottom.
 */
function ChartTip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const gap = 12, edge = 8;
    let left = x + gap;
    if (left + width > window.innerWidth - edge) left = x - gap - width;
    left = Math.max(edge, Math.min(left, window.innerWidth - edge - width));
    const top = Math.max(edge, Math.min(y - height / 2, window.innerHeight - edge - height));
    setAt({ left, top });
  }, [x, y, children]);
  return createPortal(
    <div ref={ref} className="chart-tip" style={{ position: 'fixed', left: at?.left ?? x, top: at?.top ?? y, visibility: at ? 'visible' : 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}

const pnlColor = (n: number) => (n > 0 ? colors().win : n < 0 ? colors().loss : tone().muted);

/** "$1.2k" style, for axis labels. */
export function shortUsd(n: number): string {
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  return `${sign}$${a >= 1000 ? `${+(a / 1000).toFixed(a >= 10_000 ? 0 : 1)}k` : Math.round(a)}`;
}

function scoreColor(score: number) {
  return score >= 70 ? colors().win : score >= 40 ? tone().warn : colors().loss;
}

/** The trading score as a radar (spider) chart: the fuller the shape, the stronger the trading. */
export function RadarChart({ score, width = 240, radius = 54 }: { score: TradeScore; width?: number; radius?: number }) {
  const t = useTip();
  const n = score.axes.length;
  const r = radius;
  const c = width / 2;
  const cy = r + 34;
  const height = 2 * r + 64;
  const at = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [c + Math.cos(a) * r * (v / 100), cy + Math.sin(a) * r * (v / 100)];
  };
  const ring = (v: number) => score.axes.map((_, i) => at(i, v).join(',')).join(' ');
  const shape = score.axes.map((a, i) => at(i, Math.max(a.score, 3)).join(',')).join(' ');
  const line = colors().chart;
  return (
    <div className="chart-box radar" ref={t.box} onMouseLeave={t.hide}>
      <svg width={width} height={height} role="img" aria-label={`Trading score ${score.overall} out of 100`}>
        {[25, 50, 75, 100].map((v) => <polygon key={v} points={ring(v)} fill="none" stroke={tone().grid} strokeWidth={1} />)}
        {score.axes.map((_, i) => { const [x, y] = at(i, 100); return <line key={i} x1={c} y1={cy} x2={x} y2={y} stroke={tone().grid} strokeWidth={1} />; })}
        <polygon points={shape} fill={withAlpha(line, 0.28)} stroke={line} strokeWidth={2} strokeLinejoin="round" />
        {score.axes.map((a, i) => {
          const [x, y] = at(i, Math.max(a.score, 3));
          const [lx, ly0] = at(i, 100 + 100 * (10 / r));
          const anchor = Math.abs(lx - c) < 4 ? 'middle' : lx > c ? 'start' : 'end';
          // Top and bottom labels sit clear of the point; side labels center on it.
          const ly = Math.abs(lx - c) < 4 ? (ly0 < cy ? ly0 - 14 : ly0 + 2) : ly0 - 6;
          const tip = (e: React.MouseEvent) => t.show(e, <><b>{a.label}: {a.value}</b><div>Score {a.score} / 100</div><div className="muted">{a.explain}</div></>);
          return (
            <g key={a.key} onMouseMove={tip}>
              <circle cx={x} cy={y} r={4} fill={line} stroke="var(--panel)" strokeWidth={2} />
              <circle cx={x} cy={y} r={12} fill="transparent" />
              <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize={10.5} fill={tone().muted}>{a.label}</text>
              <text x={lx} y={ly + 13} textAnchor={anchor} dominantBaseline="middle" fontSize={11} fill={tone().ink} fontWeight={600}>{a.value}</text>
            </g>
          );
        })}
      </svg>
      <div className="score-total">
        <span className="tile-label">Score</span>
        <b style={{ color: scoreColor(score.overall) }}>{score.overall}</b>
        <div className="score-track"><div style={{ width: `${score.overall}%`, background: scoreColor(score.overall) }} /></div>
      </div>
      {t.el}
    </div>
  );
}

export interface Slice { label: string; value: number; color: string; detail?: string }

/** Keeps the biggest groups and folds the rest into "Other" so the donut stays readable. */
export function foldSlices(slices: Slice[], max = 5): Slice[] {
  const sorted = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted;
  const rest = sorted.slice(max - 1);
  return [...sorted.slice(0, max - 1), { label: `Other (${rest.length})`, value: rest.reduce((a, s) => a + s.value, 0), color: tone().other }];
}

/** A ring split into slices, with the total (or any headline) in the middle and a legend beside it. */
export function Donut({ slices, center, sub, size = 120, legend = true }: {
  slices: Slice[];
  center?: string;
  sub?: string;
  size?: number;
  legend?: boolean;
}) {
  const t = useTip();
  const total = slices.reduce((a, s) => a + s.value, 0);
  const r = size / 2 - 2;
  const inner = r * 0.66;
  const c = size / 2;
  // A 2px gap between slices, expressed as an angle at the outer edge.
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 2 / r : 0;
  let start = -Math.PI / 2;
  const arcs = slices.map((s) => {
    const sweep = total ? (s.value / total) * Math.PI * 2 : 0;
    const a0 = start + gap / 2;
    const a1 = start + Math.max(sweep - gap / 2, gap / 2);
    start += sweep;
    if (sweep >= Math.PI * 2 - 1e-6) {
      return { s, d: `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} L ${c - 0.01} ${c - inner} A ${inner} ${inner} 0 1 0 ${c} ${c - inner} Z` };
    }
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${c + Math.cos(a) * rad} ${c + Math.sin(a) * rad}`;
    return { s, d: `M ${p(r, a0)} A ${r} ${r} 0 ${large} 1 ${p(r, a1)} L ${p(inner, a1)} A ${inner} ${inner} 0 ${large} 0 ${p(inner, a0)} Z` };
  });
  const pct = (v: number) => `${total ? Math.round((v / total) * 100) : 0}%`;
  return (
    <div className="chart-box donut" ref={t.box} onMouseLeave={t.hide}>
      <svg width={size} height={size} role="img" aria-label={slices.map((s) => `${s.label} ${pct(s.value)}`).join(', ')}>
        {total === 0 && <circle cx={c} cy={c} r={(r + inner) / 2} fill="none" stroke={tone().grid} strokeWidth={r - inner} />}
        {arcs.map(({ s, d }) => s.value > 0 && (
          <path key={s.label} d={d} fill={s.color} onMouseMove={(e) => t.show(e, <><b>{s.label}</b><div>{s.detail ?? s.value} · {pct(s.value)}</div></>)} />
        ))}
        {center && <text x={c} y={sub && size >= 140 ? c - 3 : c} textAnchor="middle" dominantBaseline="middle" fontSize={size > 100 ? 18 : 14} fontWeight={600} fill={tone().ink}>{center}</text>}
        {sub && size >= 140 && <text x={c} y={c + 15} textAnchor="middle" dominantBaseline="middle" fontSize={11} fill={tone().muted}>{sub}</text>}
      </svg>
      {legend && (
        <ul className="legend">
          {slices.filter((s) => s.value > 0).map((s) => (
            <li key={s.label}><i style={{ background: s.color }} /><span>{s.label}</span><b>{pct(s.value)}</b></li>
          ))}
        </ul>
      )}
      {t.el}
    </div>
  );
}

/** How many trades fell in each P&L range: losses in red to the left of $0, wins in green to the right. */
export function Histogram({ bins, height = 190 }: { bins: HistogramBin[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const t = useTip(ref);
  const left = 30;
  const bottom = 22;
  const top = 8;
  const max = Math.max(1, ...bins.map((b) => b.count));
  const w = Math.max(0, width - left - 4);
  const bw = bins.length ? w / bins.length : 0;
  const y = (v: number) => top + (height - top - bottom) * (1 - v / max);
  const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  // Label about five bin edges, always including $0.
  const every = Math.max(1, Math.ceil(bins.length / 5));
  const zero = bins.findIndex((b) => b.from === 0);
  return (
    <div className="chart-box" ref={ref} onMouseLeave={t.hide}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Number of trades by P&L">
          {ticks.map((v) => (
            <g key={v}>
              <line x1={left} x2={width} y1={y(v)} y2={y(v)} stroke={tone().grid} />
              <text x={left - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={tone().muted}>{v}</text>
            </g>
          ))}
          {bins.map((b, i) => {
            const x = left + i * bw;
            const mid = (b.from + b.to) / 2;
            const h = height - bottom - y(b.count);
            return (
              <g key={b.from} onMouseMove={(e) => t.show(e, <><b>{b.count} trade{b.count === 1 ? '' : 's'}</b><div>{shortUsd(b.from)} to {shortUsd(b.to)}</div></>)}>
                <rect x={x} y={top} width={bw} height={height - top - bottom} fill="transparent" />
                {b.count > 0 && <path d={roundedTop(x + 1, y(b.count), Math.max(1, bw - 2), h, Math.min(3, bw / 3))} fill={pnlColor(mid)} />}
                {(i % every === (zero >= 0 ? zero % every : 0)) && (
                  <text x={x} y={height - 6} textAnchor="middle" fontSize={10} fill={tone().muted}>{shortUsd(b.from)}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {t.el}
    </div>
  );
}

/** A bar with its top corners rounded and its base square, sitting on the axis. */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M ${x} ${y + h} V ${y + rr} Q ${x} ${y} ${x + rr} ${y} H ${x + w - rr} Q ${x + w} ${y} ${x + w} ${y + rr} V ${y + h} Z`;
}

const HOUR_LABELS: Record<number, string> = { 9: '9:30', 10: '10am', 11: '11am', 12: '12pm', 13: '1pm', 14: '2pm', 15: '3pm' };
const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/** Net P&L by weekday and the hour you entered: the greener a square, the more you made then. */
export function Heatmap({ cells }: { cells: HeatCell[] }) {
  const t = useTip();
  const max = Math.max(1, ...cells.map((c) => Math.abs(c.netPnl)));
  return (
    <div className="chart-box" ref={t.box} onMouseLeave={t.hide}>
      <div className="heatmap" style={{ gridTemplateColumns: `36px repeat(${HEAT_HOURS.length}, 1fr)` }}>
        <span />
        {HEAT_HOURS.map((h) => <span key={h} className="heat-col">{HOUR_LABELS[h]}</span>)}
        {[1, 2, 3, 4, 5].map((d) => (
          <div key={d} className="heat-row">
            <span className="heat-day">{DAY_LABELS[d]}</span>
            {HEAT_HOURS.map((h) => {
              const c = cells.find((x) => x.weekday === d && x.hour === h)!;
              // Square root so a few mid-sized hours still show up next to one huge one.
              const strength = c.trades ? 0.15 + 0.75 * Math.sqrt(Math.abs(c.netPnl) / max) : 0;
              return (
                <div
                  key={h}
                  className={`heat-cell ${c.trades ? '' : 'empty'}`}
                  style={c.trades ? { background: withAlpha(c.netPnl >= 0 ? colors().win : colors().loss, strength) } : undefined}
                  onMouseMove={(e) => t.show(e, c.trades
                    ? <><b>{DAY_LABELS[d]} {HOUR_LABELS[h]}{h === 9 ? '–10am' : ''}</b><div>{signedUsd(c.netPnl)}</div><div className="muted">{c.trades} trade{c.trades === 1 ? '' : 's'} · {Math.round((c.wins / c.trades) * 100)}% won</div></>
                    : <><b>{DAY_LABELS[d]} {HOUR_LABELS[h]}</b><div className="muted">No trades</div></>)}
                >
                  {c.trades > 0 && shortUsd(c.netPnl)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="heat-scale"><span>{shortUsd(-max)}</span><i /><span>{shortUsd(max)}</span></div>
      {t.el}
    </div>
  );
}

/** Minutes as "45s", "12m", "1h 5m" or "2d". */
export function shortDuration(min: number): string {
  if (min < 1) return `${Math.round(min * 60)}s`;
  if (min < 60) return `${Math.round(min)}m`;
  if (min < 60 * 24) { const h = Math.floor(min / 60); const m = Math.round(min % 60); return m ? `${h}h ${m}m` : `${h}h`; }
  return `${Math.round(min / 1440)}d`;
}

/** Each trade as a dot: how long you held it across, how much it made or lost up and down. */
export function ScatterChart({ points, height = 220 }: {
  points: { x: number; y: number; label: string }[];
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const t = useTip(ref);
  const left = 46;
  const bottom = 22;
  const top = 8;
  // Hold times run from seconds to days, so the axis is logarithmic.
  const xs = points.map((p) => Math.log10(Math.max(p.x, 0.1)));
  const x0 = Math.min(-0.5, ...xs);
  const x1 = Math.max(x0 + 1, ...xs);
  const ymax = Math.max(1, ...points.map((p) => Math.abs(p.y)));
  const px = (v: number) => left + ((Math.log10(Math.max(v, 0.1)) - x0) / (x1 - x0)) * (width - left - 8);
  const py = (v: number) => top + ((ymax - v) / (2 * ymax)) * (height - top - bottom);
  const xticks = [0.5, 1, 5, 15, 60, 240, 1440, 10080].filter((v) => Math.log10(v) >= x0 && Math.log10(v) <= x1);
  return (
    <div className="chart-box" ref={ref} onMouseLeave={t.hide}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Hold time against P&L for each trade">
          {[-ymax, 0, ymax].map((v) => (
            <g key={v}>
              <line x1={left} x2={width} y1={py(v)} y2={py(v)} stroke={v === 0 ? tone().zero : tone().grid} />
              <text x={left - 6} y={py(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={tone().muted}>{shortUsd(v)}</text>
            </g>
          ))}
          {xticks.map((v) => <text key={v} x={px(v)} y={height - 6} textAnchor="middle" fontSize={10} fill={tone().muted}>{shortDuration(v)}</text>)}
          {points.map((p, i) => (
            <circle key={i} cx={px(p.x)} cy={py(p.y)} r={4} fill={withAlpha(pnlColor(p.y), 0.75)} stroke="var(--panel)" strokeWidth={1}
              onMouseMove={(e) => t.show(e, <><b>{signedUsd(p.y)}</b><div>Held {shortDuration(p.x)}</div><div className="muted">{p.label}</div></>)} />
          ))}
        </svg>
      )}
      {t.el}
    </div>
  );
}

/** One bar per day, green up or red down from $0. */
export function DailyBars({ days, height = 180 }: { days: { date: string; netPnl: number }[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const t = useTip(ref);
  const left = 46;
  const bottom = 22;
  const top = 8;
  const max = Math.max(1, ...days.map((d) => Math.abs(d.netPnl)));
  const lo = Math.min(0, ...days.map((d) => d.netPnl));
  const hi = Math.max(0, ...days.map((d) => d.netPnl));
  const span = hi - lo || max;
  const py = (v: number) => top + ((hi - v) / span) * (height - top - bottom);
  const bw = days.length ? (width - left - 4) / days.length : 0;
  const every = Math.max(1, Math.ceil(days.length / 6));
  return (
    <div className="chart-box" ref={ref} onMouseLeave={t.hide}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Net P&L each day">
          {[lo, 0, hi].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
            <g key={v}>
              <line x1={left} x2={width} y1={py(v)} y2={py(v)} stroke={v === 0 ? tone().zero : tone().grid} />
              <text x={left - 6} y={py(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={tone().muted}>{shortUsd(v)}</text>
            </g>
          ))}
          {days.map((d, i) => {
            const x = left + i * bw;
            const y = d.netPnl >= 0 ? py(d.netPnl) : py(0);
            const h = Math.abs(py(d.netPnl) - py(0));
            return (
              <g key={d.date} onMouseMove={(e) => t.show(e, <><b>{shortDate(d.date)}</b><div style={{ color: pnlColor(d.netPnl) }}>{signedUsd(d.netPnl)}</div></>)}>
                <rect x={x} y={top} width={Math.max(bw, 1)} height={height - top - bottom} fill="transparent" />
                <rect x={x + (bw > 4 ? 1 : 0)} y={y} width={Math.max(1, bw > 4 ? bw - 2 : bw)} height={Math.max(h, 1)} rx={bw > 6 ? 2 : 0} fill={pnlColor(d.netPnl)} />
                {i % every === 0 && <text x={x + bw / 2} y={height - 6} textAnchor="middle" fontSize={10} fill={tone().muted}>{shortDate(d.date)}</text>}
              </g>
            );
          })}
        </svg>
      )}
      {t.el}
    </div>
  );
}

/** Running P&L above, and below it how far it sat under its last high point, sharing the same days. */
export function EquityDrawdown({ points, height = 230 }: { points: { date: string; equity: number; drawdown: number }[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const t = useTip(ref);
  const [hover, setHover] = useState<number | null>(null);
  const left = 46;
  const gap = 26;
  const eqH = (height - gap - 22) * 0.62;
  const ddH = (height - gap - 22) * 0.38;
  const eLo = Math.min(0, ...points.map((p) => p.equity));
  const eHi = Math.max(1, ...points.map((p) => p.equity));
  const dLo = Math.min(-1, ...points.map((p) => p.drawdown));
  const px = (i: number) => left + (points.length > 1 ? (i / (points.length - 1)) * (width - left - 8) : 0);
  const ey = (v: number) => 4 + ((eHi - v) / (eHi - eLo)) * eqH;
  const dy = (v: number) => 4 + eqH + gap + (v / dLo) * ddH;
  const line = (f: (p: (typeof points)[number]) => number, y: (v: number) => number) => points.map((p, i) => `${i ? 'L' : 'M'} ${px(i)} ${y(f(p))}`).join(' ');
  const ddArea = `${line((p) => p.drawdown, dy)} L ${px(points.length - 1)} ${dy(0)} L ${px(0)} ${dy(0)} Z`;
  const every = Math.max(1, Math.ceil(points.length / 6));
  function move(e: React.MouseEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - left) / (width - left - 8)) * (points.length - 1));
    const k = Math.max(0, Math.min(points.length - 1, i));
    setHover(k);
    const p = points[k];
    t.show(e, <><b>{shortDate(p.date)}</b><div>Running P&L <span style={{ color: pnlColor(p.equity) }}>{signedUsd(p.equity)}</span></div><div>Below high <span className="loss">{p.drawdown ? signedUsd(p.drawdown) : '$0.00'}</span></div></>);
  }
  return (
    <div className="chart-box" ref={ref} onMouseLeave={() => { t.hide(); setHover(null); }}>
      {width > 0 && points.length > 0 && (
        <svg width={width} height={height} onMouseMove={move} role="img" aria-label="Running P&L and drawdown">
          {[eLo, 0, eHi].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
            <g key={`e${v}`}>
              <line x1={left} x2={width} y1={ey(v)} y2={ey(v)} stroke={v === 0 ? tone().zero : tone().grid} />
              <text x={left - 6} y={ey(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={tone().muted}>{shortUsd(v)}</text>
            </g>
          ))}
          <path d={line((p) => p.equity, ey)} fill="none" stroke={colors().chart} strokeWidth={2} strokeLinejoin="round" />
          <text x={width - 8} y={4 + eqH + gap - 9} textAnchor="end" fontSize={10} fill={tone().muted}>Drawdown: how far below the last high</text>
          {[dLo, 0].map((v) => (
            <g key={`d${v}`}>
              <line x1={left} x2={width} y1={dy(v)} y2={dy(v)} stroke={tone().grid} />
              <text x={left - 6} y={dy(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill={tone().muted}>{shortUsd(v)}</text>
            </g>
          ))}
          <path d={ddArea} fill={withAlpha(colors().loss, 0.3)} stroke={colors().loss} strokeWidth={1.5} strokeLinejoin="round" />
          {points.map((p, i) => i % every === 0 && <text key={p.date} x={px(i)} y={height - 6} textAnchor="middle" fontSize={10} fill={tone().muted}>{shortDate(p.date)}</text>)}
          {hover !== null && (
            <g>
              <line x1={px(hover)} x2={px(hover)} y1={4} y2={dy(dLo)} stroke={tone().muted} strokeDasharray="3 3" />
              <circle cx={px(hover)} cy={ey(points[hover].equity)} r={4} fill={colors().chart} stroke="var(--panel)" strokeWidth={2} />
              <circle cx={px(hover)} cy={dy(points[hover].drawdown)} r={4} fill={colors().loss} stroke="var(--panel)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {t.el}
    </div>
  );
}

/** Wins next to losses as two bars, e.g. average win against average loss. */
export function VersusBar({ win, loss }: { win: number; loss: number }) {
  const total = Math.abs(win) + Math.abs(loss) || 1;
  return (
    <div className="versus" title={`Average win ${signedUsd(win)} vs average loss ${signedUsd(loss)}`}>
      <div className="win-fill" style={{ width: `${(Math.abs(win) / total) * 100}%` }} />
      <div className="loss-fill" style={{ width: `${(Math.abs(loss) / total) * 100}%` }} />
    </div>
  );
}
