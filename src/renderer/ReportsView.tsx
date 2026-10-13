import { useEffect, useMemo, useRef, useState } from 'react';
import { buildReports, type ReportRow, type Reports } from '../core/reports';
import { formatR } from '../core/rr';
import type { Trade } from '../core/types';
import { pnlClass, signedUsd } from './format';
import { useJournal } from './journal';
import { moveSection, normalizeLayout, type ReportsLayout, toggleCollapsed } from './reportsLayout';
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

const KEYS = SECTIONS.map((s) => s.key);

/**
 * Results broken out several ways, using whatever trades pass the filters. Sections sit in two
 * columns that stack tightly; drag a section's title bar to move it, click its arrow to collapse it.
 */
export function ReportsView({ trades }: { trades: Trade[] }) {
  const { setups, mistakes, positives } = useJournal();
  const reports = useMemo(() => buildReports(trades, setups, mistakes, positives), [trades, setups, mistakes, positives]);
  const [layout, setLayout] = useState<ReportsLayout>(() => normalizeLayout(undefined, KEYS));
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ column: number; index: number } | null>(null);
  const columnEls = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => { window.journal.getSettings().then((s) => setLayout(normalizeLayout(s.reportsLayout, KEYS))); }, []);
  function save(next: ReportsLayout) {
    setLayout(next);
    window.journal.setReportsLayout(next);
  }

  const shown = (key: string) => reports[key as keyof Reports].length > 0;

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
              const s = SECTIONS.find((x) => x.key === key)!;
              const marker = dragging && drop?.column === ci && others[drop.index] === key;
              return (
                <div key={key} className="report-slot">
                  {marker && <div className="drop-marker" />}
                  {shown(key) && (
                    <ReportCard
                      sectionKey={key}
                      title={s.title}
                      hint={s.hint}
                      rows={reports[s.key]}
                      collapsed={layout.collapsed.includes(key)}
                      dragging={dragging === key}
                      onToggle={() => save(toggleCollapsed(layout, key))}
                      onDragStart={() => setDragging(key)}
                    />
                  )}
                </div>
              );
            })}
            {dragging && drop?.column === ci && drop.index >= others.length && <div className="drop-marker" />}
          </div>
        );
      })}
    </section>
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

function ReportCard({ sectionKey, title, hint, rows: unsorted, collapsed, dragging, onToggle, onDragStart }: {
  sectionKey: string;
  title: string;
  hint?: string;
  rows: ReportRow[];
  collapsed: boolean;
  dragging: boolean;
  onToggle: () => void;
  onDragStart: () => void;
}) {
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
        <span className="grip" aria-hidden>⋮⋮</span>
      </div>
      {!collapsed && <table>
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
      </table>}
    </div>
  );
}
