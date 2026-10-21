// Builds everything a trade's chart needs: the underlying's minute candles for each day the trade
// spans, and the underlying's exact price at every fill. Results are cached in the database.

import { AlpacaClient, type Bar, occSymbol } from '../core/alpaca';
import { type IndexProxy, indexProxy, parseFredCsv, parseYahooChart, ratioDay } from '../core/indexProxy';
import type { DayBar } from '../core/indicators';
import { type LevelPrice, priceLevels } from '../core/optionLevels';
import { zonedToUtcMillis } from '../core/time';
import type { PriceLevel, Trade } from '../core/types';
import type { LevelPrices, TradeChart } from '../shared/api';
import type { JournalDb } from './db';
import { fetchWithTimeout } from './fetchTimeout';
import type { SchwabSync } from './schwab';
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

/** Schwab's names for the indexes that index options trade on. */
const SCHWAB_INDEX: Record<string, string> = {
  SPX: '$SPX', SPXW: '$SPX', XSP: '$XSP', NDX: '$NDX', NDXP: '$NDX', RUT: '$RUT', RUTW: '$RUT', VIX: '$VIX', DJX: '$DJX',
};

export async function buildTradeChart(trade: Trade, db: JournalDb, settings: Settings, fetchFn?: typeof fetch, schwab?: SchwabSync): Promise<TradeChart> {
  // Index options chart the real index when Schwab is signed in and has its minutes.
  const schwabSymbol = SCHWAB_INDEX[trade.underlying];
  if (schwabSymbol && schwab?.status().signedIn) {
    const chart = await schwabIndexChart(trade, schwabSymbol, db, settings, schwab).catch(() => null);
    if (chart) return chart;
  }
  const creds = settings.alpacaCredentials();
  if (!creds) return { status: 'needs-key' };
  const client = new AlpacaClient(creds, fetchFn as any, process.env.TJ_ALPACA_BASE_URL || undefined);
  const tz = settings.timeZone;
  const now = Date.now();
  // Index options chart the tracking ETF, scaled to the index each day.
  const proxy = indexProxy(trade.underlying);
  const symbol = proxy?.etf ?? trade.underlying;
  const ratios = new Map<string, number>();
  if (proxy) {
    for (const day of tradingDays(trade)) {
      const r = await indexRatio(proxy, day, client, db, fetchFn ?? fetch).catch(() => undefined);
      if (r) ratios.set(day, r);
    }
    if (!ratios.size) {
      return { status: 'error', message: `Couldn't get ${trade.underlying}'s daily closes (from FRED or Yahoo Finance) to estimate its prices from ${proxy.etf}. Check your internet connection and try again in a couple of minutes, or sign in to Schwab in Settings to chart the real index.` };
    }
  }
  const nyDay = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const ratioAt = (ms: number) => (proxy ? ratios.get(nyDay(ms)) ?? [...ratios.values()][0] : 1);
  const scale = (b: Bar): Bar => {
    const r = ratioAt(b.time);
    return r === 1 ? b : { ...b, open: b.open * r, high: b.high * r, low: b.low * r, close: b.close * r };
  };

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
        const p = Math.round(print.price * ratioAt(fillMillis) * 100) / 100;
        db.saveFillPrice(fill.id, p, print.time, proxy ? `${print.feed}:${proxy.etf}` : print.feed);
        price = { price: p, tradeTime: print.time, feed: print.feed };
      }
    }
    fills.push({ fillId: fill.id, time: fillMillis, underlyingPrice: price?.price, priceTime: price?.tradeTime });
  }

  return {
    status: 'ok', symbol: proxy ? trade.underlying : symbol, timeZone: tz, feed, bars: proxy ? bars.map(scale) : bars, fills,
    ...(proxy ? { estimatedFrom: proxy.etf } : {}),
  };
}

