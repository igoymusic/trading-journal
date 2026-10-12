// The contract between the screens (renderer) and the main process.

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

export interface JournalApi {
  getJournal(): Promise<JournalData>;
  /** Opens a file picker; resolves to null if the user cancels. */
  importThinkorswim(): Promise<ImportResult | null>;
}

declare global {
  interface Window {
    journal: JournalApi;
  }
}
