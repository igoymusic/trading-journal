import { describe, expect, it } from 'vitest';
import { averageUnderlying, bias, formatR, riskReward } from '../src/core/rr';
import type { TradeJournal } from '../src/core/types';

const base: TradeJournal = { notes: '', setupId: null, mistakes: [], rating: null };
const longCall = { putCall: 'CALL' as const, direction: 'LONG' as const };
const longPut = { putCall: 'PUT' as const, direction: 'LONG' as const };

describe('R from underlying prices', () => {
  it('knows which way each trade wants the underlying to go', () => {
    expect(bias(longCall)).toBe(1);
    expect(bias(longPut)).toBe(-1);
    expect(bias({ putCall: 'PUT', direction: 'SHORT' })).toBe(1);
    expect(bias({ putCall: 'CALL', direction: 'SHORT' })).toBe(-1);
  });

  it('needs a stop on the losing side of the entry', () => {
    expect(riskReward(longCall, { ...base, underlyingEntry: 100 })).toBeNull();
    expect(riskReward(longCall, { ...base, underlyingEntry: 100, stops: [{ price: 101, contracts: 1 }] })).toBeNull();
  });

  it('measures a long call: $1 risk, exit $2 higher = +2R, target $3 higher = 3R planned', () => {
    const rr = riskReward(longCall, {
      ...base, underlyingEntry: 100, underlyingExit: 102, stops: [{ price: 99, contracts: 1 }], targets: [{ price: 103, contracts: 1 }],
    });
    expect(rr).toEqual({ risk: 1, realizedR: 2, plannedR: 3 });
  });

  it('flips for puts: underlying falling is the win', () => {
    const rr = riskReward(longPut, { ...base, underlyingEntry: 100, underlyingExit: 100.5, stops: [{ price: 100.5, contracts: 2 }] });
    expect(rr).toEqual({ risk: 0.5, realizedR: -1 });
  });

  it('weights levels by the contracts at each', () => {
    // 2 contracts risk $1, 1 contract risks $2: average risk $4/3.
    // Targets: 2 contracts at +$2, 1 at +$4: average reward $8/3, so 2R planned.
    const rr = riskReward(longCall, {
      ...base, underlyingEntry: 100,
      stops: [{ price: 99, contracts: 2 }, { price: 98, contracts: 1 }],
      targets: [{ price: 102, contracts: 2 }, { price: 104, contracts: 1 }],
    })!;
    expect(rr.risk).toBeCloseTo(4 / 3);
    expect(rr.plannedR).toBeCloseTo(2);
  });

  it('averages the underlying over fills by quantity', () => {
    expect(averageUnderlying([{ quantity: 1, underlying: 100 }, { quantity: 3, underlying: 104 }])).toBe(103);
    expect(averageUnderlying([{ quantity: 1 }])).toBeUndefined();
  });

  it('formats R', () => {
    expect(formatR(1.84)).toBe('+1.8R');
    expect(formatR(-1)).toBe('−1.0R');
  });
});
