import { useMemo, useState } from 'react';
import { buildReports, type ReportRow, type Reports } from '../core/reports';
import { formatR } from '../core/rr';
import type { Trade } from '../core/types';
import { pnlClass, signedUsd } from './format';
import { useJournal } from './journal';
import { nextSort, sortArrow, sortRows, type SortState } from './sorting';

const SECTIONS: { key: keyof Reports; title: string; hint?: string }[] = [
  { key: 'setup', title: 'By setup' },
  { key: 'mistake', title: 'By mistake', hint: 'A trade with two mistakes counts under both.' },
  { key: 'dte', title: 'By days to expiry', hint: 'Counted from the day you opened the trade.' },
  { key: 'timeOfDay', title: 'By time of day', hint: 'Grouped by when you entered, in half hours.' },
  { key: 'putCall', title: 'Calls vs puts' },
  { key: 'direction', title: 'Long vs short' },
  { key: 'weekday', title: 'By day of week' },
  { key: 'symbol', title: 'By symbol' },
  { key: 'rating', title: 'By rating' },
];

/** Results broken out several ways. Uses whatever trades pass the filters. */
export function ReportsView({ trades }: { trades: Trade[] }) {
  const { setups, mistakes } = useJournal();
  const reports = useMemo(() => buildReports(trades, setups, mistakes), [trades, setups, mistakes]);
  if (!trades.some((t) => t.status === 'CLOSED')) return <p className="muted reports-empty">No closed trades match these filters.</p>;
  return (
    <section className="reports">
      {SECTIONS.map((s) => <ReportCard key={s.key} title={s.title} hint={s.hint} rows={reports[s.key]} />)}
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

function ReportCard({ title, hint, rows: unsorted }: { title: string; hint?: string; rows: ReportRow[] }) {
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
    <div className="card report">
      <div className="report-head">
        <h3>{title}</h3>
        {hint && <span className="muted">{hint}</span>}
      </div>
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
    </div>
  );
}
