// Electron main process: owns the window, the database and file access.

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseTosStatement } from '../core/tosCsv';
import { buildTrades, summarizeTrades } from '../core/trades';
import type { ImportResult, JournalData, TradeChart } from '../shared/api';
import { AlpacaClient } from '../core/alpaca';
import { JournalDb } from './db';
import { buildTradeChart } from './market';
import { Settings } from './settings';

let db: JournalDb;
let settings: Settings;

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
    // TJ_SCREENSHOT_JS runs first, e.g. to click a trade before capturing.
    if (process.env.TJ_SCREENSHOT_JS) setTimeout(() => win.webContents.executeJavaScript(process.env.TJ_SCREENSHOT_JS!), 1000);
    setTimeout(async () => {
      const image = await win.webContents.capturePage();
      writeFileSync(shot, image.toPNG());
      app.quit();
    }, Number(process.env.TJ_SCREENSHOT_DELAY ?? 2500));
  }
}

app.whenReady().then(async () => {
  db = new JournalDb(path.join(app.getPath('userData'), 'journal.sqlite'));
  settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));
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

  ipcMain.handle('market:tradeChart', async (_event, tradeId: string): Promise<TradeChart> => {
    const trade = buildTrades(db.allFills()).find((t) => t.id === tradeId);
    if (!trade) return { status: 'error', message: 'Trade not found.' };
    try {
      return await buildTradeChart(trade, db, settings);
    } catch (err) {
      return { status: 'error', message: (err as Error).message };
    }
  });

  ipcMain.handle('settings:get', () => ({ timeZone: settings.timeZone, hasAlpacaKey: settings.alpacaCredentials() !== null, tradeColumns: settings.tradeColumns }));
  ipcMain.handle('settings:setTimeZone', (_event, tz: string) => { settings.timeZone = tz; });
  ipcMain.handle('settings:setTradeColumns', (_event, ids: string[] | null) => { settings.tradeColumns = ids ?? undefined; });
  ipcMain.handle('settings:saveAlpaca', async (_event, keys: { keyId: string; secretKey: string } | null) => {
    if (!keys) {
      settings.setAlpacaCredentials(null);
      return { ok: true, message: 'Alpaca keys removed.' };
    }
    try {
      // A cheap request to prove the keys work before saving them.
      const probe = new AlpacaClient(keys, undefined, process.env.TJ_ALPACA_BASE_URL || undefined);
      const day = Date.now() - 7 * 86400_000;
      await probe.minuteBars('SPY', day, day + 60_000);
      settings.setAlpacaCredentials(keys);
      return { ok: true, message: 'Connected to Alpaca. Your keys are saved.' };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  });

  await createWindow();
});

app.on('window-all-closed', () => {
  db?.close();
  app.quit();
});
