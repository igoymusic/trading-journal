// Reads a thinkorswim "Account Statement" CSV export.
//
// The export is several CSV tables in one file, each introduced by a title line
// ("Cash Balance", "Account Trade History", ...) followed by its own header row.
// Fills come from "Account Trade History"; fees for each fill come from the
// "Cash Balance" rows of type TRD, matched on time, contract, quantity and price.

import type { Fill, PutCall, Side } from './types';

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** Splits one CSV line, honoring double quotes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Returns each titled section as rows of objects keyed by that section's header. */
export function readSections(text: string): Map<string, Record<string, string>[]> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const sections = new Map<string, Record<string, string>[]>();
  let i = 0;
  while (i < lines.length) {
    const title = lines[i].trim();
    const header = lines[i + 1];
    const startsSection = title !== '' && !title.includes(',') && header !== undefined && header.includes(',');
    if (!startsSection) { i++; continue; }
    const keys = splitCsvLine(header).map((k) => k.trim());
    const rows: Record<string, string>[] = [];
    i += 2;
    while (i < lines.length && lines[i].trim() !== '' && lines[i].includes(',')) {
      const cells = splitCsvLine(lines[i]);
      const row: Record<string, string> = {};
      keys.forEach((k, idx) => { if (k && !(k in row)) row[k] = (cells[idx] ?? '').trim(); });
      rows.push(row);
      i++;
    }
    sections.set(title.replace(/^"|"$/g, ''), rows);
  }
  return sections;
}

/** "10/12/26 11:49:07" -> "2026-10-12T11:49:07" */
export function parseTosDateTime(dateTime: string): string {
  const [date, time] = dateTime.trim().split(/\s+/);
  return `${parseTosDate(date)}T${time.padStart(8, '0')}`;
}

