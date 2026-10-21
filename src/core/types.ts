// Shared data shapes used by the importer, the database and the screens.

export type PutCall = 'CALL' | 'PUT';
export type Side = 'BUY' | 'SELL';

/** One execution reported by the broker. Times are the broker's local wall-clock time, "YYYY-MM-DDTHH:MM:SS". */
export interface Fill {
  /** Stable id so re-importing the same file never creates duplicates. */
  id: string;
  broker: 'thinkorswim' | 'snaptrade' | 'schwab';
  /** Which brokerage account it came from, when known (broker sync). */
  account?: string;
  /** False when the broker only reported the date; execTime is then a placeholder time that day. */
  timeExact?: boolean;
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
  /** The brokerage account it was traded in, when known (broker sync names it). */
  account?: string;
  /** Your notes and labels for this trade, if you've added any. */
  journal?: TradeJournal;
  /** Ids of the trades you combined into this one. */
  merged?: string[];
  /** Contracts closed without an opening fill, counted as bought (or sold) at the average entry. */
  assumedContracts?: number;
}

/** What you record about a trade: the setup it was, mistakes made, a 0.5-5 rating (half stars) and free notes. */
export interface TradeJournal {
  notes: string;
  setupId: string | null;
  /** Ids of mistake tags. */
  mistakes: string[];
  /** Ids of positive tags: what the trade did well. */
  positives?: string[];
  /** 1-5, or null if not rated. */
  rating: number | null;
  /** Stop-loss levels you placed on the underlying's chart. */
  stops?: PriceLevel[];
  /** Take-profit levels (planned, or theoretical for a losing trade). */
  targets?: PriceLevel[];
  /** The underlying's average price at your entries and exits, saved with the levels so R shows without loading the chart. */
  underlyingEntry?: number;
  underlyingExit?: number;
  /** Ids of the setup's playbook rules you followed on this trade; the rest count as broken. */
  rulesFollowed?: string[];
  /** Chart tickers this trade's position box has been drawn on (so one you delete stays deleted). */
  boxesPlaced?: string[];
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
  /** The setup's playbook: rules you mean to follow every time you take it. */
  rules?: PlaybookRule[];
}

export interface PlaybookRule {
  id: string;
  text: string;
}

/** How well a trade followed its setup's playbook, or null if the setup has no rules. */
export function playbookScore(trade: Pick<Trade, 'journal'>, setups: Setup[]): { followed: number; total: number; broken: PlaybookRule[] } | null {
  const rules = setups.find((s) => s.id === trade.journal?.setupId)?.rules ?? [];
  if (!rules.length) return null;
  const ticked = new Set(trade.journal?.rulesFollowed ?? []);
  const broken = rules.filter((r) => !ticked.has(r.id));
  return { followed: rules.length - broken.length, total: rules.length, broken };
}

/** A tag label: a mistake ("Chased entry") or a positive ("Followed my plan"). */
export interface MistakeTag {
  id: string;
  name: string;
}

export const CONTRACT_MULTIPLIER = 100;
