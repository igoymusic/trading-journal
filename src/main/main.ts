// Electron main process: owns the window, the database and file access.

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseTosStatement } from '../core/tosCsv';
import { buildTrades, summarizeTrades } from '../core/trades';
import type { ImportResult, JournalData } from '../shared/api';
import { JournalDb } from './db';

let db: JournalDb;

function importFile(file: string): ImportResult {
  const { fills, skipped, unmatchedFees } = parseTosStatement(readFileSync(file, 'utf8'));
  const added = db.addFills(fills);
  return { file: path.basename(file), found: fills.length, added, duplicates: fills.length - added, skipped: skipped.length, unmatchedFees };
}

function journalData(): JournalData {
  const trades = buildTrades(db.allFills());
  return { trades, summary: summarizeTrades(trades) };
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#131722',
    title: 'Trading Journal',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  await win.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Used for automated screenshots: TJ_SCREENSHOT=out.png saves the window once it has drawn, then quits.
  const shot = process.env.TJ_SCREENSHOT;
  if (shot) {
    setTimeout(async () => {
      const image = await win.webContents.capturePage();
      writeFileSync(shot, image.toPNG());
      app.quit();
    }, 2500);
  }
}

app.whenReady().then(async () => {
  db = new JournalDb(path.join(app.getPath('userData'), 'journal.sqlite'));
  if (process.env.TJ_IMPORT_FILE) importFile(process.env.TJ_IMPORT_FILE);

  ipcMain.handle('journal:get', () => journalData());
  ipcMain.handle('journal:importTos', async (event): Promise<ImportResult | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)!;
    const pick = await dialog.showOpenDialog(win, {
      title: 'Import thinkorswim Account Statement',
      filters: [{ name: 'CSV files', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    if (pick.canceled || !pick.filePaths[0]) return null;
    return importFile(pick.filePaths[0]);
  });

  await createWindow();
});

app.on('window-all-closed', () => {
  db?.close();
  app.quit();
});
