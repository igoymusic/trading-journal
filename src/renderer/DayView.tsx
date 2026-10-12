import { useRef } from 'react';
import { neighborDay, tradeDay } from '../core/calendar';
import type { Trade } from '../core/types';
import { longDate } from './format';
import { TradePanel } from './TradePanel';
import { TradeTable } from './TradeTable';

/** Every trade from one day: the trade list on top, then each trade's chart. */
export function DayView({ trades, date, chartVersion, onDayChange, onOpenSettings }: {
  /** All trades; this view picks out the day's own. */
  trades: Trade[];
  date: string;
  chartVersion: number;
  onDayChange: (date: string) => void;
  onOpenSettings: () => void;
}) {
  const panels = useRef(new Map<string, HTMLDivElement>());
  const dayTrades = trades.filter((t) => tradeDay(t) === date);
  const tradedDays = trades.map(tradeDay);
  const prev = neighborDay(tradedDays, date, -1);
  const next = neighborDay(tradedDays, date, 1);

  return (
    <section className="day">
      <div className="month-head">
        <div className="month-nav">
          <button disabled={!prev} onClick={() => prev && onDayChange(prev)} aria-label="Previous trading day">‹</button>
          <h2>{longDate(date)}</h2>
          <button disabled={!next} onClick={() => next && onDayChange(next)} aria-label="Next trading day">›</button>
        </div>
      </div>
      {dayTrades.length === 0 ? <p className="muted day-empty">No trades on this day.</p> : (
        <>
          <TradeTable
            trades={dayTrades}
            selectedId={null}
            onSelect={(id) => panels.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
          {dayTrades.map((t) => (
            <div key={`${t.id}:${chartVersion}`} ref={(el) => { if (el) panels.current.set(t.id, el); else panels.current.delete(t.id); }}>
              <TradePanel trade={t} onOpenSettings={onOpenSettings} />
            </div>
          ))}
        </>
      )}
    </section>
  );
}
