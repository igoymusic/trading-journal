import { describe, expect, it } from 'vitest';
import { JournalDb } from '../src/main/db';

describe('journal storage', () => {
  it('starts with a list of common mistakes', () => {
    const db = new JournalDb(':memory:');
    expect(db.mistakeTags().map((m) => m.name)).toContain('Chased entry');
  });

  it('saves and updates a trade journal entry', () => {
    const db = new JournalDb(':memory:');
    db.saveTradeJournal('t1', { notes: 'Good entry', setupId: null, mistakes: [], rating: 4 });
    db.saveTradeJournal('t1', { notes: 'Good entry, late exit', setupId: null, mistakes: ['default-3'], rating: 3 });
    expect(db.tradeJournals().get('t1')).toEqual({ notes: 'Good entry, late exit', setupId: null, mistakes: ['default-3'], rating: 3 });
  });

  it('clears a deleted setup or mistake from the trades that used it', () => {
    const db = new JournalDb(':memory:');
    db.saveSetups([{ id: 's1', name: 'ORB', color: '#2962ff' }, { id: 's2', name: 'VWAP reclaim', color: '#26a69a' }]);
    db.saveTradeJournal('t1', { notes: '', setupId: 's1', mistakes: ['default-1', 'default-2'], rating: null });
    db.saveSetups([{ id: 's2', name: 'VWAP reclaim', color: '#26a69a' }]);
    db.saveMistakeTags(db.mistakeTags().filter((m) => m.id !== 'default-1'));
    expect(db.tradeJournals().get('t1')).toMatchObject({ setupId: null, mistakes: ['default-2'] });
    expect(db.setups().map((s) => s.name)).toEqual(['VWAP reclaim']);
  });

  it('saves stop and target levels with a trade', () => {
    const db = new JournalDb(':memory:');
    const levels = { stops: [{ price: 99, contracts: 2 }], targets: [{ price: 103, contracts: 2 }], underlyingEntry: 100, underlyingExit: 101.5 };
    db.saveTradeJournal('t1', { notes: '', setupId: null, mistakes: [], rating: null, ...levels });
    expect(db.tradeJournals().get('t1')).toMatchObject(levels);
  });

  it('saves playbook rules on setups and which ones a trade followed', () => {
    const db = new JournalDb(':memory:');
    const rules = [{ id: 'r1', text: 'Wait for the first 5-minute candle' }, { id: 'r2', text: 'Stop under the range' }];
    db.saveSetups([{ id: 's1', name: 'ORB', color: '#2962ff', rules }]);
    db.saveTradeJournal('t1', { notes: '', setupId: 's1', mistakes: [], rating: null, rulesFollowed: ['r2'] });
    expect(db.setups()[0].rules).toEqual(rules);
    expect(db.tradeJournals().get('t1')?.rulesFollowed).toEqual(['r2']);
  });

  it('keeps one note per day', () => {
    const db = new JournalDb(':memory:');
    db.saveDayNote('2026-09-15', 'Choppy open');
    db.saveDayNote('2026-09-15', 'Choppy open, waited for the trend');
    expect(db.dayNotes()).toEqual({ '2026-09-15': 'Choppy open, waited for the trend' });
  });
});

describe('fills from two sources', () => {
  const base = {
    underlying: 'SPY', expiry: '2026-09-15', strike: 776, putCall: 'CALL' as const, side: 'BUY' as const, quantity: 1,
    positionEffect: 'OPEN' as const, price: 1.36, orderType: 'MARKET', spread: 'SINGLE', fees: 0.65,
  };
  it('gives a date-only synced fill its exact time and keeps its account when a CSV has it', () => {
    const db = new JournalDb(':memory:');
    db.addFills([{ ...base, id: 'snaptrade:a:1', broker: 'snaptrade', account: 'Schwab · Trading', execTime: '2026-09-15T12:00:00', timeExact: false }]);
    expect(db.addFills([{ ...base, id: 'tos:1', broker: 'thinkorswim', execTime: '2026-09-15T10:31:05' }])).toBe(0);
    expect(db.allFills()).toMatchObject([{ id: 'snaptrade:a:1', execTime: '2026-09-15T10:31:05', account: 'Schwab · Trading' }]);
    expect(db.allFills()[0].timeExact).toBeUndefined();
  });

  it('removes one account\'s fills and leaves the rest', () => {
    const db = new JournalDb(':memory:');
    db.addFills([
      { ...base, id: 'snaptrade:a:1', broker: 'snaptrade', account: 'Schwab · Old', execTime: '2026-09-15T10:00:00' },
      { ...base, id: 'snaptrade:b:1', broker: 'snaptrade', account: 'Schwab · Trading', execTime: '2026-09-16T10:00:00' },
      { ...base, id: 'tos:1', broker: 'thinkorswim', execTime: '2026-09-17T10:00:00' },
    ]);
    expect(db.accountFillCounts()).toEqual([{ account: null, fills: 1 }, { account: 'Schwab · Old', fills: 1 }, { account: 'Schwab · Trading', fills: 1 }].map((c) => expect.objectContaining(c)));
    expect(db.removeAccountFills('Schwab · Old')).toBe(1);
    expect(db.removeAccountFills(null)).toBe(1);
    expect(db.allFills().map((f) => f.id)).toEqual(['snaptrade:b:1']);
  });
});

