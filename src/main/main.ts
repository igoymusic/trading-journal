// Electron main process: owns the window, the database and file access.

import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, shell } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseTosStatement } from '../core/tosCsv';
import { addMerge, buildTrades, removeMerge, summarizeTrades, type TradeMerges } from '../core/trades';
import type { MistakeTag, PriceLevel, Setup, TradeJournal } from '../core/types';
import type { ImportResult, JournalData, LabelOffset, TradeChart } from '../shared/api';
import type { MarkerStyles } from '../core/markerStyles';
import type { Indicator } from '../core/indicators';
import { AlpacaClient } from '../core/alpaca';
import type { Goals } from '../core/goals';
import { dayChartTrade } from '../core/dayChart';
import { BrokerSync } from './brokerSync';
import { SchwabSync } from './schwab';
import type { SchwabSlot } from './settings';
import { JournalDb } from './db';
import { moveDataFromOldName } from './migrate';
import { fetchWithTimeout } from './fetchTimeout';
import { buildTradeChart, etfMinuteBars, historyDailyBars, historyMinuteBars, levelOptionPrices } from './market';
import { Settings } from './settings';
import { Screenshots } from './screenshots';
import { Backups } from './backup';
import { nyDay } from '../core/drawings';
import type { Drawing } from '../core/drawings';

let db: JournalDb;
let settings: Settings;
let brokers: BrokerSync;
let schwab: SchwabSync;
let schwabData: SchwabSync;
let shots: Screenshots;
let backups: Backups;

function importFile(file: string): ImportResult {
  const { fills, skipped, unmatchedFees } = parseTosStatement(readFileSync(file, 'utf8'));
  const added = db.addFills(fills);
  return { file: path.basename(file), found: fills.length, added, duplicates: fills.length - added, skipped: skipped.length, unmatchedFees };
}

/** Trades you combined by hand, saved in the journal database. */
function tradeMerges(): TradeMerges {
  try { return JSON.parse(db.getMeta('trade-merges') ?? '[]'); } catch { return []; }
}

function allTrades() {
  return buildTrades(db.allFills(), tradeMerges());
}

function journalData(): JournalData {
  const journals = db.tradeJournals();
  const trades = allTrades().map((t) => ({ ...t, journal: journals.get(t.id) }));
  return { trades, summary: summarizeTrades(trades), setups: db.setups(), mistakes: db.mistakeTags(), positives: db.positiveTags(), dayNotes: db.dayNotes() };
}

/** Width and height that fit all of Home, or as much as the screen allows. */
const HOME_SIZE = { width: 1440, height: 1020 };

/**
 * Where the window opens: where it was when you last closed it, if that's still on a screen;
 * otherwise centered, just big enough for Home.
 */
