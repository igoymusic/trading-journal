// Futures contracts (traded through Tradovate). A futures fill is stored like an option fill so
// trades, reports and the journal work the same way: strike 0, put/call "CALL" (so a long is
// bullish), `contract` holds the contract's own name ("MESZ6") and `multiplier` its dollars per
// point. Free market data has no futures, so index futures chart on the ETF that tracks the same
// index (SPY for /ES and /MES), with each fill marked at the ETF's price the second it filled.

export interface FutureSpec {
  /** Dollars per one point of price, per contract. */
  multiplier: number;
  /** The ETF whose chart stands in for the future's, if there is one. */
  etf?: string;
  name: string;
}

const SPECS: Record<string, FutureSpec> = {
  ES: { multiplier: 50, etf: 'SPY', name: 'E-mini S&P 500' },
  MES: { multiplier: 5, etf: 'SPY', name: 'Micro E-mini S&P 500' },
  NQ: { multiplier: 20, etf: 'QQQ', name: 'E-mini Nasdaq-100' },
  MNQ: { multiplier: 2, etf: 'QQQ', name: 'Micro E-mini Nasdaq-100' },
  RTY: { multiplier: 50, etf: 'IWM', name: 'E-mini Russell 2000' },
  M2K: { multiplier: 5, etf: 'IWM', name: 'Micro E-mini Russell 2000' },
  YM: { multiplier: 5, etf: 'DIA', name: 'E-mini Dow' },
  MYM: { multiplier: 0.5, etf: 'DIA', name: 'Micro E-mini Dow' },
  CL: { multiplier: 1000, name: 'Crude Oil' },
  MCL: { multiplier: 100, name: 'Micro Crude Oil' },
  QM: { multiplier: 500, name: 'E-mini Crude Oil' },
  NG: { multiplier: 10000, name: 'Natural Gas' },
  GC: { multiplier: 100, name: 'Gold' },
  MGC: { multiplier: 10, name: 'Micro Gold' },
  SI: { multiplier: 5000, name: 'Silver' },
  SIL: { multiplier: 1000, name: 'Micro Silver' },
  HG: { multiplier: 25000, name: 'Copper' },
  ZB: { multiplier: 1000, name: '30-Year T-Bond' },
  ZN: { multiplier: 1000, name: '10-Year T-Note' },
  ZF: { multiplier: 1000, name: '5-Year T-Note' },
  ZT: { multiplier: 2000, name: '2-Year T-Note' },
  '6E': { multiplier: 125000, name: 'Euro FX' },
  M6E: { multiplier: 12500, name: 'Micro Euro FX' },
  '6J': { multiplier: 12500000, name: 'Japanese Yen' },
  '6B': { multiplier: 62500, name: 'British Pound' },
  BTC: { multiplier: 5, name: 'Bitcoin' },
  MBT: { multiplier: 0.1, name: 'Micro Bitcoin' },
  MET: { multiplier: 0.1, name: 'Micro Ether' },
};

export const futureSpec = (root: string): FutureSpec | undefined => SPECS[root.toUpperCase()];

/** The ETF a future's trades chart on (SPY for ES and MES), if any. */
export const futureEtf = (root: string): string | undefined => futureSpec(root)?.etf;

const MONTH_CODES = 'FGHJKMNQUVXZ';

/**
 * "MESZ6" -> { root: "MES", month: "2026-12" }. The year digit is read as the nearest year at or
 * after `asOf`'s decade that isn't more than a year before it (Z6 traded in 2026 is 2026).
 */
export function parseContract(code: string, asOf: string): { root: string; month: string } | null {
  const m = /^([A-Z0-9]{1,4}?)([FGHJKMNQUVXZ])(\d{1,2})$/.exec(code.trim().toUpperCase());
  if (!m) return null;
  const [, root, letter, digits] = m;
  const tradedYear = Number(asOf.slice(0, 4));
  let year: number;
  if (digits.length === 2) year = 2000 + Number(digits);
  else {
    year = Math.floor(tradedYear / 10) * 10 + Number(digits);
    if (year < tradedYear - 1) year += 10;
  }
  const month = MONTH_CODES.indexOf(letter) + 1;
  return { root, month: `${year}-${String(month).padStart(2, '0')}` };
}

/** Third Friday of a "YYYY-MM" month, when the stock index futures expire. */
export function thirdFriday(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const day = 1 + ((5 - first + 7) % 7) + 14;
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** Whether a fill or trade is a futures contract rather than an option. */
export const isFuture = (x: { contract?: string }): boolean => !!x.contract;

/** Dollars per point of price per contract: 100 for options (one contract is 100 shares). */
export const multiplierOf = (x: { multiplier?: number }): number => x.multiplier ?? 100;

/** "/MES Dec 26" style label for a futures contract month. */
export function futureLabel(root: string, expiry: string): string {
  const month = new Date(`${expiry.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `/${root} ${month} ${expiry.slice(2, 4)}`;
}
