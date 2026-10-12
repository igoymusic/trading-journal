// The app was first released as "trading-journal". When it was renamed to Moon Journal, its data
// folder name changed with it, so on first launch we bring the old journal and settings across.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const OLD_FOLDER = 'trading-journal';
const DATA_FILES = /^(journal\.sqlite(-wal|-shm)?|settings\.json)$/;

export function moveDataFromOldName(appDataDir: string, userDataDir: string) {
  const oldDir = path.join(appDataDir, OLD_FOLDER);
  if (path.resolve(oldDir) === path.resolve(userDataDir)) return;
  if (!existsSync(path.join(oldDir, 'journal.sqlite'))) return;
  if (existsSync(path.join(userDataDir, 'journal.sqlite'))) return;
  mkdirSync(userDataDir, { recursive: true });
  for (const file of readdirSync(oldDir)) {
    if (DATA_FILES.test(file)) copyFileSync(path.join(oldDir, file), path.join(userDataDir, file));
  }
}
