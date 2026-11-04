import { useMemo, useState } from 'react';
import type { Goals } from '../core/goals';
import { summarizeTrades } from '../core/trades';
import { tradeDay } from '../core/calendar';
import type { Trade } from '../core/types';
import { extraStats, streaks, tradeScore } from '../core/visuals';
import { Donut, RadarChart, shortDuration, VersusBar } from './Charts';
import { chartTones, colors } from './colors';
import { longDate, pnlClass, signedUsd, usd } from './format';
import { GoalsCard } from './GoalsCard';
import { MonthView } from './MonthView';
import { PnlChart } from './PnlChart';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Home: the calendar in the middle with a short P&L chart above it, and your stats down both sides.
 * The side stats cover all time, or just the month the calendar is showing.
 */
export function Home({ trades, goals, month, onMonthChange, onOpenDay, onOpenSettings }: {
  trades: Trade[];
  goals: Goals;
  month: { year: number; month: number };
  onMonthChange: (year: number, month: number) => void;
  onOpenDay: (date: string) => void;
  onOpenSettings: () => void;
}) {
  const [scope, setScope] = useState<'all' | 'month'>('all');
  const key = `${month.year}-${String(month.month).padStart(2, '0')}`;
  const scoped = useMemo(() => (scope === 'all' ? trades : trades.filter((t) => tradeDay(t).startsWith(key))), [trades, scope, key]);
  const s = useMemo(() => summarizeTrades(scoped), [scoped]);
  const x = useMemo(() => extraStats(scoped), [scoped]);
  const streak = useMemo(() => streaks(scoped), [scoped]);
  const score = useMemo(() => tradeScore(scoped), [scoped]);
  const c = colors();
  const breakEven = s.trades - s.wins - s.losses;
  const grossWin = s.avgWin * s.wins;
  const grossLoss = -s.avgLoss * s.losses;
  const days = x.greenDays + x.redDays;
  const scopeLabel = scope === 'all' ? 'All time' : `${MONTHS[month.month - 1]} ${month.year}`;

  return (
    <div className="home">
      <aside className="home-rail">
        <div className="scope-toggle" role="group" aria-label="Which trades the side stats cover">
          <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All time</button>
          <button className={scope === 'month' ? 'active' : ''} onClick={() => setScope('month')} title="The month the calendar is showing">Calendar month</button>
        </div>

        <div className="card stat">
          <div className="tile-label">Net P&L · {scopeLabel}</div>
          <div className={`tile-value big ${pnlClass(s.netPnl)}`}>{signedUsd(s.netPnl)}</div>
          <div className="stat-rows">
            <span>Per trade</span><b className={pnlClass(x.expectancy)}>{signedUsd(x.expectancy)}</b>
            <span>Fees</span><b>{usd(s.fees)}</b>
            <span>Trades</span><b>{s.trades}</b>
          </div>
        </div>

        <div className="card stat">
          <div className="donut-pair">
            <div>
              <div className="tile-label">Win rate</div>
              <Donut
                size={96}
                legend={false}
                center={`${Math.round(s.winRate * 100)}%`}
                slices={[
                  { label: 'Wins', value: s.wins, color: c.win, detail: `${s.wins} trades` },
                  { label: 'Losses', value: s.losses, color: c.loss, detail: `${s.losses} trades` },
                  ...(breakEven ? [{ label: 'Even', value: breakEven, color: chartTones().other, detail: `${breakEven} trades` }] : []),
                ]}
              />
              <div className="tile-sub">{s.wins} won · {s.losses} lost</div>
            </div>
            <div>
              <div className="tile-label" title="Total won divided by total lost. Above 1 means you made money.">Profit factor</div>
              <Donut
                size={96}
                legend={false}
                center={s.profitFactor ? s.profitFactor.toFixed(2) : '—'}
                slices={[
                  { label: 'Won', value: grossWin, color: c.win, detail: signedUsd(grossWin) },
                  { label: 'Lost', value: grossLoss, color: c.loss, detail: signedUsd(-grossLoss) },
                ]}
              />
              <div className="tile-sub">won ÷ lost</div>
            </div>
          </div>
          <div className="stat-rows">
            <span>Total won</span><b className="win">{signedUsd(grossWin)}</b>
            <span>Total lost</span><b className="loss">{signedUsd(-grossLoss)}</b>
          </div>
        </div>

        <div className="card stat">
          <div className="tile-label">Average win vs loss</div>
          <div className="stat-pair">
            <b className="win">{signedUsd(s.avgWin)}</b>
            <b className="loss">{signedUsd(s.avgLoss)}</b>
          </div>
          <VersusBar win={s.avgWin} loss={s.avgLoss} />
          <div className="stat-rows">
            <span>Ratio</span><b>{s.avgLoss ? (s.avgWin / -s.avgLoss).toFixed(2) : '—'}</b>
            <span>Largest win</span><b className="win">{signedUsd(x.largestWin)}</b>
            <span>Largest loss</span><b className="loss">{signedUsd(x.largestLoss)}</b>
            <span>Hold, winners</span><b>{shortDuration(x.avgHoldWin)}</b>
            <span>Hold, losers</span><b>{shortDuration(x.avgHoldLoss)}</b>
          </div>
        </div>
        <div className="home-mascot" />
      </aside>

      <div className="home-main">
        <PnlChart trades={trades} />
        <div className="card home-calendar">
          <MonthView goals={goals} trades={trades} year={month.year} month={month.month} onMonthChange={onMonthChange} onOpenDay={onOpenDay} />
        </div>
      </div>

      <aside className="home-rail">
        {score && (
          <div className="card stat">
            <div className="tile-label" title="Hover a point to see what it measures">Trading score · {scopeLabel}</div>
            <RadarChart score={score} radius={48} />
          </div>
        )}

        <div className="card stat">
          <div className="tile-label">Green vs red days</div>
          <Donut
            size={104}
            center={days ? `${Math.round((x.greenDays / days) * 100)}%` : '—'}
            slices={[
              { label: 'Green', value: x.greenDays, color: c.win, detail: `${x.greenDays} days` },
              { label: 'Red', value: x.redDays, color: c.loss, detail: `${x.redDays} days` },
            ]}
          />
          <div className="stat-rows">
            <span>Days traded</span><b>{x.greenDays} green / {x.redDays} red</b>
            <span>Best day</span>
            <b className="win" title={x.bestDay ? longDate(x.bestDay.date) : undefined}>{x.bestDay ? signedUsd(x.bestDay.netPnl) : '—'}</b>
            <span>Worst day</span>
            <b className="loss" title={x.worstDay ? longDate(x.worstDay.date) : undefined}>{x.worstDay ? signedUsd(x.worstDay.netPnl) : '—'}</b>
          </div>
        </div>

        <div className="card stat streaks">
          <div className="tile-label">Streaks</div>
          <div className="stat-rows">
            <span>Right now</span><b className={pnlClass(streak.currentDays)}>{streakText(streak.currentDays, 'day')}</b>
            <span>Longest green run</span><b className="win">{streak.bestDays} day{streak.bestDays === 1 ? '' : 's'}</b>
            <span>Longest red run</span><b className="loss">{-streak.worstDays} day{streak.worstDays === -1 ? '' : 's'}</b>
            <span>Wins in a row</span><b className="win">{streak.bestTrades} trade{streak.bestTrades === 1 ? '' : 's'}</b>
            <span>Losses in a row</span><b className="loss">{-streak.worstTrades} trade{streak.worstTrades === -1 ? '' : 's'}</b>
          </div>
        </div>

        <GoalsCard trades={trades} goals={goals} year={month.year} month={month.month} onOpenSettings={onOpenSettings} />
      </aside>
    </div>
  );
}

function streakText(n: number, unit: string) {
  if (n === 0) return '—';
  const count = Math.abs(n);
  return `${count} ${n > 0 ? 'green' : 'red'} ${unit}${count === 1 ? '' : 's'}`;
}
