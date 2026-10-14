// Backups: your whole journal in one file, to keep safe or move to another computer.
//
// A backup is gzip of: a line of JSON listing the files, then the files' bytes one after another.
// It holds the database (trades, notes, tags, drawings, cached prices), the screenshots, and your
// settings without any keys or sign-ins, since Windows locks those to the computer they were saved on.

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { JournalDb } from './db';
import type { Settings } from './settings';

const MAGIC = 'moon-journal-backup';
const AUTO_PREFIX = 'Moon Journal backup ';
const KEEP_AUTO = 14;

interface Manifest { format: string; version: 1; created: string; files: { name: string; size: number }[] }

export class Backups {
  constructor(private db: JournalDb, private settings: Settings, private dataDir: string) {}

  /** Writes a backup file; returns how big it is in bytes. */
  write(file: string): number {
    const tmp = path.join(this.dataDir, `backup-${process.pid}-${Date.now()}.sqlite`);
    try {
      // A consistent copy of the database, even while the app is using it.
      this.db.copyTo(tmp);
      const files: { name: string; data: Buffer }[] = [
        { name: 'journal.sqlite', data: readFileSync(tmp) },
        { name: 'settings.json', data: Buffer.from(JSON.stringify(this.settings.portable(), null, 2)) },
      ];
      const shots = path.join(this.dataDir, 'screenshots');
      for (const f of safeList(shots)) if (f.endsWith('.png')) files.push({ name: `screenshots/${f}`, data: readFileSync(path.join(shots, f)) });
      const manifest: Manifest = { format: MAGIC, version: 1, created: new Date().toISOString(), files: files.map((f) => ({ name: f.name, size: f.data.length })) };
      const packed = gzipSync(Buffer.concat([Buffer.from(`${JSON.stringify(manifest)}\n`), ...files.map((f) => f.data)]));
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, packed);
      return packed.length;
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  /** Reads a backup file's contents, or throws if it isn't one. */
  static read(file: string): { manifest: Manifest; files: Map<string, Buffer> } {
    let raw: Buffer;
    try {
      raw = gunzipSync(readFileSync(file));
    } catch {
      throw new Error('That file isn\'t a Moon Journal backup.');
    }
    const nl = raw.indexOf(10);
    let manifest: Manifest;
    try {
      manifest = JSON.parse(raw.subarray(0, nl).toString('utf8'));
    } catch {
      throw new Error('That file isn\'t a Moon Journal backup.');
    }
    if (manifest.format !== MAGIC) throw new Error('That file isn\'t a Moon Journal backup.');
    if (manifest.version !== 1) throw new Error('That backup is from a newer Moon Journal. Update the app first.');
    const files = new Map<string, Buffer>();
    let at = nl + 1;
    for (const f of manifest.files) {
      // Only names this app writes; nothing that could land outside the data folder.
      if (!/^(journal\.sqlite|settings\.json|screenshots\/[0-9a-f-]{36}\.png)$/.test(f.name)) throw new Error('That backup has unexpected files in it.');
      files.set(f.name, raw.subarray(at, at + f.size));
      at += f.size;
    }
    if (at !== raw.length || !files.has('journal.sqlite')) throw new Error('That backup is incomplete or damaged.');
    return { manifest, files };
  }

  /**
   * Replaces this computer's journal with a backup's. Call with the database closed; the app
   * restarts afterwards. Keys and sign-ins on this computer are kept.
   */
  static restore(file: string, dataDir: string, settings: Settings) {
    const { files } = Backups.read(file);
    for (const suffix of ['', '-wal', '-shm']) rmSync(path.join(dataDir, `journal.sqlite${suffix}`), { force: true });
    writeFileSync(path.join(dataDir, 'journal.sqlite'), files.get('journal.sqlite')!);
    const shots = path.join(dataDir, 'screenshots');
    rmSync(shots, { recursive: true, force: true });
    mkdirSync(shots, { recursive: true });
    for (const [name, data] of files) if (name.startsWith('screenshots/')) writeFileSync(path.join(dataDir, name), data);
    const s = files.get('settings.json');
    if (s) settings.restorePortable(JSON.parse(s.toString('utf8')));
  }

  /** Once a day, saves a backup to the chosen folder and keeps the latest two weeks of them. */
  autoBackup(today: string): string | null {
    const folder = this.settings.backupFolder;
    if (!folder || this.settings.lastAutoBackup === today) return null;
    const file = path.join(folder, `${AUTO_PREFIX}${today}.moonbackup`);
    this.write(file);
    this.settings.lastAutoBackup = today;
    const old = safeList(folder).filter((f) => f.startsWith(AUTO_PREFIX) && f.endsWith('.moonbackup')).sort().reverse().slice(KEEP_AUTO);
    for (const f of old) rmSync(path.join(folder, f), { force: true });
    return file;
  }

  /** The newest automatic backup in the folder, if any. */
  latestAuto(): { file: string; when: string } | null {
    const folder = this.settings.backupFolder;
    if (!folder) return null;
    const files = safeList(folder).filter((f) => f.startsWith(AUTO_PREFIX) && f.endsWith('.moonbackup')).sort();
    const last = files[files.length - 1];
    return last ? { file: path.join(folder, last), when: statSync(path.join(folder, last)).mtime.toISOString() } : null;
  }
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
