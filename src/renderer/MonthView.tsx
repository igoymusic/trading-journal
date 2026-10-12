import { buildMonth, shiftMonth } from '../core/calendar';
import type { Trade } from '../core/types';
import { pnlClass, signedUsd } from './format';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function compactUsd(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  const abs = Math.abs(n);
  // Cents matter on small days; big days drop them so the cell stays readable.
  const body = abs >= 10_000 ? `${(abs / 1000).toFixed(1)}k`
    : abs.toLocaleString('en-US', { minimumFractionDigits: abs >= 1000 ? 0 : 2, maximumFractionDigits: abs >= 1000 ? 0 : 2 });
  return `${sign}$${body}`;
}

/** P&L calendar for one month. Each day shows its P&L; the right column totals each week. */
export function MonthView({ trades, year, month, onMonthChange, onOpenDay }: {
  trades: Trade[];
  year: number;
  month: number;
  onMonthChange: (year: number, month: number) => void;
  onOpenDay: (date: string) => void;
}) {
  const cal = buildMonth(trades, year, month);
  const title = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const go = (by: number) => { const m = shiftMonth(year, month, by); onMonthChange(m.year, m.month); };

  return (
    <section className="month">
      <div className="month-head">
        <div className="month-nav">
          <button onClick={() => go(-1)} aria-label="Previous month">‹</button>
          <h2>{title}</h2>
          <button onClick={() => go(1)} aria-label="Next month">›</button>
        </div>
        <div className="month-stats">
          <span>Month <b className={pnlClass(cal.netPnl)}>{signedUsd(cal.netPnl)}</b></span>
          <span className="muted">{cal.tradedDays} trading day{cal.tradedDays === 1 ? '' : 's'} · <span className="win">{cal.greenDays} green</span> · <span className="loss">{cal.redDays} red</span></span>
        </div>
      </div>

      <div className="cal-grid">
        {WEEKDAYS.map((d) => <div key={d} className="cal-weekday">{d}</div>)}
        <div className="cal-weekday">Week</div>

        {cal.weeks.map((w, i) => (
          <div className="cal-row" key={w.days[0].date}>
            {w.days.map((d) => {
              const traded = d.inMonth && d.trades > 0;
              const tone = traded ? pnlClass(d.netPnl) : '';
              return (
                <div
                  key={d.date}
                  className={`cal-day ${d.inMonth ? '' : 'outside'} ${traded ? `traded ${tone}-bg` : ''}`}
                  onClick={traded ? () => onOpenDay(d.date) : undefined}
                  title={traded ? 'Open this day' : undefined}
                >
                  <div className="cal-date">{Number(d.date.slice(8))}</div>
                  {traded && (
                    <>
                      <div className={`cal-pnl ${tone}`}>{compactUsd(d.netPnl)}</div>
                      <div className="cal-sub">{d.trades} trade{d.trades === 1 ? '' : 's'}</div>
                      {d.wins + d.losses > 0 && <div className="cal-sub">{Math.round((d.wins / (d.wins + d.losses)) * 100)}% win</div>}
                    </>
                  )}
                </div>
              );
            })}
            <div className="cal-week">
              <div className="cal-date">Week {i + 1}</div>
              {w.trades > 0 ? (
                <>
                  <div className={`cal-pnl ${pnlClass(w.netPnl)}`}>{compactUsd(w.netPnl)}</div>
                  <div className="cal-sub">{w.tradedDays} day{w.tradedDays === 1 ? '' : 's'} · {w.trades} trade{w.trades === 1 ? '' : 's'}</div>
                </>
              ) : <div className="cal-sub">No trades</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
