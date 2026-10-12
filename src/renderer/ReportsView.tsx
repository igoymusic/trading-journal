import { useMemo } from 'react';
import { buildReports, type ReportRow, type Reports } from '../core/reports';
import { formatR } from '../core/rr';
import type { Trade } from '../core/types';
import { pnlClass, signedUsd } from './format';
import { useJournal } from './journal';

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

function ReportCard({ title, hint, rows }: { title: string; hint?: string; rows: ReportRow[] }) {
  // Bars are scaled to the biggest win or loss in this card.
  const scale = Math.max(...rows.map((r) => Math.abs(r.netPnl)), 1);
  return (
    <div className="card report">
      <div className="report-head">
        <h3>{title}</h3>
        {hint && <span className="muted">{hint}</span>}
      </div>
      <table>
        <thead>
          <tr>
            <th />
            <th className="num">Trades</th>
            <th className="num">Win %</th>
            <th className="num">Net P&amp;L</th>
            <th className="bar-col" />
            <th className="num">Avg</th>
            <th className="num" title="Total won divided by total lost. Above 1 means it made money.">PF</th>
            <th className="num" title="Average R over the trades that have a stop line set">Avg R</th>
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
