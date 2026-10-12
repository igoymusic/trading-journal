import { useState } from 'react';
import { yearSummaries } from '../core/calendar';
import type { Trade } from '../core/types';
import { pnlClass, signedUsd } from './format';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function days(n: number) {
  return `${n} day${n === 1 ? '' : 's'} traded`;
}

/**
 * Every year you traded, newest first. The selected year is expanded to its months;
 * clicking it again collapses it, clicking another year selects it, and clicking a month opens it.
 */
export function YearView({ trades, year, openMonths, onSelectYear, onOpenMonth }: {
  trades: Trade[];
  year: number;
  /** Months open in Month tabs, highlighted in the list. */
  openMonths: { year: number; month: number }[];
  onSelectYear: (year: number) => void;
  onOpenMonth: (year: number, month: number) => void;
}) {
  // Collapsing only hides the months; the year stays selected and no tabs close.
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section className="years">
      {yearSummaries(trades).map((y) => {
        const expanded = y.year === year && !collapsed;
        return (
          <div key={y.year} className={`year-block ${expanded ? 'expanded' : ''}`}>
            <button className="year-row" onClick={() => {
              if (y.year === year) setCollapsed(!collapsed);
              else { setCollapsed(false); onSelectYear(y.year); }
            }}>
              <span className="chevron">{expanded ? '▾' : '▸'}</span>
              <span className="year-name">{y.year}</span>
              <span className="muted">{days(y.tradedDays)}</span>
              <span className={`pnl-pill ${pnlClass(y.netPnl)}-bg ${pnlClass(y.netPnl)}`}>{signedUsd(y.netPnl)}</span>
            </button>
            {expanded && y.months.slice().reverse().map((m) => {
              const open = openMonths.some((o) => o.year === y.year && o.month === m.month);
              return (
                <button key={m.month} className={`month-row ${open ? 'open' : ''}`} onClick={() => onOpenMonth(y.year, m.month)}>
                  <span className="month-name">{MONTHS[m.month - 1]}</span>
                  <span className="muted">{days(m.tradedDays)} · {m.trades} trade{m.trades === 1 ? '' : 's'}</span>
                  <span className={`pnl-pill ${pnlClass(m.netPnl)}-bg ${pnlClass(m.netPnl)}`}>{signedUsd(m.netPnl)}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
