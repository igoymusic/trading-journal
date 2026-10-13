// Exposes a small, safe API to the screens; they never touch files, keys or the database directly.

import { contextBridge, ipcRenderer } from 'electron';
import type { JournalApi } from '../shared/api';

const api: JournalApi = {
  getJournal: () => ipcRenderer.invoke('journal:get'),
  importThinkorswim: () => ipcRenderer.invoke('journal:importTos'),
  getDayChart: (date, underlying) => ipcRenderer.invoke('market:dayChart', date, underlying),
  getTradeChart: (tradeId) => ipcRenderer.invoke('market:tradeChart', tradeId),
  getLevelPrices: (tradeId, stops, targets) => ipcRenderer.invoke('market:levelPrices', tradeId, stops, targets),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveAlpacaKeys: (keys) => ipcRenderer.invoke('settings:saveAlpaca', keys),
  setTimeZone: (tz) => ipcRenderer.invoke('settings:setTimeZone', tz),
  setTradeColumns: (ids) => ipcRenderer.invoke('settings:setTradeColumns', ids),
  setGoals: (goals) => ipcRenderer.invoke('settings:setGoals', goals),
  removeImported: () => ipcRenderer.invoke('journal:removeImported'),
  accountFillCounts: () => ipcRenderer.invoke('journal:accountFillCounts'),
  removeAccount: (account) => ipcRenderer.invoke('journal:removeAccount', account),
  removeSynced: () => ipcRenderer.invoke('journal:removeSynced'),
  brokerStatus: () => ipcRenderer.invoke('broker:status'),
  brokerAccounts: () => ipcRenderer.invoke('broker:accounts'),
  connectBroker: () => ipcRenderer.invoke('broker:connect'),
  syncBrokers: () => ipcRenderer.invoke('broker:sync'),
  syncBrokersIfDue: () => ipcRenderer.invoke('broker:syncIfDue'),
  disconnectBrokers: () => ipcRenderer.invoke('broker:disconnect'),
  setRelayUrl: (url) => ipcRenderer.invoke('broker:setRelayUrl', url),
  schwabStatus: () => ipcRenderer.invoke('schwab:status'),
  saveSchwabApp: (app) => ipcRenderer.invoke('schwab:saveApp', app),
  connectSchwab: () => ipcRenderer.invoke('schwab:connect'),
  disconnectSchwab: () => ipcRenderer.invoke('schwab:disconnect'),
  setHiddenAccounts: (names) => ipcRenderer.invoke('settings:setHiddenAccounts', names),
  setReportsLayout: (layout) => ipcRenderer.invoke('settings:setReportsLayout', layout),
  saveTradeJournal: (tradeId, journal) => ipcRenderer.invoke('journal:saveTrade', tradeId, journal),
  saveSetups: (setups) => ipcRenderer.invoke('journal:saveSetups', setups),
  saveMistakes: (mistakes) => ipcRenderer.invoke('journal:saveMistakes', mistakes),
  saveDayNote: (date, notes) => ipcRenderer.invoke('journal:saveDayNote', date, notes),
};

contextBridge.exposeInMainWorld('journal', api);
