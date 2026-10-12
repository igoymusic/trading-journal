import { describe, expect, it } from 'vitest';
import { occSymbol } from '../src/core/alpaca';
import { bsPrice, impliedVol } from '../src/core/blackScholes';
import { dollarRiskReward, priceLevels } from '../src/core/optionLevels';
import type { Trade } from '../src/core/types';

const MIN = 60_000;
const t0 = Date.UTC(2026, 8, 15, 17, 20); // 13:20 New York
const trade = {
  id: 't', underlying: 'SPY', expiry: '2026-09-15', strike: 776, putCall: 'CALL', direction: 'LONG', status: 'CLOSED',
  openTime: '2026-09-15T13:20:00', closeTime: '2026-09-15T13:30:00', maxContracts: 2, avgEntry: 136, grossPnl: 0, fees: 0, netPnl: 0, fills: [],
} as unknown as Trade;
// Underlying drifts 776.70 -> 777.70 over ten minutes, 0.10 a minute.
const bars = Array.from({ length: 11 }, (_, i) => {
  const p = 776.7 + i * 0.1;
  return { time: t0 + i * MIN, open: p, close: p + 0.1, high: p + 0.12, low: p - 0.02, volume: 1 };
});
const input = {
  trade, bars,
  entry: { time: t0, underlying: 776.7, optionPrice: 1.36 },
  exitTime: t0 + 10 * MIN,
  expiryTime: Date.UTC(2026, 8, 15, 20, 0),
};

describe('option price at stop and target lines', () => {
  it('builds OCC option symbols', () => {
    expect(occSymbol('SPY', '2026-09-15', 'CALL', 776)).toBe('SPY260915C00776000');
    expect(occSymbol('TSLA', '2026-01-09', 'PUT', 402.5)).toBe('TSLA260109P00402500');
  });

  it('uses the real option price where the underlying reached the line', () => {
    // 777.20 is first inside the 13:24 candle; the option last traded at 13:23.
    const optionBars = [{ time: t0 + 3 * MIN, open: 1.7, high: 1.75, low: 1.68, close: 1.72, volume: 3 }];
    const [p] = priceLevels({ ...input, levels: [{ price: 777.2, contracts: 1 }], optionBars });
    expect(p).toMatchObject({ source: 'market', optionPrice: 1.72, reached: true, time: t0 + 4 * MIN });
  });

  it('estimates with the entry volatility where it never got there', () => {
    const [p] = priceLevels({ ...input, levels: [{ price: 776.2, contracts: 1 }] });
    const vol = impliedVol(1.36, { spot: 776.7, strike: 776, msToExpiry: input.expiryTime - t0, putCall: 'CALL' })!;
    expect(p).toMatchObject({ source: 'estimate', reached: false, time: input.exitTime });
    expect(p!.optionPrice).toBeCloseTo(bsPrice({ spot: 776.2, strike: 776, msToExpiry: input.expiryTime - input.exitTime, putCall: 'CALL' }, vol), 6);
    expect(p!.optionPrice).toBeLessThan(1.36);
  });

  it('still estimates when the entry price is below what the option was worth', () => {
    // A 756 call bought for $1.36 with SPY at 776.70 can't be explained by any volatility.
    const deep = { ...input, trade: { ...trade, strike: 756 } as Trade };
    const [stop, target] = priceLevels({ ...deep, levels: [{ price: 776.2, contracts: 1 }, { price: 777.2, contracts: 1 }] });
    expect(stop!.optionPrice).toBeLessThan(1.36);
    expect(target!.optionPrice).toBeGreaterThan(1.36);
  });

  it('turns priced levels into dollar risk and reward', () => {
    const stop = { optionPrice: 0.96, source: 'estimate' as const, time: 0, reached: false };
    const target = { optionPrice: 2.16, source: 'market' as const, time: 0, reached: true };
    // Long from $136 a contract: stop loses $40 on each of 2 contracts, target makes $80 on 1.
    const rr = dollarRiskReward(trade, [{ price: 776.2, contracts: 2 }], [stop], [{ price: 778, contracts: 1 }], [target]);
    expect(rr.risk).toBeCloseTo(80);
    expect(rr.reward).toBeCloseTo(80);
    expect(rr.ratio).toBeCloseTo(1);
  });
});
