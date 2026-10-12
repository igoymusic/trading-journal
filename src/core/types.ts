// Shared data shapes used by the importer, the database and the screens.

export type PutCall = 'CALL' | 'PUT';
export type Side = 'BUY' | 'SELL';

/** One execution reported by the broker. Times are the broker's local wall-clock time, "YYYY-MM-DDTHH:MM:SS". */
export interface Fill {
  /** Stable id so re-importing the same file never creates duplicates. */
  id: string;
  broker: 'thinkorswim';
  execTime: string;
  underlying: string;
  /** Expiration date, "YYYY-MM-DD". */
  expiry: string;
  strike: number;
  putCall: PutCall;
  side: Side;
  /** Always positive; direction is in `side`. */
  quantity: number;
  positionEffect: 'OPEN' | 'CLOSE';
  /** Option price per share as quoted (0.20 means $20 per contract). */
  price: number;
  orderType: string;
  /** Order structure, e.g. SINGLE, VERTICAL, BACKRATIO. */
  spread: string;
  /** Commissions plus misc fees for this fill, in dollars, as a positive number. */
  fees: number;
}

/** A round trip on one option contract: from flat, to a position, back to flat. */
export interface Trade {
  id: string;
  underlying: string;
  expiry: string;
  strike: number;
  putCall: PutCall;
  /** LONG if the first fill bought contracts, SHORT if it sold them. */
  direction: 'LONG' | 'SHORT';
  openTime: string;
  /** Undefined while the position is still open. */
  closeTime?: string;
  status: 'CLOSED' | 'OPEN';
  /** Largest number of contracts held at once. */
  maxContracts: number;
  /** Average entry and exit prices per contract, in dollars (0.20 quote = $20). */
  avgEntry: number;
  avgExit?: number;
  /** Realized P&L in dollars before fees. */
  grossPnl: number;
  fees: number;
  netPnl: number;
  fills: Fill[];
  /** Your notes and labels for this trade, if you've added any. */
  journal?: TradeJournal;
}

/** What you record about a trade: the setup it was, mistakes made, a 1-5 rating and free notes. */
export interface TradeJournal {
  notes: string;
  setupId: string | null;
  /** Ids of mistake tags. */
  mistakes: string[];
  /** 1-5, or null if not rated. */
  rating: number | null;
  /** Stop-loss levels you placed on the underlying's chart. */
  stops?: PriceLevel[];
  /** Take-profit levels (planned, or theoretical for a losing trade). */
  targets?: PriceLevel[];
  /** The underlying's average price at your entries and exits, saved with the levels so R shows without loading the chart. */
  underlyingEntry?: number;
  underlyingExit?: number;
}

/** A price on the underlying and how many contracts it applies to. */
export interface PriceLevel {
  price: number;
  contracts: number;
}

export const EMPTY_JOURNAL: TradeJournal = { notes: '', setupId: null, mistakes: [], rating: null };

/** A trade setup you define, e.g. "Opening range breakout". */
export interface Setup {
  id: string;
  name: string;
  /** Hex color used for its badge. */
  color: string;
}

/** A mistake label, e.g. "Chased entry". */
export interface MistakeTag {
  id: string;
  name: string;
}

export const CONTRACT_MULTIPLIER = 100;
