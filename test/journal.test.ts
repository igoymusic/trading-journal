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

  it('keeps one note per day', () => {
    const db = new JournalDb(':memory:');
    db.saveDayNote('2026-09-15', 'Choppy open');
    db.saveDayNote('2026-09-15', 'Choppy open, waited for the trend');
    expect(db.dayNotes()).toEqual({ '2026-09-15': 'Choppy open, waited for the trend' });
  });
});
