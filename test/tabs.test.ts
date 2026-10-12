import { describe, expect, it } from 'vitest';
import { initialTabs, type TabAction, tabsReducer, type TabsState } from '../src/renderer/tabs';

const run = (s: TabsState, ...actions: TabAction[]) => actions.reduce(tabsReducer, s);
const start = initialTabs(new Date(2026, 9, 12));

describe('tabs', () => {
  it('starts on Home with this year', () => {
    expect(start).toEqual({ year: 2026, month: null, days: [], active: 'home' });
  });

  it('opens Year, Month and Day from a day on the Home calendar', () => {
    const s = run(start, { type: 'openDayFromHome', date: '2025-11-03' });
    expect(s).toEqual({ year: 2025, month: { year: 2025, month: 11 }, days: ['2025-11-03'], active: 'day:2025-11-03' });
  });

  it('keeps earlier Day tabs open when another day of the month is opened', () => {
    const s = run(start, { type: 'openMonth', year: 2026, month: 9 }, { type: 'openDay', date: '2026-09-14' }, { type: 'openDay', date: '2026-09-15' }, { type: 'openDay', date: '2026-09-14' });
    expect(s.days).toEqual(['2026-09-14', '2026-09-15']);
    expect(s.active).toBe('day:2026-09-14');
  });

  it('closes the Month and Day tabs when a different month or year is picked', () => {
    const open = run(start, { type: 'openMonth', year: 2026, month: 9 }, { type: 'openDay', date: '2026-09-14' });
    expect(run(open, { type: 'openMonth', year: 2026, month: 9 })).toMatchObject({ days: ['2026-09-14'], active: 'month' });
    expect(run(open, { type: 'openMonth', year: 2026, month: 8 })).toMatchObject({ month: { year: 2026, month: 8 }, days: [] });
    expect(run(open, { type: 'selectYear', year: 2026 })).toMatchObject({ month: { year: 2026, month: 9 }, days: ['2026-09-14'] });
    expect(run(open, { type: 'selectYear', year: 2025 })).toEqual({ year: 2025, month: null, days: [], active: 'year' });
  });

  it('moves to the tab on the left when the open Day tab closes', () => {
    const open = run(start, { type: 'openMonth', year: 2026, month: 9 }, { type: 'openDay', date: '2026-09-14' }, { type: 'openDay', date: '2026-09-15' });
    expect(run(open, { type: 'closeDay', date: '2026-09-15' })).toMatchObject({ days: ['2026-09-14'], active: 'day:2026-09-14' });
    expect(run(open, { type: 'closeDay', date: '2026-09-15' }, { type: 'closeDay', date: '2026-09-14' })).toMatchObject({ days: [], active: 'month' });
    expect(run(open, { type: 'closeMonth' })).toMatchObject({ month: null, days: [], active: 'year' });
  });
});
