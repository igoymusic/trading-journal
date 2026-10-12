import { describe, expect, it } from 'vitest';
import { initialTabs, type TabAction, tabOrder, tabsReducer, type TabsState } from '../src/renderer/tabs';

const run = (s: TabsState, ...actions: TabAction[]) => actions.reduce(tabsReducer, s);
const start = initialTabs(new Date(2026, 9, 12));
const sept = run(start, { type: 'openMonth', year: 2026, month: 9 }, { type: 'openDay', date: '2026-09-14' }, { type: 'openDay', date: '2026-09-15' });

describe('tabs', () => {
  it('starts on Home with this year', () => {
    expect(start).toEqual({ year: 2026, months: [], days: [], active: 'home' });
  });

  it('opens Year, Month and Day from a day on the Home calendar', () => {
    const s = run(start, { type: 'openDayFromHome', date: '2025-11-03' });
    expect(s.year).toBe(2025);
    expect(tabOrder(s)).toEqual(['year', 'month:2025-11', 'day:2025-11-03']);
    expect(s.active).toBe('day:2025-11-03');
  });

  it('keeps earlier Day tabs open when another day of the month is opened', () => {
    const s = run(sept, { type: 'openDay', date: '2026-09-14' });
    expect(tabOrder(s)).toEqual(['year', 'month:2026-09', 'day:2026-09-14', 'day:2026-09-15']);
    expect(s.active).toBe('day:2026-09-14');
  });

  it('closes unpinned Month and Day tabs when a different month or year is picked', () => {
    expect(tabOrder(run(sept, { type: 'openMonth', year: 2026, month: 9 }))).toHaveLength(4);
    expect(tabOrder(run(sept, { type: 'openMonth', year: 2026, month: 8 }))).toEqual(['year', 'month:2026-08']);
    expect(tabOrder(run(sept, { type: 'selectYear', year: 2026 }))).toHaveLength(4);
    expect(run(sept, { type: 'selectYear', year: 2025 })).toEqual({ year: 2025, months: [], days: [], active: 'year' });
  });

  it('keeps pinned tabs open through month and year changes', () => {
    const pinned = run(sept, { type: 'togglePin', tab: 'day:2026-09-14' }, { type: 'togglePin', tab: 'month:2026-09' });
    expect(tabOrder(run(pinned, { type: 'openMonth', year: 2026, month: 8 }))).toEqual(['year', 'month:2026-09', 'month:2026-08', 'day:2026-09-14']);
    expect(tabOrder(run(pinned, { type: 'selectYear', year: 2025 }))).toEqual(['year', 'month:2026-09', 'day:2026-09-14']);
    expect(tabOrder(run(pinned, { type: 'openDayFromHome', date: '2026-10-12' }))).toEqual(['year', 'month:2026-09', 'month:2026-10', 'day:2026-09-14', 'day:2026-10-12']);
    // Unpinning lets it close again.
    const unpinned = run(pinned, { type: 'togglePin', tab: 'day:2026-09-14' }, { type: 'openMonth', year: 2026, month: 8 });
    expect(tabOrder(unpinned)).toEqual(['year', 'month:2026-09', 'month:2026-08']);
  });

  it('moves to the tab on the left when the open tab closes', () => {
    expect(run(sept, { type: 'closeTab', tab: 'day:2026-09-15' })).toMatchObject({ active: 'day:2026-09-14' });
    expect(run(sept, { type: 'closeTab', tab: 'day:2026-09-15' }, { type: 'closeTab', tab: 'day:2026-09-14' })).toMatchObject({ active: 'month:2026-09' });
    expect(run(sept, { type: 'closeTab', tab: 'month:2026-09' })).toMatchObject({ months: [], days: [], active: 'year' });
    // Closing a tab you're not looking at leaves you where you are.
    expect(run(sept, { type: 'closeTab', tab: 'day:2026-09-14' })).toMatchObject({ active: 'day:2026-09-15' });
  });
});
