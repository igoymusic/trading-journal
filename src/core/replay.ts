// Trade replay: step through the underlying's chart one minute at a time, seeing your fills
// appear when they happened, as if you were watching it live.

import type { Bar } from './alpaca';
import type { Trade } from './types';

/** How far before the first fill a replay starts. */
export const REPLAY_LEAD_MS = 15 * 60_000;

/** Index of the minute bar a replay starts on: a little before your first fill. */
export function replayStartIndex(bars: Bar[], firstFillTime: number | undefined): number {
  if (!bars.length || firstFillTime === undefined) return 0;
  const i = bars.findIndex((b) => b.time + 60_000 > firstFillTime - REPLAY_LEAD_MS);
  return i < 0 ? 0 : i;
}

/** Whether a fill has happened by the end of the minute bar starting at `barTime`. */
export const filledBy = (fillTime: number, barTime: number) => fillTime < barTime + 60_000;

/**
 * Your position at a point in the replay: contracts still held and P&L locked in by the exits so
 * far (each exit against your average entry, after its fees).
 */
export function positionAt(trade: Pick<Trade, 'direction' | 'avgEntry' | 'fills'>, fillTimes: Map<string, number>, barTime: number) {
  const entrySide = trade.direction === 'LONG' ? 'BUY' : 'SELL';
  const dir = trade.direction === 'LONG' ? 1 : -1;
  let held = 0;
  let realized = 0;
  let entryFees = 0;
  let entered = 0;
  for (const f of trade.fills) {
    const t = fillTimes.get(f.id);
    if (t === undefined || !filledBy(t, barTime)) continue;
    if (f.side === entrySide) {
      held += f.quantity;
      entered += f.quantity;
      entryFees += f.fees;
    } else {
      held -= f.quantity;
      realized += dir * (f.price * 100 - trade.avgEntry) * f.quantity - f.fees;
    }
  }
  // Entry commissions count once you're fully out.
  if (entered && held <= 0) realized -= entryFees;
  return { held: Math.max(0, held), realized: Math.round(realized * 100) / 100, started: entered > 0 };
}
