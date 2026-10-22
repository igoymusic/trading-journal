import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { statsByDay } from '../core/calendar';
import { buildReports, type ReportRow, type Reports } from '../core/reports';
import { formatR } from '../core/rr';
import type { Trade } from '../core/types';
import { drawdown, holdMinutes, pnlHistogram, tradeScore, weekdayHourHeat } from '../core/visuals';
import { CATEGORY_COLORS, DailyBars, Donut, EquityDrawdown, foldSlices, Heatmap, Histogram, RadarChart, ScatterChart } from './Charts';
import { colors } from './colors';
import { pnlClass, shortDate, signedUsd } from './format';
import { useJournal } from './journal';
import { moveSection, normalizeLayout, type ReportsLayout, toggleChart, toggleCollapsed, toggleHidden } from './reportsLayout';
import { nextSort, sortArrow, sortRows, type SortState } from './sorting';

const SECTIONS: { key: keyof Reports; title: string; hint?: string }[] = [
  { key: 'setup', title: 'By setup' },
  { key: 'playbook', title: 'Following your playbook', hint: 'Trades on setups that have rules.' },
  { key: 'rulesBroken', title: 'Rules broken', hint: 'What it cost each time you broke a rule.' },
  { key: 'positive', title: 'By what you did well', hint: 'A trade with two positive tags counts under both.' },
  { key: 'mistake', title: 'By mistake', hint: 'A trade with two mistakes counts under both.' },
  { key: 'dte', title: 'By days to expiry', hint: 'Counted from the day you opened the trade.' },
  { key: 'timeOfDay', title: 'By time of day', hint: 'Grouped by when you entered, in half hours.' },
  { key: 'putCall', title: 'Calls vs puts' },
  { key: 'direction', title: 'Long vs short' },
  { key: 'weekday', title: 'By day of week' },
  { key: 'symbol', title: 'By symbol' },
  { key: 'rating', title: 'By rating' },
];

/** Chart-only sections. They start at the top of the page. */
const VISUALS: { key: string; title: string; hint?: string }[] = [
  { key: 'score', title: 'Trading score', hint: 'Hover a point to see what it measures.' },
  { key: 'heatmap', title: 'When you make money', hint: 'Net P&L by weekday and the hour you entered.' },
  { key: 'equity', title: 'Running P&L and drawdown' },
  { key: 'distribution', title: 'How your trades are spread', hint: 'Number of trades in each P&L range.' },
  { key: 'daily', title: 'Daily P&L' },
  { key: 'holdTime', title: 'Hold time vs P&L', hint: 'Each dot is a trade.' },
];
const VISUAL_KEYS = VISUALS.map((v) => v.key);
const KEYS = [...VISUAL_KEYS, ...SECTIONS.map((s) => s.key)];
const TITLES = new Map<string, string>([...VISUALS, ...SECTIONS].map((s) => [s.key, s.title]));
const HINTS = new Map<string, string | undefined>([...VISUALS, ...SECTIONS].map((s) => [s.key, s.hint]));

/**
 * Results broken out several ways, using whatever trades pass the filters. Sections sit in two
 * columns that stack tightly; drag a section's title bar to move it, click its arrow to collapse it.
 */