/** The trade on the index's own one-minute prices from Schwab; null if Schwab doesn't have every day. */
async function schwabIndexChart(trade: Trade, symbol: string, db: JournalDb, settings: Settings, schwab: SchwabSync): Promise<TradeChart | null> {
  const bars: Bar[] = [];
  for (const day of tradingDays(trade)) {
    const start = zonedToUtcMillis(`${day}T${SESSION_START}`, 'America/New_York');
    const end = zonedToUtcMillis(`${day}T${SESSION_END}`, 'America/New_York');
    if (db.barDay(symbol, day)) {
      bars.push(...db.minuteBars(symbol, start, end));
      continue;
    }
    const fetched = await schwab.indexBars(symbol, start, end);
    if (!fetched) return null;
    if (end < Date.now()) db.saveBarDay(symbol, day, 'schwab', fetched);
    bars.push(...fetched);
  }
  const tz = settings.timeZone;
  const fills = trade.fills.map((fill) => {
    const time = zonedToUtcMillis(fill.execTime, tz);
    // An index has no trades of its own: read the price partway through the minute the fill was in.
    const bar = fill.timeExact === false ? undefined : bars.find((b) => b.time <= time && time < b.time + 60_000);
    const underlyingPrice = bar ? Math.round((bar.open + ((bar.close - bar.open) * (time - bar.time)) / 60_000) * 100) / 100 : undefined;
    return { fillId: fill.id, time, underlyingPrice, priceTime: bar ? time : undefined };
  });
  return { status: 'ok', symbol: trade.underlying, timeZone: tz, feed: 'schwab', bars, fills };
}

/** The index's daily closes from FRED (free, no account), cached; refetched when a newer day is needed. */
/** How long to wait for each source of daily index closes. */
export const FRED_TIMEOUT_MS = 15_000;

/**
 * The app sets this to Electron's own network stack (the same one as Chrome). FRED and Yahoo
 * can stall or refuse requests that don't look like they come from a browser.
 */
let webFetch: typeof fetch | undefined;
export function useWebFetch(fn: typeof fetch) {
  webFetch = fn;
}

const BROWSER_HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' };

/** The index's official daily closes from FRED, or from Yahoo Finance if FRED doesn't answer. */
async function downloadCloses(proxy: IndexProxy, fetchFn: typeof fetch): Promise<Map<string, number>> {
  const get = fetchWithTimeout(webFetch ?? fetchFn, FRED_TIMEOUT_MS);
  const fred = process.env.TJ_FRED_URL || 'https://fred.stlouisfed.org/graph/fredgraph.csv';
  const fromFred = await get(`${fred}?id=${encodeURIComponent(proxy.fredSeries)}`, { headers: { ...BROWSER_HEADERS, accept: 'text/csv,*/*' } })
    .then(async (res) => (res.ok ? parseFredCsv(await res.text()) : null))
    .catch(() => null);
  if (fromFred?.size) return fromFred;
  const yahoo = process.env.TJ_YAHOO_URL || 'https://query1.finance.yahoo.com/v8/finance/chart';
  const fromYahoo = await get(`${yahoo}/${encodeURIComponent(proxy.yahooSymbol)}?range=2y&interval=1d`, { headers: { ...BROWSER_HEADERS, accept: 'application/json' } })
    .then(async (res) => (res.ok ? parseYahooChart(await res.json()) : null))
    .catch(() => null);
  return fromYahoo ?? new Map();
}

