// The contract between the screens (renderer) and the main process.

import type { Bar } from '../core/alpaca';
import type { Trade } from '../core/types';
import type { Summary } from '../core/trades';

export interface JournalData {
  trades: Trade[];
  summary: Summary;
}

export interface ImportResult {
  file: string;
  found: number;
  added: number;
  duplicates: number;
  skipped: number;
  unmatchedFees: number;
}

export interface FillPoint {
  fillId: string;
  /** Epoch milliseconds (UTC) of the fill. */
  time: number;
  /** The underlying's last trade price at or before the fill's second. */
  underlyingPrice?: number;
  priceTime?: number;
}

export type TradeChart =
  | { status: 'needs-key' }
  | { status: 'error'; message: string }
  | { status: 'ok'; symbol: string; timeZone: string; feed: string; bars: Bar[]; fills: FillPoint[] };

export interface SettingsView {
  timeZone: string;
  hasAlpacaKey: boolean;
}

export interface JournalApi {
  getJournal(): Promise<JournalData>;
  /** Opens a file picker; resolves to null if the user cancels. */
  importThinkorswim(): Promise<ImportResult | null>;
  getTradeChart(tradeId: string): Promise<TradeChart>;
  getSettings(): Promise<SettingsView>;
  /** Saves (or clears, with null) the Alpaca keys after checking they work. */
  saveAlpacaKeys(keys: { keyId: string; secretKey: string } | null): Promise<{ ok: boolean; message: string }>;
  setTimeZone(timeZone: string): Promise<void>;
}

declare global {
  interface Window {
    journal: JournalApi;
  }
}
