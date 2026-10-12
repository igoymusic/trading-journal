// Exposes a small, safe API to the screens; they never touch files, keys or the database directly.

import { contextBridge, ipcRenderer } from 'electron';
import type { JournalApi } from '../shared/api';

const api: JournalApi = {
  getJournal: () => ipcRenderer.invoke('journal:get'),
  importThinkorswim: () => ipcRenderer.invoke('journal:importTos'),
  getTradeChart: (tradeId) => ipcRenderer.invoke('market:tradeChart', tradeId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveAlpacaKeys: (keys) => ipcRenderer.invoke('settings:saveAlpaca', keys),
  setTimeZone: (tz) => ipcRenderer.invoke('settings:setTimeZone', tz),
};

contextBridge.exposeInMainWorld('journal', api);
