import { describe, expect, it } from 'vitest';
import { moveSection, normalizeLayout, toggleChart, toggleCollapsed } from '../src/renderer/reportsLayout';

describe('reports layout', () => {
  it('alternates sections between two columns by default', () => {
    expect(normalizeLayout(undefined, ['a', 'b', 'c', 'd', 'e']).columns).toEqual([['a', 'c', 'e'], ['b', 'd']]);
  });

  it('keeps a saved layout, dropping sections that are gone and adding new ones to the shorter column', () => {
    const saved = { columns: [['c', 'a', 'gone'], ['b']], collapsed: ['a', 'gone'] };
    expect(normalizeLayout(saved, ['a', 'b', 'c', 'd'])).toEqual({ columns: [['c', 'a'], ['b', 'd']], collapsed: ['a'], charts: [] });
  });

  it('moves a section within a column or across to the other', () => {
    const l = { columns: [['a', 'b', 'c'], ['d', 'e']], collapsed: [] };
    expect(moveSection(l, 'c', 0, 0).columns).toEqual([['c', 'a', 'b'], ['d', 'e']]);
    expect(moveSection(l, 'a', 1, 1).columns).toEqual([['b', 'c'], ['d', 'a', 'e']]);
    expect(moveSection(l, 'a', 1, 99).columns).toEqual([['b', 'c'], ['d', 'e', 'a']]);
  });

  it('collapses and expands a section', () => {
    const l = { columns: [['a']], collapsed: [] };
    expect(toggleCollapsed(l, 'a').collapsed).toEqual(['a']);
    expect(toggleCollapsed(toggleCollapsed(l, 'a'), 'a').collapsed).toEqual([]);
  });

  it('puts new chart sections at the top and remembers chart views', () => {
    const saved = { columns: [['a'], ['b']], collapsed: [] };
    expect(normalizeLayout(saved, ['x', 'y', 'a', 'b', 'c'], 2, ['x', 'y']).columns).toEqual([['x', 'a', 'c'], ['y', 'b']]);
    const l = { columns: [['a']], collapsed: [] };
    expect(toggleChart(l, 'a').charts).toEqual(['a']);
    expect(toggleChart(toggleChart(l, 'a'), 'a').charts).toEqual([]);
  });
});