export function ReportsView({ trades }: { trades: Trade[] }) {
  const { setups, mistakes, positives } = useJournal();
  const reports = useMemo(() => buildReports(trades, setups, mistakes, positives), [trades, setups, mistakes, positives]);
  const [layout, setLayout] = useState<ReportsLayout>(() => normalizeLayout(undefined, KEYS, 2, VISUAL_KEYS));
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ column: number; index: number } | null>(null);
  const columnEls = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => { window.journal.getSettings().then((s) => setLayout(normalizeLayout(s.reportsLayout, KEYS, 2, VISUAL_KEYS))); }, []);
  function save(next: ReportsLayout) {
    setLayout(next);
    window.journal.setReportsLayout(next);
  }

  const visuals = useVisuals(trades);
  const hidden = layout.hidden ?? [];
  const shown = (key: string) => !hidden.includes(key) && (VISUAL_KEYS.includes(key) ? visuals[key] !== null : reports[key as keyof Reports].length > 0);
  const [menuOpen, setMenuOpen] = useState(false);

  /** Where in a column the dragged section would land, from the pointer's height. */
  function dropIndex(column: number, y: number) {
    const cards = [...(columnEls.current[column]?.querySelectorAll<HTMLElement>('[data-section]') ?? [])]
      .filter((el) => el.dataset.section !== dragging);
    const before = cards.findIndex((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
    // Indexes count every section in the column (hidden ones too), minus the one being dragged.
    const keys = layout.columns[column].filter((k) => k !== dragging);
    return before < 0 ? keys.length : keys.indexOf(cards[before].dataset.section!);
  }

  if (!trades.some((t) => t.status === 'CLOSED')) return <p className="muted reports-empty">No closed trades match these filters.</p>;
  return (
    <>
    <div className="reports-tools">
      <div className="picker-anchor">
        <button onClick={() => setMenuOpen(!menuOpen)}>Sections{hidden.length ? ` (${hidden.length} hidden)` : ''} ▾</button>
        {menuOpen && <SectionsMenu hidden={hidden} onToggle={(k) => save(toggleHidden(layout, k))} onShowAll={() => save({ ...layout, hidden: [] })} onClose={() => setMenuOpen(false)} />}
      </div>
    </div>
    <section className="reports" onDragEnd={() => { setDragging(null); setDrop(null); }}>
      {layout.columns.map((col, ci) => {
        const others = col.filter((k) => k !== dragging);
        return (
          <div
            key={ci}
            className="report-col"
            ref={(el) => { columnEls.current[ci] = el; }}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              const index = dropIndex(ci, e.clientY);
              if (drop?.column !== ci || drop.index !== index) setDrop({ column: ci, index });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging && drop) save(moveSection(layout, dragging, drop.column, drop.index));
              setDragging(null);
              setDrop(null);
            }}
          >
            {col.map((key) => {
              const marker = dragging && drop?.column === ci && others[drop.index] === key;
              const isVisual = VISUAL_KEYS.includes(key);
              const asChart = !isVisual && (layout.charts ?? []).includes(key);
              return (
                <div key={key} className="report-slot">
                  {marker && <div className="drop-marker" />}
                  {shown(key) && (
                    <Section
                      sectionKey={key}
                      title={TITLES.get(key)!}
                      hint={HINTS.get(key)}
                      collapsed={layout.collapsed.includes(key)}
                      dragging={dragging === key}
                      onToggle={() => save(toggleCollapsed(layout, key))}
                      onDragStart={() => setDragging(key)}
                      view={isVisual ? undefined : { chart: asChart, onChange: () => save(toggleChart(layout, key)) }}
                    >
                      {isVisual ? visuals[key]
                        : asChart ? <GroupChart rows={reports[key as keyof Reports]} />
                        : <ReportTable rows={reports[key as keyof Reports]} />}
                    </Section>
                  )}
                </div>
              );
            })}
            {dragging && drop?.column === ci && drop.index >= others.length && <div className="drop-marker" />}
          </div>
        );
      })}
    </section>
    </>
  );
}

/** Tick or untick each report section to show or hide it. */
function SectionsMenu({ hidden, onToggle, onShowAll, onClose }: { hidden: string[]; onToggle: (key: string) => void; onShowAll: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);
  return (
    <div className="column-picker sections-menu" ref={ref}>
      {[...VISUALS, ...SECTIONS].map((s) => (
        <label key={s.key} className="picker-row">
          <input type="checkbox" checked={!hidden.includes(s.key)} onChange={() => onToggle(s.key)} /> {s.title}
        </label>
      ))}
      <button className="link" disabled={!hidden.length} onClick={onShowAll}>Show all</button>
    </div>
  );
}

