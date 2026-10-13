// Turns Schwab's own Trader API transactions into fills. Unlike Schwab through SnapTrade, these
// carry the exact second each trade filled, which charts, R and replay need.

import { closeSides, parseOcc, toWallClock } from './snaptrade';
import type { Fill } from './types';

export interface SchwabInstrument {
  assetType?: string;
  symbol?: string;
  underlyingSymbol?: string;
  putCall?: string;
  strikePrice?: number;
  expirationDate?: string;
}

export interface SchwabTransferItem {
  instrument?: SchwabInstrument;
  amount?: number;
  cost?: number;
  price?: number;
  feeType?: string;
  positionEffect?: string;
}

export interface SchwabTransaction {
  activityId: number | string;
  time?: string;
  tradeDate?: string;
  type: string;
  status?: string;
  orderId?: number | string;
  transferItems?: SchwabTransferItem[];
}

/** Execution times from Schwab's order list (the last 60 days), keyed by order id. */
export interface SchwabOrder {
  orderId: number | string;
  orderActivityCollection?: { executionLegs?: { time?: string; price?: number; quantity?: number }[] }[];
}

/** Schwab writes offsets as "+0000"; JavaScript wants "+00:00". */
export function schwabMillis(time: string | undefined): number | null {
  if (!time) return null;
  const ms = Date.parse(time.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(ms) ? ms : null;
}

const midnightUtc = (ms: number) => ms % 86_400_000 === 0;

/**
 * Fills for one account. `account` is the name shown in the journal (never the account number).
 * Trades become fills at their real time; expirations close what was open at 4pm.
 */
export function transactionsToFills(transactions: SchwabTransaction[], orders: SchwabOrder[], opts: {
  account: string;
  timeZone: string;
  existing?: Fill[];
}): Fill[] {
  const legTimes = new Map<string, number[]>();
  for (const o of orders) {
    const times = (o.orderActivityCollection ?? []).flatMap((a) => a.executionLegs ?? [])
      .map((l) => schwabMillis(l.time)).filter((t): t is number => t !== null);
    if (times.length) legTimes.set(String(o.orderId), times.sort((a, b) => a - b));
  }

  const fills: Fill[] = [];
  for (const t of transactions) {
    if (t.status && t.status !== 'VALID') continue;
    const items = t.transferItems ?? [];
    const legs = items.filter((i) => i.instrument?.assetType === 'OPTION' && i.amount && i.instrument.symbol);
    if (!legs.length) continue;
    const isTrade = t.type === 'TRADE';
    // RECEIVE_AND_DELIVER with an option is an expiration, assignment or exercise.
    if (!isTrade && t.type !== 'RECEIVE_AND_DELIVER') continue;
    const fees = items.filter((i) => i.feeType).reduce((sum, i) => sum + Math.abs(i.cost ?? 0), 0);

    let ms = schwabMillis(t.time) ?? schwabMillis(t.tradeDate);
    if (ms === null) continue;
    let timeExact = isTrade && !midnightUtc(ms);
    if (isTrade && !timeExact && t.orderId !== undefined) {
      const fromOrder = legTimes.get(String(t.orderId))?.[0];
      if (fromOrder) { ms = fromOrder; timeExact = true; }
    }
    const day = toWallClock(ms, 'America/New_York').slice(0, 10);
    const execTime = isTrade ? (timeExact ? toWallClock(ms, opts.timeZone) : `${day}T12:00:00`) : `${day}T16:00:00`;

    legs.forEach((leg, n) => {
      const occ = parseOcc(leg.instrument!.symbol!);
      if (!occ) return;
      const quantity = Math.abs(leg.amount!);
      fills.push({
        id: `schwab:${t.activityId}:${n}`,
        broker: 'schwab',
        account: opts.account,
        execTime,
        ...(isTrade && !timeExact ? { timeExact: false } : {}),
        underlying: occ.underlying,
        expiry: occ.expiry,
        strike: occ.strike,
        putCall: occ.putCall,
        side: leg.amount! > 0 ? 'BUY' : 'SELL',
        quantity,
        positionEffect: !isTrade || /CLOS/.test(leg.positionEffect ?? '') ? 'CLOSE' : 'OPEN',
        price: isTrade ? Math.abs(leg.price ?? 0) : 0,
        orderType: isTrade ? 'MARKET' : 'EXPIRED',
        spread: legs.length > 1 ? 'MULTI' : 'SINGLE',
        fees: Math.round((fees / legs.length) * 100) / 100,
      });
    });
  }
  return closeSides(fills, opts.existing ?? []);
}
