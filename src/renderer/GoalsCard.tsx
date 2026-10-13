import { customGoalResult, describeGoal, GOAL_METRICS, hasGoals, type Goals, monthGoals } from '../core/goals';
import type { Trade } from '../core/types';
import { pnlClass, signedUsd, usd } from './format';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** How the month shown on Home is going against your goals. */
export function GoalsCard({ trades, goals, year, month, onOpenSettings }: {
  trades: Trade[];
  goals: Goals;
  year: number;
  month: number;
  onOpenSettings: () => void;
}) {
  if (!hasGoals(goals)) {
    return (
      <div className="card goals">
        <div className="goals-head"><h3>Goals</h3></div>
        <p className="muted">Set a daily target, a max loss, a max number of trades, a monthly target or a goal of your own to track them here.</p>
        <button onClick={onOpenSettings}>Set goals</button>
      </div>
    );
  }
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const m = monthGoals(trades, monthKey, goals);
  const rows: { label: string; value: number | undefined; good: boolean }[] = [
    { label: `Hit the ${usd(goals.dailyTarget ?? 0)} daily target`, value: m.daysHitTarget, good: true },
    { label: `Stayed within the ${usd(goals.dailyMaxLoss ?? 0)} max loss`, value: m.daysWithinMaxLoss, good: true },
    { label: `Stayed within ${goals.maxTradesPerDay} trades a day`, value: m.daysWithinMaxTrades, good: true },
  ];
  const pct = m.monthlyProgress === undefined ? 0 : Math.max(0, Math.min(1, m.monthlyProgress));
  return (
    <div className="card goals">
      <div className="goals-head">
        <h3>{MONTHS[month - 1]} goals</h3>
        <button className="link-button" onClick={onOpenSettings}>Edit</button>
      </div>
      {goals.monthlyTarget !== undefined && (
        <div className="goal-progress">
          <div className="goal-progress-label">
            <span><b className={pnlClass(m.netPnl)}>{signedUsd(m.netPnl)}</b> <span className="muted">of {usd(goals.monthlyTarget)} target</span></span>
            <span className="muted">{Math.round((m.monthlyProgress ?? 0) * 100)}%</span>
          </div>
          <div className="goal-track"><div className={`goal-fill ${m.netPnl < 0 ? 'loss-fill' : 'win-fill'}`} style={{ width: `${pct * 100}%` }} /></div>
        </div>
      )}
      {m.tradedDays === 0 ? <p className="muted">No trading days this month yet.</p> : rows.filter((r) => r.value !== undefined).map((r) => (
        <div className="goal-row" key={r.label}>
          <span>{r.label}</span>
          <span className={r.value === m.tradedDays ? 'win' : r.value! / m.tradedDays < 0.5 ? 'loss' : ''}>
            <b>{r.value}</b> <span className="muted">of {m.tradedDays} day{m.tradedDays === 1 ? '' : 's'}</span>
          </span>
        </div>
      ))}
      {m.tradedDays > 0 && (goals.custom ?? []).map((g) => {
        const r = customGoalResult(trades, g, monthKey);
        const unit = GOAL_METRICS.find((x) => x.key === g.metric)!.unit;
        const fmt = (v: number | undefined) => v === undefined ? '–' : v === Infinity ? '∞'
          : unit === '$' ? usd(v) : unit === '%' ? `${Math.round(v)}%` : String(Math.round(v * 100) / 100);
        if (g.period === 'month') {
          const p = r.periods[0];
          // An "at least" goal still counts as in progress while the month isn't over; going over an "at most" one is final.
          const cls = p?.met ? 'win' : p?.met === false && g.op === 'atMost' ? 'loss' : '';
          return (
            <div className="goal-row" key={g.id}>
              <span>{describeGoal(g)}</span>
              <span className={cls}><b>{fmt(p?.value)}</b> <span className="muted">of {fmt(g.value)} so far</span></span>
            </div>
          );
        }
        const word = g.period === 'day' ? 'day' : 'week';
        return (
          <div className="goal-row" key={g.id} title={r.periods.map((p) => `${p.key}: ${fmt(p.value)}`).join('\n')}>
            <span>{describeGoal(g)}</span>
            {r.measured ? (
              <span className={r.met === r.measured ? 'win' : r.met / r.measured < 0.5 ? 'loss' : ''}>
                <b>{r.met}</b> <span className="muted">of {r.measured} {word}{r.measured === 1 ? '' : 's'}</span>
              </span>
            ) : <span className="muted">nothing to measure yet</span>}
          </div>
        );
      })}
    </div>
  );
}