const COLS: { id: string; label: string; title?: string; value: (r: ReportRow) => number | string | null }[] = [
  { id: 'label', label: '', value: (r) => r.label },
  { id: 'trades', label: 'Trades', value: (r) => r.trades },
  { id: 'winRate', label: 'Win %', value: (r) => r.winRate },
  { id: 'netPnl', label: 'Net P&L', value: (r) => r.netPnl },
  { id: 'avgPnl', label: 'Avg', value: (r) => r.avgPnl },
  { id: 'pf', label: 'PF', title: 'Total won divided by total lost. Above 1 means it made money.', value: (r) => r.profitFactor },
  { id: 'avgR', label: 'Avg R', title: 'Average R over the trades that have a stop line set', value: (r) => r.avgR },
];

/** A report section: a title bar you drag to move, an arrow to collapse it, and optionally a table/chart switch. */
function Section({ sectionKey, title, hint, collapsed, dragging, onToggle, onDragStart, view, children }: {
  sectionKey: string;
  title: string;
  hint?: string;
  collapsed: boolean;
  dragging: boolean;
  onToggle: () => void;
  onDragStart: () => void;
  view?: { chart: boolean; onChange: () => void };
  children: ReactNode;
}) {
  return (
    <div className={`card report ${dragging ? 'dragging' : ''} ${collapsed ? 'collapsed' : ''}`} data-section={sectionKey}>
      <div
        className="report-head"
        draggable
        title="Drag to move this section"
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', sectionKey); onDragStart(); }}
      >
        <button className="collapse" onClick={onToggle} aria-label={collapsed ? 'Expand' : 'Collapse'} title={collapsed ? 'Expand' : 'Collapse'}>
          {collapsed ? '▸' : '▾'}
        </button>
        <h3>{title}</h3>
        {hint && !collapsed && <span className="muted">{hint}</span>}
        {view && !collapsed && (
          <span className="view-switch" role="group" aria-label="Show as">
            <button className={view.chart ? '' : 'active'} onClick={() => view.chart && view.onChange()} title="Show as a table">Table</button>
            <button className={view.chart ? 'active' : ''} onClick={() => !view.chart && view.onChange()} title="Show as charts">Chart</button>
          </span>
        )}
        <span className="grip" aria-hidden>⋮⋮</span>
      </div>
      {!collapsed && <div className={sectionKey in VISUAL_SET ? 'report-visual' : ''}>{children}</div>}
    </div>
  );
}

const VISUAL_SET = Object.fromEntries(VISUAL_KEYS.map((k) => [k, true]));

/** The chart sections, built from whatever trades pass the filters; null when there's nothing to draw. */
function useVisuals(trades: Trade[]): Record<string, ReactNode | null> {
  return useMemo(() => {
    const closed = trades.filter((t) => t.status === 'CLOSED');
    const score = tradeScore(closed);
    const days = [...statsByDay(closed).values()].filter((d) => d.netPnl !== 0).sort((a, b) => a.date.localeCompare(b.date));
    const dd = drawdown(closed);
    return {
      score: score && (
        <div className="score-visual">
          <RadarChart score={score} width={330} radius={88} />
          <ul className="score-list">
            {score.axes.map((a) => (
              <li key={a.key} title={a.explain}>
                <span>{a.label}</span><b>{a.value}</b>
                <div className="score-track"><div style={{ width: `${a.score}%`, background: colors().chart }} /></div>
              </li>
            ))}
          </ul>
        </div>
      ),
      heatmap: closed.length ? <Heatmap cells={weekdayHourHeat(closed)} /> : null,
      equity: dd.length > 1 ? <EquityDrawdown points={dd} /> : null,
      distribution: closed.length ? <Histogram bins={pnlHistogram(closed)} /> : null,
      daily: days.length ? <DailyBars days={days.slice(-90)} /> : null,
      holdTime: closed.length ? (
        <ScatterChart points={closed.map((t) => ({ x: holdMinutes(t), y: t.netPnl, label: `${shortDate(t.openTime.slice(0, 10))} ${t.underlying} ${t.strike} ${t.putCall === 'CALL' ? 'C' : 'P'}` }))} />
      ) : null,
    };
  }, [trades]);
}

