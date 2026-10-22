import type { DayBar, Indicator } from '../core/indicators';
import type { MarkerStyles } from '../core/markerStyles';
// The contract between the screens (renderer) and the main process.

import type { Drawing, PastedDrawing } from '../core/drawings';
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
  positives: MistakeTag[];
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

/** For SPX trades: SPY's own chart ('etf', the default) or SPX itself ('index'). */
export type ChartView = 'etf' | 'index';

export type TradeChart =
  | { status: 'needs-key' }
  | { status: 'error'; message: string }
  | {
    status: 'ok'; symbol: string; timeZone: string; feed: string; bars: Bar[]; fills: FillPoint[];
    /** Set when the index's prices are estimated from this ETF (e.g. SPX from SPY). */
    estimatedFrom?: string;
  };

/** Option prices at a trade's stop and target lines, in the same order as the lines. */
export interface LevelPrices {
  stops: (LevelPrice | null)[];
  targets: (LevelPrice | null)[];
}

export interface BrokerAccount {
  id: string;
  /** e.g. "Schwab · Individual" */
  name: string;
  institution: string;
}

export interface SyncResult {
  /** New fills brought in. */
  added: number;
  accounts: number;
  /** Accounts that couldn't be read, with why. */
  errors: string[];
  /** Trades that got their exact time from Schwab. */
  retimed?: number;
}

/** Schwab allows one app per product: one reads your accounts, the other market data. */
export type SchwabSlot = 'trading' | 'marketData';

export interface SchwabStatus {
  /** App Key, Secret and Callback URL are saved. */
  configured: boolean;
  callbackUrl?: string;
  signedIn: boolean;
  /** When Schwab's 7-day sign-in runs out. */
  signInExpires?: string;
  lastSync?: string;
  /** The Schwab app has market data but not "Accounts and Trading", so no trade times. */
  marketDataOnly?: boolean;
}

export interface BrokerStatus {
  relayUrl: string;
  connected: boolean;
  lastSync?: string;
}

/** Where a dragged fill label sits, in pixels from its arrow's point to the label's top-left corner. */
export interface LabelOffset { dx: number; dy: number }

/** Colors you can change in Settings, as "#rrggbb". */
export interface ColorScheme {
  win: string;
  loss: string;
  accent: string;
  /** Lines and shapes on the Home and Reports charts (score radar, running P&L). */
  chart: string;
  candleUp: string;
  candleDown: string;
  entry: string;
  exit: string;
  stop: string;
  target: string;
}

export interface SettingsView {
  timeZone: string;
  hasAlpacaKey: boolean;
  /** Visible trade table columns in order; undefined means the defaults. */
  tradeColumns?: string[];
  goals: Goals;
  reportsLayout?: { columns: string[][]; collapsed: string[]; charts?: string[]; hidden?: string[] };
  /** Accounts left out of the journal's numbers. */
  hiddenAccounts: string[];
  /** Only the colors you changed. */
  colors?: Partial<ColorScheme>;
  /** How entry and exit markers look. */
  markerStyles: MarkerStyles;
  /** Option prices as quoted ($0.15) or as paid per contract ($15.00). */
  optionPriceDisplay: 'quote' | 'contract';
  /** Indicators shown on every chart. */
  indicators: Indicator[];
}

export interface TradeImage {
  id: string;
  caption: string;
  created: string;
  /** The picture itself, as a data: URL. */
  url: string;
}

export interface PasteResult {
  drawings: PastedDrawing[];
  /** TradingView drawing types on the clipboard that can't be drawn here yet. */
  skipped: string[];
  hasImage: boolean;
  /** True when a TradingView copy was saved to clipboard-sample.json. */
  sampleSaved: boolean;
}

