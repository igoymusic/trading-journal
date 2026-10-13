// Builds everything a trade's chart needs: the underlying's minute candles for each day the trade
// spans, and the underlying's exact price at every fill. Results are cached in the database.

import { AlpacaClient, type Bar, occSymbol } from '../core/alpaca';
import { type LevelPrice, priceLevels } from '../core/optionLevels';
import { zonedToUtcMillis } from '../core/time';
import type { PriceLevel, Trade } from '../core/types';
import type { LevelPrices, TradeChart } from '../shared/api';
import type { JournalDb } from './db';
import type { Settings } from './settings';

/** Pre-market through after-hours, in New York time. */
const SESSION_START = '04:00:00';
const SESSION_END = '20:00:00';
/** Alpaca's free plan can't serve the most recent 15 minutes. */
const FREE_PLAN_DELAY_MS = 16 * 60_000;

export function tradingDays(trade: Trade): string[] {
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

/** Index underlyings (SPXW options trade on SPX) that stock market data doesn't carry. */
const INDEXES = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'RUT', 'RUTW', 'VIX', 'XSP', 'DJX']);

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

  // Nothing to chart, e.g. SPX: Alpaca's stock data has no index prices.
  if (!bars.length) {
    const index = INDEXES.has(symbol) ? ` ${symbol} is an index, and Alpaca's market data only covers stocks and ETFs.` : '';
    return { status: 'error', message: `No ${symbol} prices for this trade's days.${index}` };
  }

  const fills = [];
  for (const fill of trade.fills) {
    const fillMillis = zonedToUtcMillis(fill.execTime, tz);
    let price = db.fillPrice(fill.id);
    // A fill the broker only dated has no real time, so there's no "price at that second" to look up.
    if (!price && fill.timeExact !== false && fillMillis < now - FREE_PLAN_DELAY_MS) {
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

/** Alpaca's option history starts here. */
const OPTION_DATA_START = Date.UTC(2024, 1, 1);

/** The option's own minute candles over the trade's days, cached like the underlying's. Empty if unavailable. */
async function optionBars(trade: Trade, client: AlpacaClient, db: JournalDb): Promise<Bar[]> {
  const occ = occSymbol(trade.underlying, trade.expiry, trade.putCall, trade.strike);
  const key = `O:${occ}`;
  const now = Date.now();
  const out: Bar[] = [];
  for (const day of tradingDays(trade)) {
    const start = zonedToUtcMillis(`${day}T${SESSION_START}`, 'America/New_York');
    const fullEnd = zonedToUtcMillis(`${day}T${SESSION_END}`, 'America/New_York');
    if (start < OPTION_DATA_START) continue;
    if (db.barDay(key, day)) {
      out.push(...db.minuteBars(key, start, fullEnd));
      continue;
    }
    const end = Math.min(fullEnd, now - FREE_PLAN_DELAY_MS);
    try {
      const bars = await client.optionMinuteBars(occ, start, end);
      if (end === fullEnd) db.saveBarDay(key, day, 'opra', bars);
      out.push(...bars);
    } catch {
      // No option data on this plan or for this contract: the estimate covers it.
    }
  }
  return out;
}

/** Option prices at each stop and target line. Null when the chart or entry price isn't available. */
export async function levelOptionPrices(trade: Trade, stops: PriceLevel[], targets: PriceLevel[], db: JournalDb, settings: Settings, fetchFn?: typeof fetch): Promise<LevelPrices | null> {
  const chart = await buildTradeChart(trade, db, settings, fetchFn);
  if (chart.status !== 'ok') return null;
  const entrySide = trade.direction === 'LONG' ? 'BUY' : 'SELL';
  const entryFill = trade.fills.find((f) => f.side === entrySide);
  const point = chart.fills.find((p) => p.fillId === entryFill?.id);
  if (!entryFill || point?.underlyingPrice === undefined) return null;

  const client = new AlpacaClient(settings.alpacaCredentials()!, fetchFn as any, process.env.TJ_ALPACA_BASE_URL || undefined);
  const common = {
    trade,
    bars: chart.bars,
    entry: { time: point.time, underlying: point.underlyingPrice, optionPrice: entryFill.price },
    exitTime: trade.closeTime ? zonedToUtcMillis(trade.closeTime, settings.timeZone) : Date.now(),
    expiryTime: zonedToUtcMillis(`${trade.expiry}T16:00:00`, 'America/New_York'),
    optionBars: await optionBars(trade, client, db),
  };
  return { stops: priceLevels({ ...common, levels: stops }), targets: priceLevels({ ...common, levels: targets }) };
}