/** A group report as pictures: a donut of where your trades went, and a bar per group for what each made. */
function GroupChart({ rows }: { rows: ReportRow[] }) {
  // With five groups or fewer, each keeps its own color whatever you filter; past that the biggest
  // four get colors and the rest fold into a gray "Other".
  const few = rows.length <= CATEGORY_COLORS.length;
  const slices = foldSlices(rows.map((r, i) => ({ label: r.label, value: r.trades, color: few ? CATEGORY_COLORS[i] : '', detail: `${r.trades} trade${r.trades === 1 ? '' : 's'}` })))
    .map((s, i) => (s.color ? s : { ...s, color: CATEGORY_COLORS[i] }));
  const scale = Math.max(...rows.map((r) => Math.abs(r.netPnl)), 1);
  const total = rows.reduce((a, r) => a + r.trades, 0);
  return (
    <div className="group-chart">
      <div className="group-donut">
        <div className="tile-label">Share of trades</div>
        <Donut slices={slices} center={String(total)} size={120} />
      </div>
      <div className="group-bars">
        <div className="tile-label">Net P&L and win rate</div>
        {rows.map((r) => (
          <div className="group-bar" key={r.key} title={`${r.label}: ${signedUsd(r.netPnl)} over ${r.trades} trades, ${Math.round(r.winRate * 100)}% won`}>
            <span className="group-label">{r.label}</span>
            <div className="bar-track">
              <div className={`bar ${pnlClass(r.netPnl)}-fill ${r.netPnl < 0 ? 'neg' : ''}`} style={{ width: `${(Math.abs(r.netPnl) / scale) * 50}%` }} />
            </div>
            <b className={pnlClass(r.netPnl)}>{signedUsd(r.netPnl)}</b>
            <span className="winrate" style={{ ['--w' as string]: `${Math.round(r.winRate * 100)}%` }}>{Math.round(r.winRate * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportTable({ rows: unsorted }: { rows: ReportRow[] }) {
  const [sort, setSort] = useState<SortState | null>(null);
  const col = sort && COLS.find((c) => c.id === sort.id);
  const rows = col ? sortRows(unsorted, col.value, sort!.dir) : unsorted;
  const header = (id: string) => {
    const c = COLS.find((x) => x.id === id)!;
    return (
      <th className={`sortable ${id === 'label' ? '' : 'num'} ${sort?.id === id ? 'sorted' : ''}`} title={c.title ?? 'Click to sort'}
        onClick={() => setSort(nextSort(sort, id))}>
        {c.label || 'Name'}{sortArrow(sort, id)}
      </th>
    );
  };
  // Bars are scaled to the biggest win or loss in this card.
  const scale = Math.max(...unsorted.map((r) => Math.abs(r.netPnl)), 1);
  return (
    <table>
        <thead>
          <tr>
            {header('label')}
            {header('trades')}
            {header('winRate')}
            {header('netPnl')}
            <th className="bar-col" />
            {header('avgPnl')}
            {header('pf')}
            {header('avgR')}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="report-label">{r.label}</td>
              <td className="num">{r.trades}</td>
              <td className="num">{Math.round(r.winRate * 100)}%</td>
              <td className={`num ${pnlClass(r.netPnl)}`}>{signedUsd(r.netPnl)}</td>
              <td className="bar-col">
                <div className="bar-track">
                  <div className={`bar ${pnlClass(r.netPnl)}-fill ${r.netPnl < 0 ? 'neg' : ''}`} style={{ width: `${(Math.abs(r.netPnl) / scale) * 50}%` }} />
                </div>
              </td>
              <td className={`num ${pnlClass(r.avgPnl)}`}>{signedUsd(r.avgPnl)}</td>
              <td className="num">{r.profitFactor === null ? '—' : r.profitFactor.toFixed(2)}</td>
              <td className="num" title={r.rTrades ? `${r.rTrades} of ${r.trades} trades have a stop` : 'No trades here have a stop line'}>
                {r.avgR === null ? '—' : formatR(r.avgR)}
              </td>
            </tr>
          ))}
        </tbody>
    </table>
  );
}
