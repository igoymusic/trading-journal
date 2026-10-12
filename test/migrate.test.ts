import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { moveDataFromOldName } from '../src/main/migrate';

describe('rename to Moon Journal', () => {
  function setup() {
    const appData = mkdtempSync(path.join(tmpdir(), 'mj-'));
    const oldDir = path.join(appData, 'trading-journal');
    mkdirSync(oldDir);
    writeFileSync(path.join(oldDir, 'journal.sqlite'), 'db');
    writeFileSync(path.join(oldDir, 'settings.json'), '{}');
    writeFileSync(path.join(oldDir, 'Cookies'), 'x');
    return { appData, newDir: path.join(appData, 'Moon Journal') };
  }

  it('copies the journal and settings into the new folder', () => {
    const { appData, newDir } = setup();
    moveDataFromOldName(appData, newDir);
    expect(readFileSync(path.join(newDir, 'journal.sqlite'), 'utf8')).toBe('db');
    expect(existsSync(path.join(newDir, 'settings.json'))).toBe(true);
    expect(existsSync(path.join(newDir, 'Cookies'))).toBe(false);
  });

  it('never overwrites a journal that already exists', () => {
    const { appData, newDir } = setup();
    mkdirSync(newDir);
    writeFileSync(path.join(newDir, 'journal.sqlite'), 'newer');
    moveDataFromOldName(appData, newDir);
    expect(readFileSync(path.join(newDir, 'journal.sqlite'), 'utf8')).toBe('newer');
  });
});
