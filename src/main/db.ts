// Local database: one SQLite file in the app's data folder, using the SQLite built into Electron's Node.

import { DatabaseSync } from 'node:sqlite';
import { matchFills } from '../core/fills';
import type { Bar } from '../core/alpaca';
import type { Fill, MistakeTag, Setup, TradeJournal } from '../core/types';

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

      -- Your journal. A trade's id is the id of its first fill, so it survives re-imports.
      CREATE TABLE IF NOT EXISTS trade_journal (
        trade_id TEXT PRIMARY KEY,
        notes TEXT NOT NULL DEFAULT '',
        setup_id TEXT,
        mistakes TEXT NOT NULL DEFAULT '[]',
        rating INTEGER,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS setups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mistake_tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS day_notes (
        date TEXT PRIMARY KEY,
        notes TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    // Added after the first journal release: stop/target levels for R.
    const cols = (this.db.prepare('PRAGMA table_info(trade_journal)').all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('levels')) this.db.exec("ALTER TABLE trade_journal ADD COLUMN levels TEXT NOT NULL DEFAULT '{}'");
    // Added with broker sync: which account a fill came from, and whether its time is exact.
    const fillCols = (this.db.prepare('PRAGMA table_info(fills)').all() as { name: string }[]).map((c) => c.name);
    if (!fillCols.includes('account')) this.db.exec('ALTER TABLE fills ADD COLUMN account TEXT');
    if (!fillCols.includes('time_exact')) this.db.exec('ALTER TABLE fills ADD COLUMN time_exact INTEGER NOT NULL DEFAULT 1');
    // Added with playbooks: each setup's rules, and which ones a trade followed.
    if (!cols.includes('rules_followed')) this.db.exec("ALTER TABLE trade_journal ADD COLUMN rules_followed TEXT");
    const setupCols = (this.db.prepare('PRAGMA table_info(setups)').all() as { name: string }[]).map((c) => c.name);
    if (!setupCols.includes('rules')) this.db.exec("ALTER TABLE setups ADD COLUMN rules TEXT NOT NULL DEFAULT '[]'");
    this.seedMistakes();
  }

  /** A starter list of common mistakes, added once. Deleting them later is fine. */
  private seedMistakes() {
    if (this.db.prepare("SELECT 1 FROM meta WHERE key = 'seeded_mistakes'").get()) return;
    const names = ['Chased entry', 'No stop', 'Held too long', 'Cut winner early', 'Oversized', 'FOMO', 'Revenge trade'];
    this.saveMistakeTags(names.map((name, i) => ({ id: `default-${i + 1}`, name })));
    this.db.prepare("INSERT INTO meta (key, value) VALUES ('seeded_mistakes', '1')").run();
  }

  /**
   * Saves fills, skipping ones already in the journal, including the same execution reported by
   * another source (a CSV and broker sync). Returns how many were new.
   */
  /** How many date-only fills the last `addFills` gave an exact time. */
  lastRetimed = 0;

  /**
   * Adds fills not already in the journal and returns how many. With `addNew: false` it only uses
   * them to give exact times (and account names) to fills already there.
   */
  addFills(fills: Fill[], opts: { addNew?: boolean } = {}): number {
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO fills
        (id, broker, exec_time, underlying, expiry, strike, put_call, side, quantity, position_effect, price, order_type, spread, fees, account, time_exact)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    let added = 0;
    let retimed = 0;
    const existing = this.allFills();
    // A fill synced earlier with only its date gets its exact time once the broker's orders give it.
    const known = new Map(existing.map((f) => [f.id, f]));
    const retime = this.db.prepare('UPDATE fills SET exec_time = ?, time_exact = 1 WHERE id = ? AND time_exact = 0');
    const { fresh, matched } = matchFills(fills, existing);
    // A CSV fill that broker sync also reported learns which account it came from.
    const label = this.db.prepare('UPDATE fills SET account = ? WHERE id = ? AND account IS NULL');
    this.db.exec('BEGIN');
    try {
      for (const f of opts.addNew === false ? [] : fresh) {
        const result = insert.run(f.id, f.broker, f.execTime, f.underlying, f.expiry, f.strike, f.putCall, f.side,
          f.quantity, f.positionEffect, f.price, f.orderType, f.spread, f.fees, f.account ?? null, f.timeExact === false ? 0 : 1);
        added += Number(result.changes);
      }
      for (const f of fills) if (f.timeExact !== false && known.get(f.id)?.timeExact === false) retimed += Number(retime.run(f.execTime, f.id).changes);
      for (const m of matched) {
        if (m.incoming.account && !m.existing.account) label.run(m.incoming.account, m.existing.id);
        // A synced fill with only its date takes the exact time from the same fill in a CSV import.
        if (m.existing.timeExact === false && m.incoming.timeExact !== false) retimed += Number(retime.run(m.incoming.execTime, m.existing.id).changes);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.lastRetimed = retimed;
    return added;
  }

  getMeta(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  }

  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  /** How many fills each account has; null is fills with no account (CSV imports). */
  accountFillCounts(): { account: string | null; fills: number }[] {
    return this.db.prepare('SELECT account, COUNT(*) AS fills FROM fills GROUP BY account ORDER BY account').all() as any;
  }

  /** Deletes every fill from one account (null: the ones with no account). Returns how many. */
  removeAccountFills(account: string | null): number {
    const sql = account === null ? 'DELETE FROM fills WHERE account IS NULL' : 'DELETE FROM fills WHERE account = ?';
    return Number(this.db.prepare(sql).run(...(account === null ? [] : [account])).changes);
  }

  /** Deletes every fill that came from one source, e.g. all thinkorswim CSV imports. Returns how many. */
  removeFills(broker: Fill['broker']): number {
    return Number(this.db.prepare('DELETE FROM fills WHERE broker = ?').run(broker).changes);
  }

  allFills(): Fill[] {
    const rows = this.db.prepare('SELECT * FROM fills ORDER BY exec_time').all() as Record<string, any>[];
    return rows.map((r) => ({
      id: r.id, broker: r.broker, execTime: r.exec_time, underlying: r.underlying, expiry: r.expiry,
      strike: r.strike, putCall: r.put_call, side: r.side, quantity: r.quantity,
      positionEffect: r.position_effect, price: r.price, orderType: r.order_type, spread: r.spread, fees: r.fees,
      ...(r.account ? { account: r.account } : {}),
      ...(r.time_exact === 0 ? { timeExact: false } : {}),
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

  tradeJournals(): Map<string, TradeJournal> {
    const rows = this.db.prepare('SELECT * FROM trade_journal').all() as Record<string, any>[];
    return new Map(rows.map((r) => [r.trade_id, {
      notes: r.notes, setupId: r.setup_id, mistakes: JSON.parse(r.mistakes), rating: r.rating, ...JSON.parse(r.levels),
      ...(r.rules_followed ? { rulesFollowed: JSON.parse(r.rules_followed) } : {}),
    }]));
  }

  saveTradeJournal(tradeId: string, j: TradeJournal) {
    this.db.prepare(`
      INSERT INTO trade_journal (trade_id, notes, setup_id, mistakes, rating, levels, rules_followed, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT (trade_id) DO UPDATE SET notes = excluded.notes, setup_id = excluded.setup_id, mistakes = excluded.mistakes,
        rating = excluded.rating, levels = excluded.levels, rules_followed = excluded.rules_followed, updated_at = excluded.updated_at`)
      .run(tradeId, j.notes, j.setupId, JSON.stringify(j.mistakes), j.rating,
        JSON.stringify({ stops: j.stops, targets: j.targets, underlyingEntry: j.underlyingEntry, underlyingExit: j.underlyingExit }),
        j.rulesFollowed ? JSON.stringify(j.rulesFollowed) : null);
  }

  setups(): Setup[] {
    const rows = this.db.prepare('SELECT id, name, color, rules FROM setups ORDER BY position').all() as Record<string, any>[];
    return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, rules: JSON.parse(r.rules) }));
  }

  /** Replaces the setup list. Trades that used a deleted setup go back to having none. */
  saveSetups(list: Setup[]) {
    this.transaction(() => {
      this.db.exec('DELETE FROM setups');
      const insert = this.db.prepare('INSERT INTO setups (id, name, color, position, rules) VALUES (?, ?, ?, ?, ?)');
      list.forEach((x, i) => insert.run(x.id, x.name, x.color, i, JSON.stringify(x.rules ?? [])));
      this.db.exec('UPDATE trade_journal SET setup_id = NULL WHERE setup_id IS NOT NULL AND setup_id NOT IN (SELECT id FROM setups)');
    });
  }

  mistakeTags(): MistakeTag[] {
    return this.db.prepare('SELECT id, name FROM mistake_tags ORDER BY position').all() as unknown as MistakeTag[];
  }

  /** Replaces the mistake list. Deleted mistakes are taken off the trades that had them. */
  saveMistakeTags(list: MistakeTag[]) {
    this.transaction(() => {
      this.db.exec('DELETE FROM mistake_tags');
      const insert = this.db.prepare('INSERT INTO mistake_tags (id, name, position) VALUES (?, ?, ?)');
      list.forEach((x, i) => insert.run(x.id, x.name, i));
      const keep = new Set(list.map((x) => x.id));
      const update = this.db.prepare('UPDATE trade_journal SET mistakes = ? WHERE trade_id = ?');
      for (const [id, j] of this.tradeJournals()) {
        const mistakes = j.mistakes.filter((m) => keep.has(m));
        if (mistakes.length !== j.mistakes.length) update.run(JSON.stringify(mistakes), id);
      }
    });
  }

  dayNotes(): Record<string, string> {
    const rows = this.db.prepare('SELECT date, notes FROM day_notes').all() as { date: string; notes: string }[];
    return Object.fromEntries(rows.map((r) => [r.date, r.notes]));
  }

  saveDayNote(date: string, notes: string) {
    this.db.prepare(`
      INSERT INTO day_notes (date, notes, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT (date) DO UPDATE SET notes = excluded.notes, updated_at = excluded.updated_at`).run(date, notes);
  }

  private transaction(work: () => void) {
    this.db.exec('BEGIN');
    try {
      work();
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  close() {
    this.db.close();
  }
}
