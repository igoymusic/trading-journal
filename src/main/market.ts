// Builds everything a trade's chart needs: the underlying's minute candles for each day the trade
// spans, and the underlying's exact price at every fill. Results are cached in the database.

import { AlpacaClient, type Bar } from '../core/alpaca';
import { zonedToUtcMillis } from '../core/time';
import type { Trade } from '../core/types';
import type { TradeChart } from '../shared/api';
import type { JournalDb } from './db';
import type { Settings } from './settings';

/** Pre-market through after-hours, in New York time. */
const SESSION_START = '04:00:00';
const SESSION_END = '20:00:00';
/** Alpaca's free plan can't serve the most recent 15 minutes. */
const FREE_PLAN_DELAY_MS = 16 * 60_000;

function tradingDays(trade: Trade): string[] {
  const first = trade.openTime.slice(0, 10);
  const last = (trade.closeTime ?? trade.openTime).slice(0, 10);
  const days: string[] = [];
  for (let d = new Date(`${first}T12:00:00Z`); days.length < 10; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) days.push(iso);
    if (iso >= last) break;
  }
  return days;
}

export async function buildTradeChart(trade: Trade, db: JournalDb, settings: Settings, fetchFn?: typeof fetch): Promise<TradeChart> {
  const creds = settings.alpacaCredentials();
  if (!creds) return { status: 'needs-key' };
  const client = new AlpacaClient(creds, fetchFn as any, process.env.TJ_ALPACA_BASE_URL || undefined);
  const symbol = trade.underlying;
  const tz = settings.timeZone;
  const now = Date.now();

  const bars: Bar[] = [];
  let feed = 'sip';
  for (const day of tradingDays(trade)) {
    // Market sessions are defined in New York time, whatever zone the trader is in.
    const start = zonedToUtcMillis(`${day}T${SESSION_START}`, 'America/New_York');
    const end = Math.min(zonedToUtcMillis(`${day}T${SESSION_END}`, 'America/New_York'), now - FREE_PLAN_DELAY_MS);
    const cached = db.barDay(symbol, day);
    const dayIsComplete = end === zonedToUtcMillis(`${day}T${SESSION_END}`, 'America/New_York');
    if (!cached) {
      const fetched = await client.minuteBars(symbol, start, end);
      if (dayIsComplete) db.saveBarDay(symbol, day, fetched.feed, fetched.bars);
      bars.push(...fetched.bars);
      if (fetched.feed === 'iex') feed = 'iex';
    } else {
      bars.push(...db.minuteBars(symbol, start, end));
      if (cached.feed === 'iex') feed = 'iex';
    }
  }

  const fills = [];
  for (const fill of trade.fills) {
    const fillMillis = zonedToUtcMillis(fill.execTime, tz);
    let price = db.fillPrice(fill.id);
    if (!price && fillMillis < now - FREE_PLAN_DELAY_MS) {
      const print = await client.lastTradeAtOrBefore(symbol, fillMillis);
      if (print) {
        db.saveFillPrice(fill.id, print.price, print.time, print.feed);
        price = { price: print.price, tradeTime: print.time, feed: print.feed };
      }
    }
    fills.push({ fillId: fill.id, time: fillMillis, underlyingPrice: price?.price, priceTime: price?.tradeTime });
  }

  return { status: 'ok', symbol, timeZone: tz, feed, bars, fills };
}
