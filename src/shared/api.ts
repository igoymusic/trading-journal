// The contract between the screens (renderer) and the main process.

import type { Bar } from '../core/alpaca';
import type { Goals } from '../core/goals';
import type { LevelPrice } from '../core/optionLevels';
import type { MistakeTag, PriceLevel, Setup, Trade, TradeJournal } from '../core/types';
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

/** Option prices at a trade's stop and target lines, in the same order as the lines. */
export interface LevelPrices {
  stops: (LevelPrice | null)[];
  targets: (LevelPrice | null)[];
}

export interface SettingsView {
  timeZone: string;
  hasAlpacaKey: boolean;
  /** Visible trade table columns in order; undefined means the defaults. */
  tradeColumns?: string[];
  goals: Goals;
  reportsLayout?: { columns: string[][]; collapsed: string[] };
}

export interface JournalApi {
  getJournal(): Promise<JournalData>;
  /** Opens a file picker; resolves to null if the user cancels. */
  importThinkorswim(): Promise<ImportResult | null>;
  getTradeChart(tradeId: string): Promise<TradeChart>;
  getLevelPrices(tradeId: string, stops: PriceLevel[], targets: PriceLevel[]): Promise<LevelPrices | null>;
  getSettings(): Promise<SettingsView>;
  /** Saves (or clears, with null) the Alpaca keys after checking they work. */
  saveAlpacaKeys(keys: { keyId: string; secretKey: string } | null): Promise<{ ok: boolean; message: string }>;
  setTimeZone(timeZone: string): Promise<void>;
  /** Saves the trade table's columns; null restores the defaults. */
  setTradeColumns(ids: string[] | null): Promise<void>;
  setGoals(goals: Goals): Promise<void>;
  setReportsLayout(layout: { columns: string[][]; collapsed: string[] }): Promise<void>;
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
