// Local database: one SQLite file in the app's data folder, using the SQLite built into Electron's Node.

import { DatabaseSync } from 'node:sqlite';
import type { Bar } from '../core/alpaca';
import type { Fill } from '../core/types';

export class JournalDb {
  private db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS fills (
        id TEXT PRIMARY KEY,
        broker TEXT NOT NULL,
        exec_time TEXT NOT NULL,
        underlying TEXT NOT NULL,
        expiry TEXT NOT NULL,
        strike REAL NOT NULL,
        put_call TEXT NOT NULL,
        side TEXT NOT NULL,
        quantity REAL NOT NULL,
        position_effect TEXT NOT NULL,
        price REAL NOT NULL,
        order_type TEXT NOT NULL,
        spread TEXT NOT NULL,
        fees REAL NOT NULL,
        imported_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS fills_by_time ON fills (exec_time);

      -- Market data cache, so a chart only downloads once.
      CREATE TABLE IF NOT EXISTS minute_bars (
        symbol TEXT NOT NULL,
        time INTEGER NOT NULL,
        open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL,
        PRIMARY KEY (symbol, time)
      );
      CREATE TABLE IF NOT EXISTS bar_days (
        symbol TEXT NOT NULL,
        day TEXT NOT NULL,
        feed TEXT NOT NULL,
        PRIMARY KEY (symbol, day)
      );
      CREATE TABLE IF NOT EXISTS fill_underlying_prices (
        fill_id TEXT PRIMARY KEY,
        price REAL NOT NULL,
        trade_time INTEGER NOT NULL,
        feed TEXT NOT NULL
      );
    `);
  }

  /** Saves fills, ignoring ones already imported. Returns how many were new. */
  addFills(fills: Fill[]): number {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO fills
        (id, broker, exec_time, underlying, expiry, strike, put_call, side, quantity, position_effect, price, order_type, spread, fees)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let added = 0;
    this.db.exec('BEGIN');
    try {
      for (const f of fills) {
        const result = insert.run(f.id, f.broker, f.execTime, f.underlying, f.expiry, f.strike, f.putCall, f.side,
          f.quantity, f.positionEffect, f.price, f.orderType, f.spread, f.fees);
        added += Number(result.changes);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return added;
  }

  allFills(): Fill[] {
    const rows = this.db.prepare('SELECT * FROM fills ORDER BY exec_time').all() as Record<string, any>[];
    return rows.map((r) => ({
      id: r.id, broker: r.broker, execTime: r.exec_time, underlying: r.underlying, expiry: r.expiry,
      strike: r.strike, putCall: r.put_call, side: r.side, quantity: r.quantity,
      positionEffect: r.position_effect, price: r.price, orderType: r.order_type, spread: r.spread, fees: r.fees,
    }));
  }

  barDay(symbol: string, day: string): { feed: string } | undefined {
    return this.db.prepare('SELECT feed FROM bar_days WHERE symbol = ? AND day = ?').get(symbol, day) as { feed: string } | undefined;
  }

  saveBarDay(symbol: string, day: string, feed: string, bars: Bar[]) {
    const insert = this.db.prepare('INSERT OR REPLACE INTO minute_bars (symbol, time, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      for (const b of bars) insert.run(symbol, b.time, b.open, b.high, b.low, b.close, b.volume);
      this.db.prepare('INSERT OR REPLACE INTO bar_days (symbol, day, feed) VALUES (?, ?, ?)').run(symbol, day, feed);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  minuteBars(symbol: string, startMillis: number, endMillis: number): Bar[] {
    return this.db.prepare('SELECT time, open, high, low, close, volume FROM minute_bars WHERE symbol = ? AND time >= ? AND time < ? ORDER BY time')
      .all(symbol, startMillis, endMillis) as unknown as Bar[];
  }

  fillPrice(fillId: string): { price: number; tradeTime: number; feed: string } | undefined {
    const row = this.db.prepare('SELECT price, trade_time, feed FROM fill_underlying_prices WHERE fill_id = ?').get(fillId) as Record<string, any> | undefined;
    return row && { price: row.price, tradeTime: row.trade_time, feed: row.feed };
  }

  saveFillPrice(fillId: string, price: number, tradeTime: number, feed: string) {
    this.db.prepare('INSERT OR REPLACE INTO fill_underlying_prices (fill_id, price, trade_time, feed) VALUES (?, ?, ?, ?)').run(fillId, price, tradeTime, feed);
  }

  close() {
    this.db.close();
  }
}
