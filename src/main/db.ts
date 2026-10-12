// Local database: one SQLite file in the app's data folder, using the SQLite built into Electron's Node.

import { DatabaseSync } from 'node:sqlite';
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

  close() {
    this.db.close();
  }
}