function startBounds(): Electron.Rectangle & { maximized?: boolean } {
  const saved = settings.windowBounds;
  if (saved) {
    const area = screen.getDisplayMatching(saved).workArea;
    const visible = saved.x < area.x + area.width - 100 && saved.x + saved.width > area.x + 100 && saved.y >= area.y - 10 && saved.y < area.y + area.height - 100;
    if (visible) return saved;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const width = Math.min(HOME_SIZE.width, area.width);
  const height = Math.min(HOME_SIZE.height, area.height);
  return { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height };
}

async function createWindow() {
  const { maximized, ...bounds } = startBounds();
  const win = new BrowserWindow({
    ...bounds,
    show: false,
    backgroundColor: '#131722',
    title: 'Moon Journal',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  if (maximized) win.maximize();
  win.show();
  // Remember the size and place for next time.
  win.on('close', () => { settings.windowBounds = { ...win.getNormalBounds(), maximized: win.isMaximized() }; });
  // Help links (like Alpaca's sign-up page) open in the normal web browser, and only those sites.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/([a-z0-9-]+\.)*(alpaca\.markets|snaptrade\.com)\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
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

/** Index charts come from the Market Data app when it's signed in, else the trading one (if it has market data). */
function chartSource() {
  return schwabData?.status().signedIn ? schwabData : schwab;
}

// Every request the app makes gives up after 30 seconds rather than hanging a screen forever.
globalThis.fetch = fetchWithTimeout(globalThis.fetch, 30_000);

moveDataFromOldName(app.getPath('appData'), app.getPath('userData'));

app.whenReady().then(async () => {
  // Headless test runs on Linux have no keyring to encrypt saved secrets with.
  if (process.platform === 'linux' && process.env.TJ_SCREENSHOT) safeStorage.setUsePlainTextEncryption(true);
  db = new JournalDb(path.join(app.getPath('userData'), 'journal.sqlite'));
  settings = new Settings(path.join(app.getPath('userData'), 'settings.json'));
  brokers = new BrokerSync(db, settings);
  schwab = new SchwabSync(db, settings, 'trading');
  schwabData = new SchwabSync(db, settings, 'marketData');
  brokers.schwab = schwab;
  backups = new Backups(db, settings, app.getPath('userData'));
  shots = new Screenshots(db, path.join(app.getPath('userData'), 'screenshots'), path.join(app.getPath('userData'), 'clipboard-sample.json'));
  brokers.debugFile = path.join(app.getPath('userData'), 'sync-sample.json');
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
  ipcMain.handle('journal:savePositives', (_event, positives: MistakeTag[]) => db.savePositiveTags(positives));
  ipcMain.handle('trades:combine', (_event, ids: string[]) => {
    db.setMeta('trade-merges', JSON.stringify(addMerge(tradeMerges(), ids, allTrades())));
    return journalData();
  });
  ipcMain.handle('trades:split', (_event, id: string) => {
    db.setMeta('trade-merges', JSON.stringify(removeMerge(tradeMerges(), id, allTrades())));
    return journalData();
  });
  ipcMain.handle('journal:saveDayNote', (_event, date: string, notes: string) => db.saveDayNote(date, notes));

  ipcMain.handle('drawings:get', (_event, symbol: string, days: string[]) => db.drawings(symbol, days));
  ipcMain.handle('drawings:put', (_event, symbol: string, drawing: Drawing) => db.putDrawing(symbol, drawing));
  ipcMain.handle('drawings:putMany', (_event, symbol: string, drawings: Drawing[]) => db.putDrawings(symbol, drawings));
  ipcMain.handle('drawings:delete', (_event, symbol: string, id: string) => db.deleteDrawing(symbol, id));
  ipcMain.handle('markers:labels', (_event, ids: string[]) => db.markerLabels(ids));
  ipcMain.handle('markers:setLabel', (_event, id: string, offset: LabelOffset | null) => db.setMarkerLabel(id, offset));
  ipcMain.handle('clipboard:readPaste', () => shots.readPaste());
  ipcMain.handle('shots:list', (_event, tradeId: string) => shots.list(tradeId));
  ipcMain.handle('shots:counts', () => db.tradeImageCounts());
  ipcMain.handle('shots:paste', (_event, tradeId: string) => shots.addFromClipboard(tradeId));
  ipcMain.handle('shots:pick', async (event, tradeId: string) => {
    const pick = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
      title: 'Add screenshots',
      filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg'] }],
      properties: ['openFile', 'multiSelections'],
    });
    return pick.canceled ? 0 : shots.addFiles(tradeId, pick.filePaths);
  });
  ipcMain.handle('shots:addData', (_event, tradeId: string, data: Uint8Array) => shots.addData(tradeId, data));
  ipcMain.handle('shots:caption', (_event, id: string, caption: string) => db.setImageCaption(id, caption));
  ipcMain.handle('shots:remove', (_event, id: string) => shots.remove(id));

  ipcMain.handle('market:dayChart', async (_event, date: string, underlying: string): Promise<TradeChart> => {
    const day = dayChartTrade(allTrades(), date, underlying);
    if (!day) return { status: 'error', message: 'No trades on this day.' };
    try {
      return await buildTradeChart(day.trade, db, settings, undefined, chartSource());
    } catch (err) {
      return { status: 'error', message: (err as Error).message };
    }
  });
  ipcMain.handle('market:tradeChart', async (_event, tradeId: string): Promise<TradeChart> => {
    const trade = allTrades().find((t) => t.id === tradeId);
    if (!trade) return { status: 'error', message: 'Trade not found.' };
    try {
      return await buildTradeChart(trade, db, settings, undefined, chartSource());
    } catch (err) {
      return { status: 'error', message: (err as Error).message };
    }
  });

  ipcMain.handle('market:levelPrices', async (_event, tradeId: string, stops: PriceLevel[], targets: PriceLevel[]) => {
    const trade = allTrades().find((t) => t.id === tradeId);
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
    hiddenAccounts: settings.hiddenAccounts,
    colors: settings.colors,
    markerStyles: settings.markerStyles,
    optionPriceDisplay: settings.optionPriceDisplay,
    indicators: settings.indicators,
  }));
  ipcMain.handle('settings:setIndicators', (_event, list: Indicator[]) => { settings.indicators = list; });
  ipcMain.handle('market:historyMinutes', (_event, underlying: string, beforeDay: string, minutes: number, count: number, fromSchwab: boolean) =>
    historyMinuteBars(underlying, beforeDay, minutes, Math.min(count, 5000), fromSchwab, db, settings, chartSource()).catch(() => []));
  ipcMain.handle('market:etfMinutes', (_event, symbol: string, days: string[]) => etfMinuteBars(symbol, days, db, settings).catch(() => []));
  ipcMain.handle('market:historyDays', (_event, underlying: string, beforeDay: string, count: number, fromSchwab: boolean) =>
    historyDailyBars(underlying, beforeDay, Math.min(count, 2500), fromSchwab, db, settings, chartSource()).catch(() => []));
  ipcMain.handle('settings:setOptionPriceDisplay', (_event, mode: 'quote' | 'contract') => { settings.optionPriceDisplay = mode; });
  ipcMain.handle('settings:setMarkerStyles', (_event, styles: MarkerStyles | null) => { settings.markerStyles = styles ?? undefined; });
  ipcMain.handle('settings:setColors', (_event, colors: Record<string, string> | null) => { settings.colors = colors ?? undefined; });
  ipcMain.handle('settings:setHiddenAccounts', (_event, names: string[]) => { settings.hiddenAccounts = names; });
  ipcMain.handle('settings:setReportsLayout', (_event, layout: { columns: string[][]; collapsed: string[]; charts?: string[] }) => { settings.reportsLayout = layout; });
  // Removes CSV-imported fills, then re-reads the brokers' full history, since sync skipped
  // everything the CSV already had.
  ipcMain.handle('journal:removeImported', async () => {
    const removed = db.removeFills('thinkorswim');
    settings.lastBrokerSync = undefined;
    settings.schwabLastSync = undefined;
    const sync = brokers.status().connected || schwab.status().signedIn ? await brokers.sync().catch(() => null) : null;
    return { removed, sync };
  });
  ipcMain.handle('journal:accountFillCounts', () => db.accountFillCounts());
  ipcMain.handle('journal:removeAccount', (_event, account: string | null) => db.removeAccountFills(account));
  ipcMain.handle('journal:removeSynced', () => {
    const removed = db.removeFills('snaptrade') + db.removeFills('schwab');
    settings.lastBrokerSync = undefined;
    settings.schwabLastSync = undefined;
    return removed;
  });
  ipcMain.handle('broker:status', () => brokers.status());
  ipcMain.handle('broker:accounts', () => brokers.accounts());
  ipcMain.handle('broker:connect', async (event) => {
    const connected = await brokers.connect(BrowserWindow.fromWebContents(event.sender));
    return connected ? brokers.sync() : null;
  });
  ipcMain.handle('broker:sync', () => brokers.sync());
  ipcMain.handle('broker:syncIfDue', () => (brokers.dueToday() ? brokers.sync() : null));
  ipcMain.handle('broker:disconnect', () => brokers.disconnect());
  const slot = (s: SchwabSlot) => (s === 'marketData' ? schwabData : schwab);
  ipcMain.handle('schwab:status', (_event, s: SchwabSlot) => slot(s).status());
  ipcMain.handle('schwab:saveApp', (_event, s: SchwabSlot, app: { appKey: string; secret: string; callbackUrl: string } | null) => slot(s).saveApp(app));
  ipcMain.handle('schwab:connect', async (event, s: SchwabSlot) => {
    const connected = await slot(s).connect(BrowserWindow.fromWebContents(event.sender));
    if (!connected) return null;
    if (s === 'marketData') return { added: 0, accounts: 0, errors: [] };
    settings.schwabLastSync = undefined;
    return brokers.sync();
  });
  ipcMain.handle('schwab:disconnect', (_event, s: SchwabSlot) => slot(s).disconnect(true));
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

  ipcMain.handle('backup:status', () => backupStatus());
  ipcMain.handle('backup:save', async (event) => {
    const pick = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender)!, {
      title: 'Save a backup of Moon Journal',
      defaultPath: path.join(app.getPath('documents'), `Moon Journal backup ${nyDay(Date.now())}.moonbackup`),
      filters: [{ name: 'Moon Journal backup', extensions: ['moonbackup'] }],
    });
    if (pick.canceled || !pick.filePath) return null;
    return { file: pick.filePath, size: backups.write(pick.filePath) };
  });
  ipcMain.handle('backup:chooseFolder', async (event) => {
    const pick = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
      title: 'Pick a folder for daily backups (OneDrive or Google Drive keeps them off this computer)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (pick.canceled || !pick.filePaths[0]) return backupStatus();
    settings.backupFolder = pick.filePaths[0];
    settings.lastAutoBackup = undefined;
    backups.autoBackup(nyDay(Date.now()));
    return backupStatus();
  });
  ipcMain.handle('backup:stopAuto', () => { settings.backupFolder = undefined; return backupStatus(); });
  ipcMain.handle('backup:restore', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)!;
    const pick = await dialog.showOpenDialog(win, {
      title: 'Restore Moon Journal from a backup',
      defaultPath: settings.backupFolder ?? app.getPath('documents'),
      filters: [{ name: 'Moon Journal backup', extensions: ['moonbackup'] }],
      properties: ['openFile'],
    });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const file = pick.filePaths[0];
    const { manifest } = Backups.read(file);
    const shotCount = manifest.files.filter((f) => f.name.startsWith('screenshots/')).length;
    const answer = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Restore from backup',
      message: `Replace this computer's journal with the backup from ${new Date(manifest.created).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}?`,
      detail: `It has your trades, notes, tags, drawings, settings and ${shotCount} screenshot${shotCount === 1 ? '' : 's'}. `
        + 'What\'s here now is saved first in the Moon Journal data folder (backups\\before-restore), so nothing is lost. '
        + 'Your Alpaca key and broker sign-ins stay as they are on this computer. Moon Journal restarts when it\'s done.',
      buttons: ['Restore', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (answer.response !== 0) return null;
    const dataDir = app.getPath('userData');
    backups.write(path.join(dataDir, 'backups', `before-restore ${new Date().toISOString().replace(/[:.]/g, '-')}.moonbackup`));
    db.close();
    Backups.restore(file, dataDir, settings);
    app.relaunch();
    app.exit(0);
    return true;
  });

  await createWindow();

  // The daily backup, if a folder is set: now, and again if the app is still open the next day.
  const autoBackup = () => { try { backups.autoBackup(nyDay(Date.now())); } catch (err) { console.error('Automatic backup failed:', err); } };
  autoBackup();
  setInterval(autoBackup, 60 * 60_000);
});

function backupStatus() {
  return { folder: settings.backupFolder ?? null, latest: backups.latestAuto() };
}

app.on('window-all-closed', () => {
  db?.close();
  app.quit();
});
