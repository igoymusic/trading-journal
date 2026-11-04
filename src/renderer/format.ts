// Display helpers. Option prices show as quoted ($0.20) or per contract ($20.00), as picked in Settings.

import { futureLabel } from '../core/futures';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

export function usd(n: number): string {
  return money.format(n);
}

export type OptionPriceDisplay = 'quote' | 'contract';
let optionDisplay: OptionPriceDisplay = 'contract';

/** Shows option prices as quoted ($0.15) or as paid per contract ($15.00). */
export function setOptionPriceDisplay(mode: OptionPriceDisplay | undefined) {
  optionDisplay = mode ?? 'contract';
}

/** An option's price (as quoted) in the style picked in Settings. */
export function optionUsd(quote: number): string {
  return money.format(optionDisplay === 'contract' ? quote * 100 : quote);
}

/** A per-contract dollar amount (like a trade's average entry, $15.00) in the style picked in Settings. */
export function contractUsd(dollars: number): string {
  return optionUsd(dollars / 100);
}

const points = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** A fill's price: an option's in the style picked in Settings, a future's in points ("5,843.25"). */
export function fillPrice(price: number, x: { contract?: string }): string {
  return x.contract ? points.format(price) : optionUsd(price);
}

/** A trade's per-contract dollars (avg entry or exit) shown like its fills' prices. */
export function tradePrice(dollars: number, t: { contract?: string; multiplier?: number }): string {
  return t.contract ? points.format(dollars / (t.multiplier ?? 1)) : contractUsd(dollars);
}

/** "SPY 580C 10/12" for an option, "/MES Dec 26" for a future. */
export function contractName(t: { underlying: string; strike: number; putCall: string; expiry: string; contract?: string }): string {
  if (t.contract) return futureLabel(t.underlying, t.expiry);
  return `${t.underlying} ${t.strike}${t.putCall === 'CALL' ? 'C' : 'P'} ${shortDate(t.expiry)}`;
}

export function signedUsd(n: number): string {
  return n > 0 ? `+${money.format(n)}` : money.format(n);
}

export function pnlClass(n: number): string {
  return n > 0 ? 'win' : n < 0 ? 'loss' : 'flat';
}

/** "2026-10-12T11:49:07" -> "11:49:07" */
export function timeOf(iso: string): string {
  return iso.slice(11, 19);
}

/** "2026-10-12" -> "Mon, Oct 12, 2026" */
export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/** "2026-10-12" -> "10/12" */
export function shortDate(isoDate: string): string {
  return `${Number(isoDate.slice(5, 7))}/${Number(isoDate.slice(8, 10))}`;
}

export function holdTime(openIso: string, closeIso?: string): string {
  if (!closeIso) return 'open';
  const seconds = (Date.parse(closeIso) - Date.parse(openIso)) / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  return `${Math.round(seconds / 86400)}d`;
}
