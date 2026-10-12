import { tradeDay } from '../core/calendar';
import type { Trade } from '../core/types';
import { longDate } from './format';
import { DayNote, TradeJournalEditor } from './journal';
import { TradePanel } from './TradePanel';
import { TradeTable } from './TradeTable';

/** Every trade from one day. Clicking a trade opens its chart right under it; all start closed. */
export function DayView({ trades, date, chartVersion, dayNote, onSaveDayNote, expanded, onToggle, onOpenSettings }: {
  /** All trades; this view picks out the day's own. */
  trades: Trade[];
  date: string;
  chartVersion: number;
  dayNote: string;
  onSaveDayNote: (date: string, notes: string) => void;
  /** Trades whose charts are open, kept per day so switching tabs doesn't reset them. */
  expanded: ReadonlySet<string>;
  onToggle: (tradeId: string) => void;
  onOpenSettings: () => void;
}) {
  const dayTrades = trades.filter((t) => tradeDay(t) === date);

  return (
    <section className="day">
      <h2 className="view-title">{longDate(date)}</h2>
      <DayNote date={date} initial={dayNote} onSave={onSaveDayNote} />
      {dayTrades.length === 0 ? <p className="muted day-empty">No trades on this day.</p> : (
        <TradeTable
          trades={dayTrades}
          selectedId={null}
          onSelect={onToggle}
          expanded={expanded}
          renderDetail={(t) => (
            <>
              <TradePanel key={`${t.id}:${chartVersion}`} trade={t} onOpenSettings={onOpenSettings} />
              <TradeJournalEditor trade={t} />
            </>
          )}
        />
      )}
    </section>
  );
}
