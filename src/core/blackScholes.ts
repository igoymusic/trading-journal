// Black-Scholes option pricing, used to estimate what an option would have been worth if the
// underlying had reached a stop or target you placed. It's an estimate: it assumes the option's
// implied volatility stays where it was at your entry.

/** Annual risk-free rate. Small effect on short-dated options, so a fixed value is fine. */
export const RISK_FREE_RATE = 0.04;
const MS_PER_YEAR = 365 * 24 * 3600 * 1000;
/** Never price with less than a minute left, where the formula breaks down. */
const MIN_YEARS = 60_000 / MS_PER_YEAR;

/** Standard normal cumulative distribution (Abramowitz and Stegun 26.2.17, error < 7.5e-8). */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export interface OptionInputs {
  /** Underlying price. */
  spot: number;
  strike: number;
  /** Milliseconds until expiration. */
  msToExpiry: number;
  putCall: 'CALL' | 'PUT';
}

/** Option price per share for a volatility (0.25 = 25%). */
export function bsPrice({ spot, strike, msToExpiry, putCall }: OptionInputs, vol: number): number {
  const t = Math.max(msToExpiry / MS_PER_YEAR, MIN_YEARS);
  const r = RISK_FREE_RATE;
  const sd = vol * Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (r + (vol * vol) / 2) * t) / sd;
  const d2 = d1 - sd;
  const discounted = strike * Math.exp(-r * t);
  return putCall === 'CALL'
    ? spot * normCdf(d1) - discounted * normCdf(d2)
    : discounted * normCdf(-d2) - spot * normCdf(-d1);
}

/**
 * The volatility that makes the formula match a price you actually paid, found by bisection.
 * Null when the price is below what the option is worth with zero volatility (no answer exists).
 */
export function impliedVol(price: number, inputs: OptionInputs): number | null {
  let lo = 0.001;
  let hi = 10;
  if (price < bsPrice(inputs, lo) - 1e-9 || price > bsPrice(inputs, hi)) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(inputs, mid) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
