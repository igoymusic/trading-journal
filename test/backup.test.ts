import { mkdtempSync, readdirSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Backups } from '../src/main/backup';
import { JournalDb } from '../src/main/db';
import type { Settings } from '../src/main/settings';

function fakeSettings(extra: Record<string, unknown> = {}) {
  const s = { portable: () => ({ timeZone: 'America/Chicago', goals: { dailyMaxLoss: 300 } }), restored: null as unknown, backupFolder: undefined as string | undefined, lastAutoBackup: undefined as string | undefined, ...extra };
  return Object.assign(s, { restorePortable(from: unknown) { s.restored = from; } });
}

describe('backups', () => {
  it('round-trips the database, screenshots and settings', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mj-'));
    const db = new JournalDb(path.join(dir, 'journal.sqlite'));
    db.saveDayNote('2026-10-09', 'Good day');
    db.putDrawing('SPX', { id: 'h', day: '2026-10-09', color: '#ffffff', kind: 'hline', price: 6740 });
    const shotId = '897a5d24-b07e-4c9a-bd90-d01f1d4f0a8b';
    mkdirSync(path.join(dir, 'screenshots'));
    writeFileSync(path.join(dir, 'screenshots', `${shotId}.png`), 'png bytes');
    const settings = fakeSettings();
    const file = path.join(dir, 'out', 'b.moonbackup');
    new Backups(db, settings as unknown as Settings, dir).write(file);
    db.close();

    const target = mkdtempSync(path.join(tmpdir(), 'mj2-'));
    const other = fakeSettings();
    Backups.restore(file, target, other as unknown as Settings);
    const restored = new JournalDb(path.join(target, 'journal.sqlite'));
    expect(restored.dayNotes()).toEqual({ '2026-10-09': 'Good day' });
    expect(restored.drawings('SPX', ['2026-10-09'])).toHaveLength(1);
    restored.close();
    expect(readFileSync(path.join(target, 'screenshots', `${shotId}.png`), 'utf8')).toBe('png bytes');
    expect(other.restored).toEqual({ timeZone: 'America/Chicago', goals: { dailyMaxLoss: 300 } });
  });

  it('refuses other files and keeps two weeks of daily backups', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mj-'));
    writeFileSync(path.join(dir, 'x.moonbackup'), 'nope');
    expect(() => Backups.read(path.join(dir, 'x.moonbackup'))).toThrow(/isn't a Moon Journal backup/);

    const db = new JournalDb(path.join(dir, 'journal.sqlite'));
    const folder = path.join(dir, 'cloud');
    const settings = fakeSettings({ backupFolder: folder });
    const b = new Backups(db, settings as unknown as Settings, dir);
    for (let d = 1; d <= 16; d++) expect(b.autoBackup(`2026-10-${String(d).padStart(2, '0')}`)).not.toBeNull();
    expect(b.autoBackup('2026-10-16')).toBeNull();
    const kept = readdirSync(folder).sort();
    expect(kept).toHaveLength(14);
    expect(kept[0]).toBe('Moon Journal backup 2026-10-03.moonbackup');
    db.close();
  });
});
