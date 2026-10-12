// What the option would have been worth at each stop or target line, so risk and reward can be
// shown in dollars. Where the underlying actually reached a line, the option's real price at that
// minute is used when it's known; otherwise it's estimated with Black-Scholes, holding the
// volatility implied by your entry fill.

import type { Bar } from './alpaca';
import { bsPrice, impliedVol } from './blackScholes';
import type { PriceLevel, Trade } from './types';

export interface LevelPrice {
  /** Option price per share at the level. */
  optionPrice: number;
  /** "market": the option's real price when the underlying got there; "estimate": Black-Scholes. */
  source: 'market' | 'estimate';
  /** When the underlying reached the level (or the time the estimate assumes), epoch ms. */
  time: number;
  reached: boolean;
}

export interface LevelPricingInput {
  trade: Trade;
  levels: PriceLevel[];
  /** The underlying's minute candles covering the trade. */
  bars: Bar[];
  /** Epoch ms and underlying price of the first entry fill. */
  entry: { time: number; underlying: number; optionPrice: number };
  /** Epoch ms of the exit (or now, for an open trade). */
  exitTime: number;
  /** Epoch ms when the option expires. */
  expiryTime: number;
  /** The option's real minute candles, if available. */
  optionBars?: Bar[];
}

/** Volatility assumed when the entry fill can't be explained by any volatility. */
const FALLBACK_VOL = 0.2;

/** First candle at or after `from` whose range includes `price`. */
function firstTouch(bars: Bar[], price: number, from: number): Bar | undefined {
  const fromMinute = Math.floor(from / 60_000) * 60_000;
  return bars.find((b) => b.time >= fromMinute && b.low <= price && price <= b.high);
}

/** The option candle for that minute, or the most recent one in the five minutes before it. */
function optionPriceAt(optionBars: Bar[] | undefined, time: number): number | undefined {
  if (!optionBars?.length) return undefined;
  let best: Bar | undefined;
  for (const b of optionBars) if (b.time <= time && b.time > time - 5 * 60_000) best = b;
  return best?.close;
}

export function priceLevels({ trade, levels, bars, entry, exitTime, expiryTime, optionBars }: LevelPricingInput): (LevelPrice | null)[] {
  const vol = impliedVol(entry.optionPrice, { spot: entry.underlying, strike: trade.strike, msToExpiry: expiryTime - entry.time, putCall: trade.putCall });
  return levels.map((level) => {
    const touch = firstTouch(bars, level.price, entry.time);
    const reached = !!touch && touch.time <= Math.max(exitTime, entry.time);
    // A line that was never reached is priced as if it had been reached at your exit.
    const time = reached ? touch!.time : exitTime;
    const market = reached ? optionPriceAt(optionBars, time) : undefined;
    if (market !== undefined) return { optionPrice: market, source: 'market', time, reached };
    const at = (spot: number, t: number, v: number) => bsPrice({ spot, strike: trade.strike, msToExpiry: expiryTime - t, putCall: trade.putCall }, v);
    // If no volatility explains the entry price (the fill disagrees with the underlying's price,
    // e.g. a stale quote), assume a typical volatility and move the option by the modeled change.
    const optionPrice = vol !== null
      ? at(level.price, time, vol)
      : Math.max(0, entry.optionPrice + at(level.price, time, FALLBACK_VOL) - at(entry.underlying, entry.time, FALLBACK_VOL));
    return { optionPrice, source: 'estimate', time, reached };
  });
}

/** Risk and reward in dollars from priced stops and targets, contract-weighted like R. */
export function dollarRiskReward(trade: Trade, stops: PriceLevel[], stopPrices: (LevelPrice | null)[], targets: PriceLevel[], targetPrices: (LevelPrice | null)[]) {
  const dir = trade.direction === 'LONG' ? 1 : -1;
  // Dollars made per contract if the option were closed at that price (avgEntry is per contract).
  const perContract = (p: LevelPrice) => dir * (p.optionPrice * 100 - trade.avgEntry);
  const sum = (levels: PriceLevel[], prices: (LevelPrice | null)[]) =>
    prices.every((p) => p) && levels.length ? levels.reduce((a, l, i) => a + l.contracts * perContract(prices[i]!), 0) : undefined;
  const stopPnl = sum(stops, stopPrices);
  const targetPnl = sum(targets, targetPrices);
  const risk = stopPnl !== undefined && stopPnl < 0 ? -stopPnl : undefined;
  return { risk, reward: targetPnl, ratio: risk && targetPnl !== undefined ? targetPnl / risk : undefined };
}
