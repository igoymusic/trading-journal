// Broker sync through SnapTrade, by way of the relay that holds the SnapTrade key. Brings in
// option fills from every connected account, skipping ones already in the journal.

import { BrowserWindow, safeStorage } from 'electron';
import { activitiesToFills, type StActivity, type StOrder } from '../core/snaptrade';
import type { BrokerAccount, SyncResult } from '../shared/api';
import type { JournalDb } from './db';
import type { Settings } from './settings';

/** Where the broker sign-in page sends you when you're done; the window closes when it gets there. */
const DONE_URL = 'https://moonjournal.invalid/connected';

/** Re-reads this many days before the last sync, in case the broker filled in late activity. */
const OVERLAP_DAYS = 7;

export class BrokerSync {
  constructor(private db: JournalDb, private settings: Settings, private fetchFn: typeof fetch = fetch) {}

  private async relay<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    const base = this.settings.relayUrl.replace(/\/+$/, '');
    if (!base) throw new Error('Broker sync isn\'t set up yet: the relay address is missing (Settings, Brokers).');
    const user = path === '/register' ? {} : this.settings.snaptradeUser();
    if (!user) throw new Error('No broker is connected yet.');
    const res = await this.fetchFn(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...user, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || data?.detail || `The relay answered ${res.status}.`);
    return data as T;
  }

  status() {
    return {
      relayUrl: this.settings.relayUrl,
      connected: this.settings.snaptradeUser() !== null,
      lastSync: this.settings.lastBrokerSync,
    };
  }

  async accounts(): Promise<BrokerAccount[]> {
    const list = await this.relay<any[]>('/accounts');
    return list.map((a) => ({
      id: a.id,
      name: [a.institution_name, a.name || a.number].filter(Boolean).join(' · '),
      institution: a.institution_name ?? '',
    }));
  }

  /** Signs this computer up with SnapTrade (once), then opens the broker sign-in page. */
  async connect(parent: BrowserWindow | null): Promise<boolean> {
    if (!this.settings.snaptradeUser()) {
      // Check first, so a sign-up isn't wasted on a secret this computer can't keep.
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer.');
      const user = await this.relay<{ userId: string; userSecret: string }>('/register');
      this.settings.setSnaptradeUser(user);
    }
    const { redirectURI } = await this.relay<{ redirectURI: string }>('/login', { customRedirect: DONE_URL });
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        parent: parent ?? undefined, width: 520, height: 760, title: 'Connect your broker', autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, sandbox: true },
      });
      let done = false;
      const finish = (connected: boolean) => {
        if (done) return;
        done = true;
        resolve(connected);
        if (!win.isDestroyed()) win.close();
      };
      const watch = (_e: unknown, url: string) => { if (url.startsWith(DONE_URL)) finish(true); };
      win.webContents.on('will-navigate', watch);
      win.webContents.on('will-redirect', watch);
      win.webContents.on('did-navigate', watch);
      // Some brokers sign in through a pop-up; let those open inside the app too.
      win.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { parent: win, autoHideMenuBar: true } }));
      win.on('closed', () => finish(false));
      win.loadURL(redirectURI);
    });
  }

  /** Pulls fills from every connected account. */
  async sync(): Promise<SyncResult> {
    const accounts = await this.accounts();
    const last = this.settings.lastBrokerSync;
    const startDate = last ? new Date(Date.parse(last) - OVERLAP_DAYS * 86_400_000).toISOString().slice(0, 10) : undefined;
    let added = 0;
    const errors: string[] = [];
    for (const account of accounts) {
      try {
        const activities: StActivity[] = [];
        for (let offset = 0; ; offset += 1000) {
          const page = await this.relay<any>('/activities', { accountId: account.id, startDate, offset });
          const rows: StActivity[] = Array.isArray(page) ? page : page.data ?? [];
          activities.push(...rows);
          const total = page?.pagination?.total;
          if (rows.length < 1000 || (total !== undefined && activities.length >= total)) break;
        }
        // Orders give exact fill times for the last 90 days; not every broker reports them.
        const orders = await this.relay<StOrder[]>('/orders', { accountId: account.id, days: 90 }).catch(() => []);
        const fills = activitiesToFills(activities, Array.isArray(orders) ? orders : [], {
          accountId: account.id, accountName: account.name, timeZone: this.settings.timeZone, existing: this.db.allFills(),
        });
        added += this.db.addFills(fills);
      } catch (err) {
        errors.push(`${account.name}: ${(err as Error).message}`);
      }
    }
    if (!errors.length || added) this.settings.lastBrokerSync = new Date().toISOString();
    return { added, accounts: accounts.length, errors };
  }

  /** True when sync hasn't run yet today (in the journal's time zone). */
  dueToday(): boolean {
    if (!this.settings.snaptradeUser()) return false;
    const last = this.settings.lastBrokerSync;
    if (!last) return true;
    const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: this.settings.timeZone });
    return day(last) !== day(new Date().toISOString());
  }

  /** Removes the SnapTrade sign-in (and its broker links) and forgets it on this computer. */
  async disconnect() {
    await this.relay('/unregister');
    this.settings.setSnaptradeUser(null);
  }
}
