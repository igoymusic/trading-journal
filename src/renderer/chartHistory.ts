// Undo and redo for chart changes: drawings, and a trade's stop and target lines. Each chart keeps
// its own list (its "scope"), so Ctrl+Z on one chart never changes something on another.

import { useEffect, useState } from 'react';

export interface Step {
  /** The chart the change was made on, like "trade:<id>" or "day:2026-10-21". */
  scope: string;
  undo(): void;
  redo(): void;
  /**
   * Changes to the same thing a moment apart (dragging a color or opacity slider) count as one
   * step, so one undo takes them all back.
   */
  key?: string;
}

const LIMIT = 200;
const MERGE_MS = 1000;
const CHANGED = 'chart-history-changed';
let undos: (Step & { at: number })[] = [];
let redos: Step[] = [];

const changed = () => window.dispatchEvent(new Event(CHANGED));

/** Adds a change someone just made. Anything that was undone can no longer be redone. */
export function record(step: Step) {
  const now = Date.now();
  const last = undos[undos.length - 1];
  if (step.key && last && last.key === step.key && last.scope === step.scope && now - last.at < MERGE_MS) {
    undos[undos.length - 1] = { ...last, redo: step.redo, at: now };
  } else {
    undos.push({ ...step, at: now });
    if (undos.length > LIMIT) undos = undos.slice(-LIMIT);
  }
  redos = redos.filter((s) => s.scope !== step.scope);
  changed();
}

export function undo(scope: string) {
  const i = undos.map((s) => s.scope).lastIndexOf(scope);
  if (i < 0) return;
  const [step] = undos.splice(i, 1);
  redos.push(step);
  step.undo();
  changed();
}

export function redo(scope: string) {
  const i = redos.map((s) => s.scope).lastIndexOf(scope);
  if (i < 0) return;
  const [step] = redos.splice(i, 1);
  undos.push({ ...step, at: 0 });
  step.redo();
  changed();
}

/** Whether a chart has anything to undo or redo; updates as changes are made. */
export function useHistory(scope: string) {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const on = () => setVersion((v) => v + 1);
    window.addEventListener(CHANGED, on);
    return () => window.removeEventListener(CHANGED, on);
  }, []);
  return { canUndo: undos.some((s) => s.scope === scope), canRedo: redos.some((s) => s.scope === scope) };
}

// Saving a trade's lines needs that trade's latest journal, which only its open panel has.
const appliers = new Map<string, (value: unknown) => void>();

/** Lets steps recorded under `name` apply their values through `apply` (call on every render). */
export function setApplier(name: string, apply: (value: unknown) => void) {
  appliers.set(name, apply);
}

export function applyTo(name: string, value: unknown) {
  appliers.get(name)?.(value);
}

/** Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes, unless you're typing in a box. */
export function historyKey(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) return null;
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y') return 'redo';
  return null;
}
