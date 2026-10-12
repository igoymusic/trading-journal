import { useRef } from 'react';
import { tradeDay } from '../core/calendar';
import type { Trade } from '../core/types';
import { longDate } from './format';
import { TradePanel } from './TradePanel';
import { TradeTable } from './TradeTable';

/** Every trade from one day: the trade list on top, then each trade's chart. */
export function DayView({ trades, date, chartVersion, onOpenSettings }: {
  /** All trades; this view picks out the day's own. */
  trades: Trade[];
  date: string;
  chartVersion: number;
  onOpenSettings: () => void;
}) {
  const panels = useRef(new Map<string, HTMLDivElement>());
  const dayTrades = trades.filter((t) => tradeDay(t) === date);

  return (
    <section className="day">
      <h2 className="view-title">{longDate(date)}</h2>
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
