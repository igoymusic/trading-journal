// Which tabs are open along the top. Home, All trades and Year are always there; a Month tab and
// any number of Day tabs open as you drill in. Picking a different year or month closes the
// tabs under it, so the open days always belong to the open month.

export type ActiveTab = 'home' | 'trades' | 'year' | 'month' | `day:${string}`;

export interface TabsState {
  year: number;
  month: { year: number; month: number } | null;
  /** Open Day tabs, "YYYY-MM-DD", in the order they were opened. */
  days: string[];
  active: ActiveTab;
}

export type TabAction =
  | { type: 'show'; tab: ActiveTab }
  /** Clicking a day on the Home calendar opens its Year, Month and Day. */
  | { type: 'openDayFromHome'; date: string }
  | { type: 'selectYear'; year: number }
  | { type: 'openMonth'; year: number; month: number }
  /** Clicking a day in the Month tab adds a Day tab and keeps the others. */
  | { type: 'openDay'; date: string }
  | { type: 'closeDay'; date: string }
  | { type: 'closeMonth' };

const monthOf = (date: string) => ({ year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) });
const sameMonth = (a: TabsState['month'], b: TabsState['month']) => !!a && !!b && a.year === b.year && a.month === b.month;

export function initialTabs(today: Date): TabsState {
  return { year: today.getFullYear(), month: null, days: [], active: 'home' };
}

export function tabsReducer(s: TabsState, a: TabAction): TabsState {
  switch (a.type) {
    case 'show':
      return { ...s, active: a.tab };
    case 'openDayFromHome': {
      const month = monthOf(a.date);
      // Days already open from the same month stay open.
      const days = sameMonth(s.month, month) ? (s.days.includes(a.date) ? s.days : [...s.days, a.date]) : [a.date];
      return { year: month.year, month, days, active: `day:${a.date}` };
    }
    case 'selectYear':
      if (a.year === s.year) return { ...s, active: 'year' };
      return { year: a.year, month: null, days: [], active: 'year' };
    case 'openMonth': {
      const month = { year: a.year, month: a.month };
      if (sameMonth(s.month, month)) return { ...s, active: 'month' };
      return { year: a.year, month, days: [], active: 'month' };
    }
    case 'openDay':
      return { ...s, days: s.days.includes(a.date) ? s.days : [...s.days, a.date], active: `day:${a.date}` };
    case 'closeDay': {
      const i = s.days.indexOf(a.date);
      if (i < 0) return s;
      const days = s.days.filter((d) => d !== a.date);
      if (s.active !== `day:${a.date}`) return { ...s, days };
      // Move to the tab on the left: the previous day, or the month.
      const left = days[i - 1];
      return { ...s, days, active: left ? `day:${left}` : 'month' };
    }
    case 'closeMonth': {
      const onClosed = s.active === 'month' || s.active.startsWith('day:');
      return { ...s, month: null, days: [], active: onClosed ? 'year' : s.active };
    }
  }
}
