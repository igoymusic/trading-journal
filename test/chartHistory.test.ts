import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => { (globalThis as any).window = new EventTarget(); });

describe('chart undo and redo', () => {
  it('undoes and redoes per chart, merging quick changes to the same thing', async () => {
    const { record, redo, undo } = await import('../src/renderer/chartHistory');
    let a = 0, b = 0;
    const set = (to: number) => () => { a = to; };
    a = 1; record({ scope: 'trade:1', undo: set(0), redo: set(1) });
    b = 1; record({ scope: 'day:x', undo: () => { b = 0; }, redo: () => { b = 1; } });
    a = 2; record({ scope: 'trade:1', key: 'opacity', undo: set(1), redo: set(2) });
    a = 3; record({ scope: 'trade:1', key: 'opacity', undo: set(2), redo: set(3) });

    undo('trade:1');
    expect(a).toBe(1);
    expect(b).toBe(1);
    redo('trade:1');
    expect(a).toBe(3);
    undo('trade:1'); undo('trade:1');
    expect(a).toBe(0);
    undo('day:x');
    expect(b).toBe(0);
    // A new change drops what could be redone on that chart.
    a = 5; record({ scope: 'trade:1', undo: set(0), redo: set(5) });
    redo('trade:1');
    expect(a).toBe(5);
    redo('day:x');
    expect(b).toBe(1);
  });
});
