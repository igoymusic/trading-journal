// Turns what SnapTrade reports for a brokerage account into the same fills a thinkorswim CSV
// gives, so synced trades build, chart and journal exactly like imported ones.
//
// SnapTrade has two lists: "activities" (the full history, but some brokers only give the date)
// and "orders" (the last 90 days, with the exact time each one filled). Fills come from the
// activities and borrow the exact time from the matching order when there is one.

import { sameFill } from './fills';
import { zoneOffsetMinutes } from './time';
import type { Fill, PutCall, Side } from './types';

export interface StOptionSymbol {
  ticker: string;
  option_type: PutCall;
  strike_price: number;
  expiration_date: string;
  is_mini_option?: boolean;
  underlying_symbol?: { symbol?: string } | null;
}

export interface StActivity {
  id: string;
  type: string;
  option_type?: string | null;
  option_symbol?: StOptionSymbol | null;
  price: number;
  units: number;
  fee?: number | null;
  trade_date: string | null;
}

export interface StOrder {
  status: string;
  action: string;
  option_symbol?: StOptionSymbol | null;
  filled_quantity?: string | number | null;
  total_quantity?: string | number | null;
  execution_price?: string | number | null;
  time_executed?: string | null;
  time_updated?: string | null;
}

const TRADE_TYPES = new Set(['BUY', 'SELL']);
const CLOSE_TYPES: Record<string, string> = { OPTIONEXPIRATION: 'EXPIRED', OPTIONASSIGNMENT: 'ASSIGNED', OPTIONEXERCISE: 'EXERCISED' };

/** "SPY   260915C00776000" or "SPY260915C00776000" -> its parts. */
export function parseOcc(ticker: string): { underlying: string; expiry: string; putCall: PutCall; strike: number } | null {
  const m = ticker.replace(/\s+/g, '').match(/^([A-Z0-9.]{1,6}?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  return { underlying: m[1], expiry: `20${m[2]}-${m[3]}-${m[4]}`, putCall: m[5] === 'C' ? 'CALL' : 'PUT', strike: Number(m[6]) / 1000 };
}

function contract(o: StOptionSymbol) {
  const occ = parseOcc(o.ticker);
  return {
    underlying: (o.underlying_symbol?.symbol ?? occ?.underlying ?? '').toUpperCase(),
    expiry: (o.expiration_date ?? occ?.expiry ?? '').slice(0, 10),
    putCall: (o.option_type ?? occ?.putCall) as PutCall,
    strike: Number(o.strike_price ?? occ?.strike),
  };
}

/** UTC instant -> wall-clock "YYYY-MM-DDTHH:MM:SS" in the journal's time zone. */
export function toWallClock(utcMillis: number, timeZone: string): string {
  return new Date(utcMillis + zoneOffsetMinutes(utcMillis, timeZone) * 60_000).toISOString().slice(0, 19);
}

/** A timestamp of exactly midnight UTC is how SnapTrade reports a date without a time. */
const hasTime = (iso: string) => !/T00:00:00(\.0+)?(Z|\+00:00)?$/.test(iso) && iso.includes('T');

/**
 * Fills for one account. `existing` is everything already in the journal, used to tell whether an
 * expiration closed a long or a short position.
 */
export function activitiesToFills(activities: StActivity[], orders: StOrder[], opts: {
  accountId: string;
  accountName: string;
  timeZone: string;
  existing?: Fill[];
}): Fill[] {
  // Executed option orders with a time. An order filled in pieces can time several activities, so
  // each keeps track of how many contracts it still has to give.
  const timed = orders
    .map((o) => ({ o, time: o.time_executed || (/EXECUTED|FILLED/i.test(o.status) ? o.time_updated : null), qty: Number(o.filled_quantity || o.total_quantity) }))
    .filter((x) => x.o.option_symbol && x.time && x.qty > 0)
    .map((x) => ({ ...x, left: x.qty, contract: contract(x.o.option_symbol!) }));

  const fills: Fill[] = [];
  for (const a of activities) {
    const o = a.option_symbol;
    if (!o || o.is_mini_option || !a.trade_date) continue;
    const closeKind = CLOSE_TYPES[a.type];
    if (!TRADE_TYPES.has(a.type) && !closeKind) continue;
    const c = contract(o);
    const qty = Math.abs(a.units);
    if (!c.underlying || !c.expiry || !qty) continue;

    const side: Side = a.type === 'SELL' ? 'SELL' : 'BUY';
    let execTime: string;
    let timeExact = true;
    if (hasTime(a.trade_date)) {
      execTime = toWallClock(Date.parse(a.trade_date), opts.timeZone);
    } else {
      // Borrow the time from the order that matches it, if there is one.
      const day = a.trade_date.slice(0, 10);
      const c0 = contract(o);
      const candidates = closeKind ? [] : timed.filter((t) => t.left >= qty
        && t.contract.expiry === c0.expiry && t.contract.strike === c0.strike && t.contract.putCall === c0.putCall
        && (t.o.action.toUpperCase().startsWith('BUY') ? 'BUY' : 'SELL') === side
        && toWallClock(Date.parse(t.time!), 'America/New_York').slice(0, 10) === day);
      // Prefer the order filled at this price; brokers that leave the price out still match on the rest.
      const priced = (t: (typeof candidates)[number]) => t.o.execution_price != null && t.o.execution_price !== ''
        ? Math.abs(Number(t.o.execution_price) - Math.abs(a.price)) < 0.006 : null;
      const match = candidates.find((t) => priced(t) === true) ?? candidates.find((t) => priced(t) === null);
      if (match) {
        match.left -= qty;
        execTime = toWallClock(Date.parse(match.time!), opts.timeZone);
      } else {
        // No time known: put it at the expiration (4pm) for expirations, otherwise midday.
        execTime = `${day}T${closeKind ? '16:00:00' : '12:00:00'}`;
        timeExact = !!closeKind;
      }
    }

    fills.push({
      id: `snaptrade:${opts.accountId}:${a.id}`,
      broker: 'snaptrade',
      account: opts.accountName,
      execTime,
      timeExact,
      ...c,
      side,
      quantity: qty,
      positionEffect: closeKind || /CLOSE/.test(a.option_type ?? '') ? 'CLOSE' : 'OPEN',
      price: closeKind ? 0 : Math.abs(a.price),
      orderType: closeKind ?? 'MARKET',
      spread: 'SINGLE',
      fees: Math.abs(a.fee ?? 0),
    });
  }
  return closeSides(fills, opts.existing ?? []);
}

/** Expirations, assignments and exercises close whatever was open: sell a long, buy back a short. */
function closeSides(fills: Fill[], existing: Fill[]): Fill[] {
  const key = (f: Fill) => `${f.underlying}|${f.expiry}|${f.strike}|${f.putCall}`;
  const all = [...existing.filter((e) => !fills.some((f) => sameFill(e, f))), ...fills].sort((a, b) => a.execTime.localeCompare(b.execTime));
  const position = new Map<string, number>();
  for (const f of all) {
    const k = key(f);
    const held = position.get(k) ?? 0;
    if (fills.includes(f) && CLOSE_TYPES_SET.has(f.orderType)) {
      f.side = held < 0 ? 'BUY' : 'SELL';
      if (held !== 0) f.quantity = Math.min(f.quantity, Math.abs(held));
    }
    position.set(k, held + (f.side === 'BUY' ? f.quantity : -f.quantity));
  }
  return fills;
}

const CLOSE_TYPES_SET = new Set(Object.values(CLOSE_TYPES));
