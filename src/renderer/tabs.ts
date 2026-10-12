// Which tabs are open along the top. Home, All trades and Year are always there; Month and Day
// tabs open as you drill in. Picking a different year or month closes the Month and Day tabs
// that aren't pinned, so unpinned days always belong to the open month.

export type ActiveTab = 'home' | 'trades' | 'reports' | 'year' | `month:${string}` | `day:${string}`;

export interface MonthTab { year: number; month: number; pinned: boolean }
export interface DayTab { date: string; pinned: boolean }

export interface TabsState {
  year: number;
  /** Open Month tabs in the order they were opened. Only pinned ones stay beside a new month. */
  months: MonthTab[];
  /** Open Day tabs, "YYYY-MM-DD", in the order they were opened. */
  days: DayTab[];
  active: ActiveTab;
}

export type TabAction =
  | { type: 'show'; tab: ActiveTab }
  /** Clicking a day on the Home calendar opens its Year, Month and Day. */
  | { type: 'openDayFromHome'; date: string }
  | { type: 'selectYear'; year: number }
  | { type: 'openMonth'; year: number; month: number }
  /** Clicking a day in a Month tab adds a Day tab and keeps the others. */
  | { type: 'openDay'; date: string }
  | { type: 'closeTab'; tab: ActiveTab }
  | { type: 'togglePin'; tab: ActiveTab };

export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
const keyOf = (m: { year: number; month: number }) => monthKey(m.year, m.month);

export function initialTabs(today: Date): TabsState {
  return { year: today.getFullYear(), months: [], days: [], active: 'home' };
}

/** Tabs in the order they're drawn: Year, the Month tabs, then the Day tabs. */
export function tabOrder(s: TabsState): ActiveTab[] {
  return ['year', ...s.months.map((m) => `month:${keyOf(m)}` as const), ...s.days.map((d) => `day:${d.date}` as const)];
}

/** Closes every unpinned Month and Day tab, except the month `keep` and its days. */
function closeUnpinned(s: TabsState, keep?: string): TabsState {
  return {
    ...s,
    months: s.months.filter((m) => m.pinned || keyOf(m) === keep),
    days: s.days.filter((d) => d.pinned || d.date.slice(0, 7) === keep),
  };
}

function withMonth(s: TabsState, year: number, month: number): TabsState {
  if (s.months.some((m) => keyOf(m) === monthKey(year, month))) return s;
  return { ...s, months: [...s.months, { year, month, pinned: false }] };
}

function withDay(s: TabsState, date: string): TabsState {
  if (s.days.some((d) => d.date === date)) return s;
  return { ...s, days: [...s.days, { date, pinned: false }] };
}

export function tabsReducer(s: TabsState, a: TabAction): TabsState {
  switch (a.type) {
    case 'show':
      return { ...s, active: a.tab };
    case 'openDayFromHome': {
      const year = Number(a.date.slice(0, 4));
      const month = Number(a.date.slice(5, 7));
      const next = withDay(withMonth(closeUnpinned(s, monthKey(year, month)), year, month), a.date);
      return { ...next, year, active: `day:${a.date}` };
    }
    case 'selectYear':
      if (a.year === s.year) return { ...s, active: 'year' };
      return { ...closeUnpinned(s), year: a.year, active: 'year' };
    case 'openMonth': {
      const key = monthKey(a.year, a.month);
      const next = withMonth(closeUnpinned(s, key), a.year, a.month);
      return { ...next, year: a.year, active: `month:${key}` };
    }
    case 'openDay':
      return { ...withDay(s, a.date), active: `day:${a.date}` };
    case 'closeTab': {
      if (a.tab === 'home' || a.tab === 'trades' || a.tab === 'reports' || a.tab === 'year') return s;
      const order = tabOrder(s);
      let next: TabsState;
      if (a.tab.startsWith('month:')) {
        const key = a.tab.slice(6);
        // Closing a month also closes its unpinned days.
        next = { ...s, months: s.months.filter((m) => keyOf(m) !== key), days: s.days.filter((d) => d.pinned || d.date.slice(0, 7) !== key) };
      } else {
        next = { ...s, days: s.days.filter((d) => d.date !== a.tab.slice(4)) };
      }
      const remaining = tabOrder(next);
      if (!order.includes(s.active) || remaining.includes(s.active)) return next;
      // The open tab went away: move to the nearest tab on its left that's still open.
      const left = order.slice(0, order.indexOf(s.active)).reverse().find((t) => remaining.includes(t));
      return { ...next, active: left ?? 'year' };
    }
    case 'togglePin':
      return {
        ...s,
        months: s.months.map((m) => (`month:${keyOf(m)}` === a.tab ? { ...m, pinned: !m.pinned } : m)),
        days: s.days.map((d) => (`day:${d.date}` === a.tab ? { ...d, pinned: !d.pinned } : d)),
      };
  }
}
