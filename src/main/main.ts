// Electron main process: owns the window, the database and file access.

import { app, BrowserWindow, dialog, ipcMain, safeStorage } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseTosStatement } from '../core/tosCsv';
import { buildTrades, summarizeTrades } from '../core/trades';
import type { MistakeTag, PriceLevel, Setup, TradeJournal } from '../core/types';
import type { ImportResult, JournalData, TradeChart } from '../shared/api';
import { AlpacaClient } from '../core/alpaca';
import type { Goals } from '../core/goals';
import { BrokerSync } from './brokerSync';
import { JournalDb } from './db';
import { moveDataFromOldName } from './migrate';
import { buildTradeChart, levelOptionPrices } from './market';
import { Settings } from './settings';

let db: JournalDb;
let settings: Settings;
let brokers: BrokerSync;

function importFile(file: string): ImportResult {
  const { fills, skipped, unmatchedFees } = parseTosStatement(readFileSync(file, 'utf8'));
  const added = db.addFills(fills);
  return { file: path.basename(file), found: fills.length, added, duplicates: fills.length - added, skipped: skipped.length, unmatchedFees };
}

function journalData(): JournalData {
  const journals = db.tradeJournals();
  const trades = buildTrades(db.allFills()).map((t) => ({ ...t, journal: journals.get(t.id) }));
  return { trades, summary: summarizeTrades(trades), setups: db.setups(), mistakes: db.mistakeTags(), dayNotes: db.dayNotes() };
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#131722',
    title: 'Moon Journal',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  await win.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Used for automated screenshots: TJ_SCREENSHOT=out.png saves the window once it has drawn, then quits.
  const shot = process.env.TJ_SCREENSHOT;
  if (shot) {
    // TJ_SCREENSHOT_JS runs first, e.g. to click a trade before capturing.
    if (process.env.TJ_SCREENSHOT_JS) setTimeout(() => win.webContents.executeJavaScript(process.env.TJ_SCREENSHOT_JS!), 1000);
    // TJ_SCREENSHOT_CLICKS='[{"at":3000,"x":500,"y":400}]' sends real mouse clicks at window coordinates.
    for (const c of JSON.parse(process.env.TJ_SCREENSHOT_CLICKS ?? '[]') as { at: number; x: number; y: number; toY?: number }[]) {
      setTimeout(() => {
        win.webContents.sendInputEvent({ type: 'mouseMove', x: c.x, y: c.y });
        win.webContents.sendInputEvent({ type: 'mouseDown', x: c.x, y: c.y, button: 'left', clickCount: 1 });
        // With toY, drag vertically before letting go.
        if (c.toY !== undefined) for (let i = 1; i <= 10; i++) win.webContents.sendInputEvent({ type: 'mouseMove', x: c.x, y: Math.round(c.y + ((c.toY - c.y) * i) / 10) });
        win.webContents.sendInputEvent({ type: 'mouseUp', x: c.x, y: c.toY ?? c.y, button: 'left', clickCount: 1 });
      }, c.at);
    }
    setTimeout(async () => {
      const image = await win.webContents.capturePage();
      writeFileSync(shot, image.toPNG());
      app.quit();
    }, Number(process.env.TJ_SCREENSHOT_DELAY ?? 2500));
  }
}

moveDataFromOldName(app.getPath('appData'), app.getPath('userData'));

app.whenReady().then(async () => {
  // Headless test runs on Linux have no keyring to encrypt saved secrets with.
  if (process.platform === 'linux' && process.env.TJ_SCREENSHOT) safeStorage.setUsePlainTextEncryption(true);
  db = new JournalDb(path.join(app.getPath('userData'), 'journal.sqlite'));
  settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));
  brokers = new BrokerSync(db, settings);
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

  ipcMain.handle('journal:saveTrade', (_event, tradeId: string, journal: TradeJournal) => db.saveTradeJournal(tradeId, journal));
  ipcMain.handle('journal:saveSetups', (_event, setups: Setup[]) => db.saveSetups(setups));
  ipcMain.handle('journal:saveMistakes', (_event, mistakes: MistakeTag[]) => db.saveMistakeTags(mistakes));
  ipcMain.handle('journal:saveDayNote', (_event, date: string, notes: string) => db.saveDayNote(date, notes));

  ipcMain.handle('market:tradeChart', async (_event, tradeId: string): Promise<TradeChart> => {
    const trade = buildTrades(db.allFills()).find((t) => t.id === tradeId);
    if (!trade) return { status: 'error', message: 'Trade not found.' };
    try {
      return await buildTradeChart(trade, db, settings);
    } catch (err) {
      return { status: 'error', message: (err as Error).message };
    }
  });

  ipcMain.handle('market:levelPrices', async (_event, tradeId: string, stops: PriceLevel[], targets: PriceLevel[]) => {
    const trade = buildTrades(db.allFills()).find((t) => t.id === tradeId);
    if (!trade) return null;
    try {
      return await levelOptionPrices(trade, stops, targets, db, settings);
    } catch {
      return null;
    }
  });

  ipcMain.handle('settings:get', () => ({
    timeZone: settings.timeZone, hasAlpacaKey: settings.alpacaCredentials() !== null, tradeColumns: settings.tradeColumns, goals: settings.goals,
    reportsLayout: settings.reportsLayout,
  }));
  ipcMain.handle('settings:setReportsLayout', (_event, layout: { columns: string[][]; collapsed: string[] }) => { settings.reportsLayout = layout; });
  ipcMain.handle('broker:status', () => brokers.status());
  ipcMain.handle('broker:accounts', () => brokers.accounts());
  ipcMain.handle('broker:connect', async (event) => {
    const connected = await brokers.connect(BrowserWindow.fromWebContents(event.sender));
    return connected ? brokers.sync() : null;
  });
  ipcMain.handle('broker:sync', () => brokers.sync());
  ipcMain.handle('broker:syncIfDue', () => (brokers.dueToday() ? brokers.sync() : null));
  ipcMain.handle('broker:disconnect', () => brokers.disconnect());
  ipcMain.handle('broker:setRelayUrl', (_event, url: string) => { settings.relayUrl = url; });
  ipcMain.handle('settings:setGoals', (_event, goals: Goals) => { settings.goals = goals; });
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
