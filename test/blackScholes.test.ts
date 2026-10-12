import { describe, expect, it } from 'vitest';
import { bsPrice, impliedVol } from '../src/core/blackScholes';

const YEAR = 365 * 24 * 3600 * 1000;

describe('Black-Scholes', () => {
  it('matches a textbook value (S=100, K=100, 1 year, 20% vol, 4% rate)', () => {
    // Known result for these inputs: call ≈ 9.925, put ≈ 6.004.
    expect(bsPrice({ spot: 100, strike: 100, msToExpiry: YEAR, putCall: 'CALL' }, 0.2)).toBeCloseTo(9.925, 2);
    expect(bsPrice({ spot: 100, strike: 100, msToExpiry: YEAR, putCall: 'PUT' }, 0.2)).toBeCloseTo(6.004, 2);
  });

  it('recovers the volatility from a price', () => {
    const inputs = { spot: 776.7, strike: 776, msToExpiry: 3 * 3600_000, putCall: 'CALL' as const };
    const price = bsPrice(inputs, 0.18);
    expect(impliedVol(price, inputs)).toBeCloseTo(0.18, 4);
  });

  it('prices a 0DTE call higher when the underlying rises', () => {
    const inputs = { spot: 776.7, strike: 776, msToExpiry: 2 * 3600_000, putCall: 'CALL' as const };
    const vol = impliedVol(1.36, inputs)!;
    expect(bsPrice({ ...inputs, spot: 777.7 }, vol)).toBeGreaterThan(1.36);
    expect(bsPrice({ ...inputs, spot: 775.7 }, vol)).toBeLessThan(1.36);
  });

  it('has no volatility for a price below intrinsic value', () => {
    expect(impliedVol(0.1, { spot: 780, strike: 776, msToExpiry: 3600_000, putCall: 'CALL' })).toBeNull();
  });
});
