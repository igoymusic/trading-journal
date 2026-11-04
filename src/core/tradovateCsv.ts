// Reads trades exported from Tradovate (Account Reports). Three exports work:
//
//   Fills        one row per execution, with its commission (the best one to use)
//   Orders       one row per order; only filled orders count, at their average fill price
//   Performance  one row per matched buy and sell (round trip pieces), no fees
//
// Columns are found by name, so the order of columns doesn't matter. Times without a zone are
// taken as your own time zone (Tradovate exports in the time zone set in its settings); times
// ending in "Z" are UTC and are moved into `timeZone`.

import { futureSpec, parseContract, thirdFriday } from './futures';
import { splitCsvLine } from './tosCsv';
import type { Fill, Side } from './types';

export interface TradovateImport {
  fills: Fill[];
  skipped: { row: Record<string, string>; reason: string }[];
  /** Which export it was. */
  kind: 'fills' | 'orders' | 'performance';
}

/** Rows of a single-table CSV keyed by its header (trimmed). */
function readTable(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return [];
  const keys = splitCsvLine(lines[0]).map((k) => k.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    keys.forEach((k, i) => { if (k && !(k in row)) row[k] = (cells[i] ?? '').trim(); });
    return row;
  });
}

/** Whether a CSV looks like one of Tradovate's exports. */
export function isTradovateCsv(text: string): boolean {
  const header = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const keys = new Set(splitCsvLine(header).map((k) => k.trim()));
  return (keys.has('B/S') && keys.has('Contract')) || (keys.has('buyFillId') && keys.has('sellFillId'));
}

const pick = (row: Record<string, string>, ...names: string[]) => {
  for (const n of names) if (row[n] !== undefined && row[n] !== '') return row[n];
  return '';
};

/** "$1,234.50", "(25.00)", "5843.25" -> number. NaN when empty or unreadable. */
export function toNumber(s: string): number {
  const t = s.replace(/[$,\s]/g, '');
  if (!t) return NaN;
  const neg = /^\(.*\)$/.test(t) || t.startsWith('-');
  const n = Number(t.replace(/[()-]/g, ''));
  return neg ? -n : n;
}

/** Wall-clock "YYYY-MM-DDTHH:MM:SS" in `timeZone` for a UTC instant. */
function inZone(utcMillis: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMillis));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Tradovate's times -> "YYYY-MM-DDTHH:MM:SS" in `timeZone`. Reads "10/28/2026 09:31:05",
 * "10/28/2026 9:31:05 AM", "2026-10-28 09:31:05.123" and "2026-10-28T13:31:05.123Z".
 */
export function parseTradovateTime(s: string, timeZone: string): string {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(t)) {
    const ms = Date.parse(t.replace(' ', 'T'));
    if (Number.isFinite(ms)) return inZone(ms, timeZone);
  }
  const m = /^(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{2,4}))[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(AM|PM)?$/i.exec(t);
  if (!m) throw new Error(`Unreadable time "${s}"`);
  const year = m[1] ?? (m[6].length === 2 ? `20${m[6]}` : m[6]);
  const month = (m[2] ?? m[4]).padStart(2, '0');
  const day = (m[3] ?? m[5]).padStart(2, '0');
  let hour = Number(m[7]);
  if (m[10]) hour = (hour % 12) + (m[10].toUpperCase() === 'PM' ? 12 : 0);
  return `${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${m[8]}:${m[9] ?? '00'}`;
}

/** The futures fields for a contract like "MESZ6" traded at `execTime`. */
function contractFields(contract: string, product: string, execTime: string) {
  const parsed = parseContract(contract, execTime);
  if (!parsed) throw new Error(`Unrecognized contract "${contract}"`);
  const root = (product || parsed.root).toUpperCase();
  const spec = futureSpec(root);
  if (!spec) throw new Error(`Unknown futures product "${root}" (its point value isn't known yet)`);
  return { underlying: root, expiry: thirdFriday(parsed.month), contract: contract.toUpperCase(), multiplier: spec.multiplier };
}

const sideOf = (s: string): Side | null => {
  const t = s.trim().toLowerCase();
  if (t === 'buy' || t === 'b' || t === '0') return 'BUY';
  if (t === 'sell' || t === 's' || t === '1') return 'SELL';
  return null;
};

function base(fields: ReturnType<typeof contractFields>, account: string): Omit<Fill, 'id' | 'execTime' | 'side' | 'quantity' | 'price' | 'fees' | 'orderType'> {
  return {
    broker: 'tradovate', ...fields, strike: 0, putCall: 'CALL', positionEffect: 'OPEN', spread: 'SINGLE',
    account: account ? `Tradovate · ${account}` : 'Tradovate',
  };
}

