// Exposes a small, safe API to the screens; they never touch files or the database directly.

import { contextBridge, ipcRenderer } from 'electron';
import type { JournalApi } from '../shared/api';

const api: JournalApi = {
  getJournal: () => ipcRenderer.invoke('journal:get'),
  importThinkorswim: () => ipcRenderer.invoke('journal:importTos'),
};

contextBridge.exposeInMainWorld('journal', api);
