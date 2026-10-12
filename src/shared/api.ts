// The contract between the screens (renderer) and the main process.

import type { Bar } from '../core/alpaca';
import type { MistakeTag, Setup, Trade, TradeJournal } from '../core/types';
import type { Summary } from '../core/trades';

export interface JournalData {
  /** Each trade carries its journal entry, if it has one. */
  trades: Trade[];
  summary: Summary;
  setups: Setup[];
  mistakes: MistakeTag[];
  /** Daily notes keyed by "YYYY-MM-DD". */
  dayNotes: Record<string, string>;
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
  /** Visible trade table columns in order; undefined means the defaults. */
  tradeColumns?: string[];
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
  /** Saves the trade table's columns; null restores the defaults. */
  setTradeColumns(ids: string[] | null): Promise<void>;
  saveTradeJournal(tradeId: string, journal: TradeJournal): Promise<void>;
  saveSetups(setups: Setup[]): Promise<void>;
  saveMistakes(mistakes: MistakeTag[]): Promise<void>;
  saveDayNote(date: string, notes: string): Promise<void>;
}

declare global {
  interface Window {
    journal: JournalApi;
  }
}
