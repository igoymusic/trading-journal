import { describe, expect, it } from 'vitest';
import { contractUsd, optionUsd, setOptionPriceDisplay } from '../src/renderer/format';

describe('option prices', () => {
  it('shows quotes and per-contract amounts the same way in either style', () => {
    // A fill quoted at $0.15 and a trade averaging $15.00 per contract are the same price.
    setOptionPriceDisplay('contract');
    expect(optionUsd(0.15)).toBe('$15.00');
    expect(contractUsd(15)).toBe('$15.00');
    setOptionPriceDisplay('quote');
    expect(optionUsd(0.15)).toBe('$0.15');
    expect(contractUsd(15)).toBe('$0.15');
    setOptionPriceDisplay(undefined);
  });
});
