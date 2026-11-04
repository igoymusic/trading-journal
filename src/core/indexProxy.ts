// Index options (SPXW, SPX, XSP) trade on an index that free stock data doesn't carry. Their
// chart is drawn from the ETF that tracks the index (SPY), scaled by that day's index ÷ ETF
// ratio, taken from the official daily closes. The ratio barely moves within a day, so the
// result lands within a point or two of the real index.

import { zonedToUtcMillis } from './time';

export interface IndexProxy {
  /** The ETF whose minute prices stand in for the index. */
  etf: string;
  /** FRED series with the index's official daily close. */
  fredSeries: string;
  /** Yahoo Finance's symbol for the index, the backup source of daily closes. */
  yahooSymbol: string;
  /** XSP is a tenth of SPX. */
  scale: number;
}

const PROXIES: Record<string, IndexProxy> = {
  SPX: { etf: 'SPY', fredSeries: 'SP500', yahooSymbol: '^GSPC', scale: 1 },
  SPXW: { etf: 'SPY', fredSeries: 'SP500', yahooSymbol: '^GSPC', scale: 1 },
  XSP: { etf: 'SPY', fredSeries: 'SP500', yahooSymbol: '^GSPC', scale: 0.1 },
};

export const indexProxy = (symbol: string): IndexProxy | undefined => PROXIES[symbol.toUpperCase()];

/** FRED's CSV ("observation_date,SP500" then "2026-10-09,6750.43"; "." when missing) -> date -> close. */
export function parseFredCsv(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const [date, value] = line.split(',');
    const n = Number(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && value && value !== '.' && Number.isFinite(n) && n > 0) out.set(date, n);
  }
  return out;
}

/**
 * Yahoo Finance's daily chart JSON -> New York date -> close. A day still trading (before 4:15pm
 * New York time) is left out, since its "close" is only the latest price.
 */
export function parseYahooChart(json: unknown, now = Date.now()): Map<string, number> {
  const out = new Map<string, number>();
  const result = (json as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } })?.chart?.result?.[0];
  const times = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  times.forEach((t, i) => {
    const close = closes[i];
    if (typeof close !== 'number' || !Number.isFinite(close) || close <= 0) return;
    const day = new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    if (zonedToUtcMillis(`${day}T16:15:00`, 'America/New_York') > now) return;
    out.set(day, Math.round(close * 100) / 100);
  });
  return out;
}

/**
 * The trading day whose closes set the ratio for `day`: that day if its close is published,
 * otherwise the latest earlier one (today's close isn't out until after the bell).
 */
export function ratioDay(day: string, closes: Map<string, number>): string | undefined {
  let best: string | undefined;
  for (const d of closes.keys()) if (d <= day && (!best || d > best)) best = d;
  return best;
}
