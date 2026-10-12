import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMNS, moveColumn, resolveColumns } from '../src/renderer/columns';

describe('trade table columns', () => {
  it('moves a column before another or to the end', () => {
    expect(moveColumn(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveColumn(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a']);
  });

  it('falls back to defaults and drops unknown columns', () => {
    expect(resolveColumns(undefined).map((c) => c.id)).toEqual(DEFAULT_COLUMNS);
    expect(resolveColumns(['net', 'gone', 'symbol']).map((c) => c.id)).toEqual(['net', 'symbol']);
    expect(resolveColumns(['gone']).map((c) => c.id)).toEqual(DEFAULT_COLUMNS);
  });
});