export function parseTradovateCsv(text: string, timeZone: string): TradovateImport {
  const rows = readTable(text);
  if (!rows.length || !isTradovateCsv(text)) {
    throw new Error('This doesn\'t look like a Tradovate export. In Tradovate, open Account Reports, pick the Fills (or Orders or Performance) tab and download it as CSV.');
  }
  const header = Object.keys(rows[0]);
  if (header.includes('buyFillId')) return parsePerformance(rows, timeZone);
  const kind = header.includes('Status') || header.includes('Filled Qty') || header.includes('filledQty') ? 'orders' : 'fills';
  const fills: Fill[] = [];
  const skipped: TradovateImport['skipped'] = [];
  for (const row of rows) {
    try {
      if (kind === 'orders') {
        const status = pick(row, 'Status').toLowerCase();
        if (status && status !== 'filled') { skipped.push({ row, reason: `Order ${status}, not filled` }); continue; }
      }
      const side = sideOf(pick(row, 'B/S', '_action'));
      if (!side) throw new Error('No buy or sell');
      const quantity = Math.abs(toNumber(kind === 'orders' ? pick(row, 'Filled Qty', 'filledQty', 'Quantity') : pick(row, 'Quantity', '_qty', 'Filled Qty')));
      const price = toNumber(kind === 'orders' ? pick(row, 'Avg Fill Price', 'avgPrice', 'decimalFillAvg') : pick(row, 'Price', '_price'));
      if (!quantity || !Number.isFinite(quantity)) throw new Error('No quantity filled');
      if (!Number.isFinite(price)) throw new Error('No fill price');
      const when = kind === 'orders' ? pick(row, 'Fill Time', 'Timestamp') : pick(row, 'Timestamp', '_timestamp', 'Fill Time');
      if (!when) throw new Error('Missing fill time');
      const execTime = parseTradovateTime(when, timeZone);
      const fields = contractFields(pick(row, 'Contract'), pick(row, 'Product'), execTime);
      const fee = toNumber(pick(row, 'commission', 'Commission', 'Fees', 'fees'));
      const id = pick(row, 'Fill ID', '_id', 'Order ID', 'orderId') || `${execTime}|${fields.contract}|${side}|${quantity}|${price}`;
      fills.push({
        ...base(fields, pick(row, 'Account', 'account')),
        id: `tv:${kind === 'orders' ? 'o' : 'f'}:${id}`,
        execTime, side, quantity, price,
        orderType: pick(row, 'Type', 'Order Type').toUpperCase() || (kind === 'orders' ? '' : 'FILL'),
        fees: Number.isFinite(fee) ? Math.abs(fee) : 0,
      });
    } catch (err) {
      skipped.push({ row, reason: (err as Error).message });
    }
  }
  fills.sort((a, b) => a.execTime.localeCompare(b.execTime));
  return { fills, skipped, kind };
}

/**
 * The Performance export pairs each buy with a sell. Every row becomes the two fills it pairs;
 * a fill split across rows (bought 2, sold 1 and 1) shows as pieces that add back up.
 */
function parsePerformance(rows: Record<string, string>[], timeZone: string): TradovateImport {
  const fills: Fill[] = [];
  const skipped: TradovateImport['skipped'] = [];
  for (const row of rows) {
    try {
      const quantity = Math.abs(toNumber(pick(row, 'qty', 'Qty')));
      if (!quantity || !Number.isFinite(quantity)) throw new Error('No quantity');
      const bought = parseTradovateTime(pick(row, 'boughtTimestamp'), timeZone);
      const sold = parseTradovateTime(pick(row, 'soldTimestamp'), timeZone);
      const fields = contractFields(pick(row, 'symbol', 'Symbol'), '', bought < sold ? bought : sold);
      const buyId = pick(row, 'buyFillId');
      const sellId = pick(row, 'sellFillId');
      const common = { ...base(fields, ''), quantity, orderType: 'FILL', fees: 0 };
      const buyPrice = toNumber(pick(row, 'buyPrice'));
      const sellPrice = toNumber(pick(row, 'sellPrice'));
      if (!Number.isFinite(buyPrice) || !Number.isFinite(sellPrice)) throw new Error('No fill price');
      fills.push(
        { ...common, id: `tv:p:${buyId}:${sellId}:B`, execTime: bought, side: 'BUY', price: buyPrice },
        { ...common, id: `tv:p:${buyId}:${sellId}:S`, execTime: sold, side: 'SELL', price: sellPrice },
      );
    } catch (err) {
      skipped.push({ row, reason: (err as Error).message });
    }
  }
  fills.sort((a, b) => a.execTime.localeCompare(b.execTime));
  return { fills, skipped, kind: 'performance' };
}
