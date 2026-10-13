// Index options (SPXW, SPX, XSP) trade on an index that free stock data doesn't carry. Their
// chart is drawn from the ETF that tracks the index (SPY), scaled by that day's index ÷ ETF
// ratio, taken from the official daily closes. The ratio barely moves within a day, so the
// result lands within a point or two of the real index.

export interface IndexProxy {
  /** The ETF whose minute prices stand in for the index. */
  etf: string;
  /** FRED series with the index's official daily close. */
  fredSeries: string;
  /** XSP is a tenth of SPX. */
  scale: number;
}

const PROXIES: Record<string, IndexProxy> = {
  SPX: { etf: 'SPY', fredSeries: 'SP500', scale: 1 },
  SPXW: { etf: 'SPY', fredSeries: 'SP500', scale: 1 },
  XSP: { etf: 'SPY', fredSeries: 'SP500', scale: 0.1 },
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
 * The trading day whose closes set the ratio for `day`: that day if its close is published,
 * otherwise the latest earlier one (today's close isn't out until after the bell).
 */
export function ratioDay(day: string, closes: Map<string, number>): string | undefined {
  let best: string | undefined;
  for (const d of closes.keys()) if (d <= day && (!best || d > best)) best = d;
  return best;
}