async function indexCloses(proxy: IndexProxy, day: string, db: JournalDb, fetchFn: typeof fetch): Promise<Map<string, number>> {
  const key = `fred:${proxy.fredSeries}`;
  const cached = db.getMeta(key);
  let closes = cached ? new Map<string, number>(JSON.parse(cached).closes) : new Map<string, number>();
  const fetchedAt = cached ? JSON.parse(cached).fetchedAt as number : 0;
  const newest = [...closes.keys()].sort().pop() ?? '';
  // Ask again at most hourly, or every couple of minutes while there's nothing saved at all.
  const wait = closes.size ? 60 * 60_000 : 2 * 60_000;
  if (newest < day && Date.now() - fetchedAt > wait) {
    const fresh = await downloadCloses(proxy, fetchFn);
    // Keep older saved closes too: Yahoo's list only goes back two years.
    if (fresh.size) closes = new Map([...closes, ...fresh]);
    db.setMeta(key, JSON.stringify({ fetchedAt: Date.now(), closes: [...closes] }));
  }
  return closes;
}

/** Index ÷ ETF at the close of the latest published day on or before `day`. */
async function indexRatio(proxy: IndexProxy, day: string, client: AlpacaClient, db: JournalDb, fetchFn: typeof fetch): Promise<number | undefined> {
  const closes = await indexCloses(proxy, day, db, fetchFn);
  const ref = ratioDay(day, closes);
  if (!ref) return undefined;
  const cacheKey = `ratio:${proxy.fredSeries}:${proxy.etf}:${ref}`;
  const cached = db.getMeta(cacheKey);
  if (cached) return Number(cached) * proxy.scale;
  // The ETF's last regular-session minute that day.
  const close = zonedToUtcMillis(`${ref}T16:00:00`, 'America/New_York');
  const { bars } = await client.minuteBars(proxy.etf, close - 15 * 60_000, close);
  const last = bars.filter((b) => b.time < close).pop();
  if (!last) return undefined;
  const ratio = closes.get(ref)! / last.close;
  db.setMeta(cacheKey, String(ratio));
  return ratio * proxy.scale;
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

/** Weekdays before `day` (New York date), newest first. */
function weekdaysBefore(day: string, count: number): string[] {
  const out: string[] = [];
  for (let d = new Date(`${day}T12:00:00Z`); out.length < count;) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Minute candles from the trading days before `beforeDay`, from the same source the chart uses,
 * going back until there are at least `count` candles of `minutes` each (or about three months).
 */
export async function historyMinuteBars(
  underlying: string, beforeDay: string, minutes: number, count: number, fromSchwab: boolean,
  db: JournalDb, settings: Settings, schwab?: SchwabSync, fetchFn?: typeof fetch,
): Promise<Bar[]> {
  const schwabSymbol = SCHWAB_INDEX[underlying];
  const creds = settings.alpacaCredentials();
  const client = creds ? new AlpacaClient(creds, fetchFn as any, process.env.TJ_ALPACA_BASE_URL || undefined) : null;
  const proxy = indexProxy(underlying);
  const symbol = fromSchwab && schwabSymbol ? schwabSymbol : proxy?.etf ?? underlying;
  const size = minutes * 60_000;
  const days: Bar[][] = [];
  const buckets = new Set<number>();
  for (const day of weekdaysBefore(beforeDay, 65)) {
    if (buckets.size >= count) break;
    const start = zonedToUtcMillis(`${day}T${SESSION_START}`, 'America/New_York');
    const end = zonedToUtcMillis(`${day}T${SESSION_END}`, 'America/New_York');
    let bars: Bar[];
    if (db.barDay(symbol, day)) bars = db.minuteBars(symbol, start, end);
    else if (fromSchwab && schwabSymbol) {
      // A day Schwab has nothing for (a holiday) is just empty.
      bars = (await schwab?.indexBars(symbol, start, end)) ?? [];
      db.saveBarDay(symbol, day, 'schwab', bars);
    } else if (client) {
      const fetched = await client.minuteBars(symbol, start, end);
      db.saveBarDay(symbol, day, fetched.feed, fetched.bars);
      bars = fetched.bars;
    } else break;
    if (proxy && !(fromSchwab && schwabSymbol) && bars.length && client) {
      const r = await indexRatio(proxy, day, client, db, fetchFn ?? fetch).catch(() => undefined);
      if (!r) continue;
      bars = bars.map((b) => ({ ...b, open: b.open * r, high: b.high * r, low: b.low * r, close: b.close * r }));
    }
    for (const b of bars) buckets.add(Math.floor(b.time / size));
    days.push(bars);
  }
  return days.reverse().flat();
}

/** Completed daily candles before `beforeDay`, at least `count` of them when available. */
export async function historyDailyBars(
  underlying: string, beforeDay: string, count: number, fromSchwab: boolean,
  db: JournalDb, settings: Settings, schwab?: SchwabSync, fetchFn?: typeof fetch,
): Promise<DayBar[]> {
  const schwabSymbol = SCHWAB_INDEX[underlying];
  const proxy = indexProxy(underlying);
  const source = fromSchwab && schwabSymbol ? `schwab:${schwabSymbol}` : proxy ? `fred:${proxy.fredSeries}` : `alpaca:${underlying}`;
  const cacheKey = `daily:${source}:${beforeDay}:${count}`;
  const cached = db.getMeta(cacheKey);
  if (cached) return JSON.parse(cached) as DayBar[];
  // Calendar days to cover that many trading days, with room for holidays.
  const span = Math.ceil(count * 1.5) + 10;
  const startDate = new Date(`${beforeDay}T12:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - span);
  const startDay = startDate.toISOString().slice(0, 10);
  let bars: DayBar[] = [];
  if (fromSchwab && schwabSymbol) {
    bars = (await schwab?.indexDailyBars(schwabSymbol, Date.parse(`${startDay}T00:00:00Z`), Date.parse(`${beforeDay}T00:00:00Z`))) ?? [];
  } else if (proxy) {
    // The index's official closes (no highs or lows, so those match the close).
    const closes = await indexCloses(proxy, beforeDay, db, fetchFn ?? fetch);
    bars = [...closes].filter(([d]) => d >= startDay).sort(([a], [b]) => a.localeCompare(b))
      .map(([day, c]) => { const v = c * proxy.scale; return { day, open: v, high: v, low: v, close: v, volume: 0 }; });
  } else {
    const creds = settings.alpacaCredentials();
    if (!creds) return [];
    const client = new AlpacaClient(creds, fetchFn as any, process.env.TJ_ALPACA_BASE_URL || undefined);
    const end = new Date(`${beforeDay}T12:00:00Z`);
    end.setUTCDate(end.getUTCDate() - 1);
    bars = await client.dailyBars(underlying, startDay, end.toISOString().slice(0, 10));
  }
  bars = bars.filter((b) => b.day < beforeDay);
  // Past days don't change; only keep complete answers.
  if (bars.length) db.setMeta(cacheKey, JSON.stringify(bars));
  return bars;
}

/** A stock or ETF's minute candles on the given days (for borrowing SPY's volume for an index's VWAP). */
export async function etfMinuteBars(symbol: string, days: string[], db: JournalDb, settings: Settings, fetchFn?: typeof fetch): Promise<Bar[]> {
  const creds = settings.alpacaCredentials();
  if (!creds) return [];
  const client = new AlpacaClient(creds, fetchFn as any, process.env.TJ_ALPACA_BASE_URL || undefined);
  const out: Bar[] = [];
  for (const day of days.slice(0, 10)) {
    const start = zonedToUtcMillis(`${day}T${SESSION_START}`, 'America/New_York');
    const fullEnd = zonedToUtcMillis(`${day}T${SESSION_END}`, 'America/New_York');
    if (db.barDay(symbol, day)) { out.push(...db.minuteBars(symbol, start, fullEnd)); continue; }
    const end = Math.min(fullEnd, Date.now() - FREE_PLAN_DELAY_MS);
    const fetched = await client.minuteBars(symbol, start, end);
    if (end === fullEnd) db.saveBarDay(symbol, day, fetched.feed, fetched.bars);
    out.push(...fetched.bars);
  }
  return out;
}