/** "10/12/26" -> "2026-10-12" */
export function parseTosDate(date: string): string {
  const [m, d, y] = date.split('/');
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** "12 OCT 26" -> "2026-10-12" */
export function parseTosExpiry(exp: string): string {
  const [d, mon, y] = exp.trim().split(/\s+/);
  const month = MONTHS[mon.toUpperCase()];
  if (!month) throw new Error(`Unrecognized expiration "${exp}"`);
  return `20${y.slice(-2)}-${month}-${d.padStart(2, '0')}`;
}

/** "WBD 0/100 (US$ 3101.67) (Weeklys)" -> "WBD"; adjusted contracts keep their root symbol. */
export function underlyingFromSymbol(symbol: string): string {
  return symbol.trim().split(/\s+/)[0].toUpperCase();
}

function toNumber(s: string): number {
  const n = Number(s.replace(/[$,+]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(n) ? n : 0;
}

/** Key used to pair a trade-history fill with its cash-balance row. */
function feeKey(execTime: string, side: Side, qty: number, underlying: string, expiry: string, strike: number, putCall: PutCall, price: number) {
  return [execTime, side, qty, underlying, expiry, strike, putCall, price.toFixed(4)].join('|');
}

interface CashInfo {
  /** Fee per single-leg fill, keyed by feeKey; a list because identical partial fills can share a second. */
  fees: Map<string, number[]>;
  /** Total fee of each multi-leg order, keyed by "execTime|underlying"; split across its legs later. */
  spreadFees: Map<string, number>;
  /** Options removed at expiration, turned into closing fills at $0. */
  expirations: Fill[];
}

/**
 * Reads Cash Balance rows:
 * - TRD "BOT +1 SPY 100 (Weeklys) 15 OCT 25 666 CALL @1.55" carries one fill's fees.
 * - TRD "SOLD -1 1/2 BACKRATIO MU 100 (Weeklys) 2 APR 26 300/275 PUT @-1.32" carries a whole multi-leg order's fees.
 * - RAD "Removed due to Expiration ... .SPY260330C646" closes a position that expired.
 */
function readCashBalance(rows: Record<string, string>[]): CashInfo {
  const fees = new Map<string, number[]>();
  const spreadFees = new Map<string, number>();
  const expirations: Fill[] = [];
  const single = /^(BOT|SOLD)\s+([+-]?\d+)\s+(\S+).*?(\d{1,2}\s+[A-Z]{3}\s+\d{2})\s+([\d.]+)\s+(CALL|PUT)\s+@([\d.]+)/;
  const spread = /^(BOT|SOLD)\s+[+-]?\d+\s+\S+\s+[A-Z]+\s+(\S+)/;
  const expired = /EXP\s+([+-]?[\d.]+)\s.*\.([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])([\d.]+)\s*$/;

  for (const row of rows) {
    const description = row['DESCRIPTION'] ?? '';
    const execTime = row['DATE'] && row['TIME'] ? parseTosDateTime(`${row['DATE']} ${row['TIME']}`) : '';
    if (row['TYPE'] === 'TRD') {
      const fee = Math.abs(toNumber(row['Misc Fees'] ?? '')) + Math.abs(toNumber(row['Commissions & Fees'] ?? ''));
      const m = single.exec(description);
      if (m) {
        const side: Side = m[1] === 'BOT' ? 'BUY' : 'SELL';
        const key = feeKey(execTime, side, Math.abs(Number(m[2])), m[3].toUpperCase(), parseTosExpiry(m[4]), Number(m[5]), m[6] as PutCall, Number(m[7]));
        const list = fees.get(key) ?? [];
        list.push(fee);
        fees.set(key, list);
        continue;
      }
      const s = spread.exec(description);
      if (s) {
        const key = `${execTime}|${s[2].toUpperCase()}`;
        spreadFees.set(key, (spreadFees.get(key) ?? 0) + fee);
      }
    } else if (row['TYPE'] === 'RAD') {
      const m = expired.exec(description);
      if (!m) continue;
      const qty = Number(m[1]);
      const expiry = `20${m[3]}-${m[4]}-${m[5]}`;
      const putCall: PutCall = m[6] === 'C' ? 'CALL' : 'PUT';
      const strike = Number(m[7]);
      // A negative quantity removes contracts you owned, which is the same as selling them for $0.
      const side: Side = qty < 0 ? 'SELL' : 'BUY';
      const key = feeKey(`${expiry}T16:00:00`, side, Math.abs(qty), m[2], expiry, strike, putCall, 0);
      expirations.push({
        id: `tos:${key}#exp`,
        broker: 'thinkorswim',
        execTime: `${expiry}T16:00:00`,
        underlying: m[2], expiry, strike, putCall, side,
        quantity: Math.abs(qty),
        positionEffect: 'CLOSE',
        price: 0,
        orderType: 'EXPIRED',
        spread: 'SINGLE',
        fees: 0,
      });
    }
  }
  return { fees, spreadFees, expirations };
}

export interface TosImport {
  fills: Fill[];
  /** Rows that couldn't be read, with the reason, so the import screen can show them. */
  skipped: { row: Record<string, string>; reason: string }[];
  /** Fills whose fee couldn't be matched in Cash Balance (fee recorded as 0). */
  unmatchedFees: number;
}

export function parseTosStatement(text: string): TosImport {
  const sections = readSections(text);
  const history = sections.get('Account Trade History');
  if (!history) throw new Error('This file has no "Account Trade History" section. Export the Account Statement from thinkorswim\'s Monitor tab.');
  const cash = readCashBalance(sections.get('Cash Balance') ?? []);

  const fills: Fill[] = [];
  const skipped: TosImport['skipped'] = [];
  const seen = new Map<string, number>();
  let unmatchedFees = 0;
  // Extra legs of a multi-leg order leave Exec Time, Order Type and Spread blank; they belong to the row above.
  let last = { execTime: '', orderType: '', spread: '' };

  for (const row of history) {
    try {
      const putCall = row['Type'];
      if (putCall !== 'CALL' && putCall !== 'PUT') {
        skipped.push({ row, reason: 'Not an option fill (stock trades are not supported yet)' });
        continue;
      }
      const execTime = row['Exec Time'] ? parseTosDateTime(row['Exec Time']) : last.execTime;
      const orderType = row['Order Type'] || (row['Exec Time'] ? '' : last.orderType);
      const spread = row['Spread'] || (row['Exec Time'] ? '' : last.spread);
      if (!execTime) throw new Error('Missing execution time');
      last = { execTime, orderType, spread };

      const side: Side = row['Side'] === 'SELL' ? 'SELL' : 'BUY';
      const quantity = Math.abs(toNumber(row['Qty']));
      const underlying = underlyingFromSymbol(row['Symbol']);
      const expiry = parseTosExpiry(row['Exp']);
      const strike = toNumber(row['Strike']);
      const price = toNumber(row['Price']);

      const key = feeKey(execTime, side, quantity, underlying, expiry, strike, putCall, price);
      const feeList = cash.fees.get(key);
      const fee = feeList?.shift();

      // Identical fills at the same second (partial fills) are numbered so each keeps its own id.
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);

      fills.push({
        id: `tos:${key}#${n}`,
        broker: 'thinkorswim',
        execTime, underlying, expiry, strike, putCall, side, quantity,
        positionEffect: row['Pos Effect'] === 'TO CLOSE' ? 'CLOSE' : 'OPEN',
        price, orderType, spread,
        fees: fee ?? -1,
      });
    } catch (err) {
      skipped.push({ row, reason: (err as Error).message });
    }
  }

  // Multi-leg orders are charged once; split that charge across the legs by contract count.
  const legsByOrder = new Map<string, Fill[]>();
  for (const f of fills) {
    if (f.fees >= 0) continue;
    const key = `${f.execTime}|${f.underlying}`;
    legsByOrder.set(key, [...(legsByOrder.get(key) ?? []), f]);
  }
  for (const [key, legs] of legsByOrder) {
    const total = cash.spreadFees.get(key);
    const contracts = legs.reduce((a, f) => a + f.quantity, 0);
    for (const leg of legs) {
      if (total === undefined) { leg.fees = 0; unmatchedFees++; }
      else leg.fees = (total * leg.quantity) / contracts;
    }
  }
  for (const f of fills) f.fees = Math.round(f.fees * 10000) / 10000;

  fills.push(...cash.expirations);
  fills.sort((a, b) => a.execTime.localeCompare(b.execTime));
  return { fills, skipped, unmatchedFees };
}