export interface JournalApi {
  getJournal(): Promise<JournalData>;
  /** Opens a file picker; resolves to null if the user cancels. */
  importThinkorswim(): Promise<ImportResult | null>;
  getTradeChart(tradeId: string, view?: ChartView): Promise<TradeChart>;
  /** One chart of a day's trades on one ticker. */
  getDayChart(date: string, underlying: string, view?: ChartView): Promise<TradeChart>;
  getLevelPrices(tradeId: string, stops: PriceLevel[], targets: PriceLevel[], view?: ChartView): Promise<LevelPrices | null>;
  getSettings(): Promise<SettingsView>;
  /** Saves (or clears, with null) the Alpaca keys after checking they work. */
  saveAlpacaKeys(keys: { keyId: string; secretKey: string } | null): Promise<{ ok: boolean; message: string }>;
  setTimeZone(timeZone: string): Promise<void>;
  /** Saves the trade table's columns; null restores the defaults. */
  setTradeColumns(ids: string[] | null): Promise<void>;
  setGoals(goals: Goals): Promise<void>;
  /** Deletes every thinkorswim CSV import, then re-syncs brokers from the start. */
  /** Counts these trades as one; returns the journal with the change. */
  combineTrades(ids: string[]): Promise<JournalData>;
  /** Undoes a combine. */
  splitTrade(id: string): Promise<JournalData>;
  removeImported(): Promise<{ removed: number; sync: SyncResult | null }>;
  /** Each account in the journal with how many fills it has; null is CSV imports with no account. */
  accountFillCounts(): Promise<{ account: string | null; fills: number }[]>;
  /** Deletes one account's fills; returns how many. */
  removeAccount(account: string | null): Promise<number>;
  /** Deletes every fill broker sync brought in (SnapTrade and Schwab); returns how many. */
  removeSynced(): Promise<number>;
  brokerStatus(): Promise<BrokerStatus>;
  brokerAccounts(): Promise<BrokerAccount[]>;
  /** Opens the broker sign-in; syncs when it's done. Null if the window was closed first. */
  connectBroker(): Promise<SyncResult | null>;
  syncBrokers(): Promise<SyncResult>;
  /** Syncs if it hasn't run today yet; null when not due or not set up. */
  syncBrokersIfDue(): Promise<SyncResult | null>;
  disconnectBrokers(): Promise<void>;
  setRelayUrl(url: string): Promise<void>;
  schwabStatus(slot: SchwabSlot): Promise<SchwabStatus>;
  /** Saves (or with null, forgets) one of your Schwab developer apps. */
  saveSchwabApp(slot: SchwabSlot, app: { appKey: string; secret: string; callbackUrl: string } | null): Promise<void>;
  /** Opens Schwab's sign-in, then (for the trading app) syncs. Null if the window was closed first. */
  connectSchwab(slot: SchwabSlot): Promise<SyncResult | null>;
  disconnectSchwab(slot: SchwabSlot): Promise<void>;
  setHiddenAccounts(names: string[]): Promise<void>;
  /** Saves your colors; null goes back to the defaults. */
  setColors(colors: Partial<ColorScheme> | null): Promise<void>;
  /** Saves how entry and exit markers look; null goes back to the defaults. */
  setMarkerStyles(styles: MarkerStyles | null): Promise<void>;
  setOptionPriceDisplay(mode: 'quote' | 'contract'): Promise<void>;
  setIndicators(indicators: Indicator[]): Promise<void>;
  /** Minute candles from the days before `beforeDay`, enough for `count` candles of `minutes`. */
  historyMinuteBars(underlying: string, beforeDay: string, minutes: number, count: number, fromSchwab: boolean): Promise<Bar[]>;
  /** A stock or ETF's minute candles on those days (an index's VWAP borrows SPY's volume). */
  etfMinuteBars(symbol: string, days: string[]): Promise<Bar[]>;
  /** Completed daily candles before `beforeDay`. */
  historyDailyBars(underlying: string, beforeDay: string, count: number, fromSchwab: boolean): Promise<DayBar[]>;
  setReportsLayout(layout: { columns: string[][]; collapsed: string[]; charts?: string[] }): Promise<void>;
  saveTradeJournal(tradeId: string, journal: TradeJournal): Promise<void>;
  saveSetups(setups: Setup[]): Promise<void>;
  saveMistakes(mistakes: MistakeTag[]): Promise<void>;
  savePositives(positives: MistakeTag[]): Promise<void>;
  saveDayNote(date: string, notes: string): Promise<void>;
  /** A ticker's drawings for those days, plus kept price lines from earlier days. */
  getDrawings(symbol: string, days: string[]): Promise<Drawing[]>;
  /** Adds or replaces one drawing. */
  putDrawing(symbol: string, drawing: Drawing): Promise<void>;
  putDrawings(symbol: string, drawings: Drawing[]): Promise<void>;
  deleteDrawing(symbol: string, id: string): Promise<void>;
  /** Where you dragged fill labels, by fill id, in pixels from the arrow's point. */
  markerLabels(fillIds: string[]): Promise<Record<string, LabelOffset>>;
  /** Saves where a fill's label sits; null puts it back to automatic. */
  setMarkerLabel(fillId: string, offset: LabelOffset | null): Promise<void>;
  /** Reads the clipboard for TradingView drawings or a picture. */
  readPaste(): Promise<PasteResult>;
  listScreenshots(tradeId: string): Promise<TradeImage[]>;
  screenshotCounts(): Promise<Record<string, number>>;
  /** Adds the picture on the clipboard; false if there isn't one. */
  pasteScreenshot(tradeId: string): Promise<boolean>;
  /** Opens a file picker; returns how many pictures were added. */
  pickScreenshots(tradeId: string): Promise<number>;
  /** Adds a dropped picture file's bytes. */
  addScreenshotData(tradeId: string, data: Uint8Array): Promise<boolean>;
  captionScreenshot(id: string, caption: string): Promise<void>;
  removeScreenshot(id: string): Promise<void>;
  backupStatus(): Promise<BackupStatus>;
  /** Asks where to save, then writes a backup. Null if cancelled. */
  saveBackup(): Promise<{ file: string; size: number } | null>;
  /** Picks the folder for daily backups and saves one there right away. */
  chooseBackupFolder(): Promise<BackupStatus>;
  stopAutoBackup(): Promise<BackupStatus>;
  /** Picks a backup, confirms, restores it and restarts the app. Null if cancelled. */
  restoreBackup(): Promise<true | null>;
}

export interface BackupStatus {
  /** Where daily backups go; null when they're off. */
  folder: string | null;
  latest: { file: string; when: string } | null;
}

declare global {
  interface Window {
    journal: JournalApi;
  }
}
