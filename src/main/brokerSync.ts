// Broker sync through SnapTrade, by way of the relay that holds the SnapTrade key. Brings in
// option fills from every connected account, skipping ones already in the journal.

import { writeFileSync } from 'node:fs';
import { BrowserWindow, safeStorage } from 'electron';
import { activitiesToFills, type StActivity, type StOrder } from '../core/snaptrade';
import type { BrokerAccount, SyncResult } from '../shared/api';
import type { JournalDb } from './db';
import type { SchwabSync } from './schwab';
import type { Settings } from './settings';

/** Where the broker sign-in page sends you when you're done; the window closes when it gets there. */
const DONE_URL = 'https://moonjournal.invalid/connected';

/** Re-reads this many days before the last sync, in case the broker filled in late activity. */
const OVERLAP_DAYS = 7;
/** How far back the broker's order list (with exact fill times) goes. */
const ORDER_DAYS = 90;

export class BrokerSync {
  /** Where a short, anonymized sample of the last sync is written, to diagnose broker data. */
  debugFile?: string;
  /** Your own Schwab connection, when set up: gives exact fill times. */
  schwab?: SchwabSync;

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

  /** Pulls fills from SnapTrade, then (if signed in) times and trades from Schwab directly. */
  async sync(): Promise<SyncResult> {
    const snap = this.settings.snaptradeUser();
    const result: SyncResult = snap ? await this.syncSnaptrade() : { added: 0, accounts: 0, errors: [] };
    if (this.schwab?.status().signedIn) {
      try {
        const s = await this.schwab.sync({ addNew: !snap });
        result.added += s.added;
        result.retimed = s.retimed;
        result.errors.push(...s.errors);
        if (!snap) result.accounts = s.accounts;
      } catch (err) {
        result.errors.push(`Schwab: ${(err as Error).message}`);
      }
    }
    return result;
  }

  private async syncSnaptrade(): Promise<SyncResult> {
    const accounts = await this.accounts();
    const last = this.settings.lastBrokerSync;
    // Re-read at least the last 90 days: that's how far back orders give exact fill times.
    const since = last ? Math.min(Date.parse(last) - OVERLAP_DAYS * 86_400_000, Date.now() - ORDER_DAYS * 86_400_000) : undefined;
    const startDate = since === undefined ? undefined : new Date(since).toISOString().slice(0, 10);
    let added = 0;
    const errors: string[] = [];
    const debug: unknown[] = [];
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
        let ordersError: string | undefined;
        const orders = await this.relay<StOrder[]>('/orders', { accountId: account.id, days: ORDER_DAYS })
          .catch((err) => { ordersError = (err as Error).message; return []; });
        debug.push({
          account: account.institution,
          activities: activities.length,
          activitySample: activities.filter((a) => a.option_symbol).slice(0, 3).map(sample),
          ordersError,
          orders: Array.isArray(orders) ? orders.length : typeof orders,
          orderSample: (Array.isArray(orders) ? orders : []).slice(0, 3).map(sample),
        });
        const fills = activitiesToFills(activities, Array.isArray(orders) ? orders : [], {
          accountId: account.id, accountName: account.name, timeZone: this.settings.timeZone, existing: this.db.allFills(),
        });
        added += this.db.addFills(fills);
      } catch (err) {
        errors.push(`${account.name}: ${(err as Error).message}`);
      }
    }
    if (!errors.length || added) this.settings.lastBrokerSync = new Date().toISOString();
    if (this.debugFile) {
      try { writeFileSync(this.debugFile, JSON.stringify({ at: new Date().toISOString(), accounts: debug }, null, 2)); } catch { /* best effort */ }
    }
    return { added, accounts: accounts.length, errors };
  }

  /** True when sync hasn't run yet today (in the journal's time zone). */
  dueToday(): boolean {
    const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: this.settings.timeZone });
    const due = (last?: string) => !last || day(last) !== day(new Date().toISOString());
    return (!!this.settings.snaptradeUser() && due(this.settings.lastBrokerSync))
      || (!!this.schwab?.status().signedIn && due(this.settings.schwabLastSync));
  }

  /** Removes the SnapTrade sign-in (and its broker links) and forgets it on this computer. */
  async disconnect() {
    await this.relay('/unregister');
    this.settings.setSnaptradeUser(null);
  }
}

/** A copy of a broker record with ids and account details removed, for the sync sample file. */
function sample(record: unknown): unknown {
  const drop = /^(id|account|account_id|brokerage_order_id|number|institution|description|external_reference_id)$/i;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).filter(([k]) => !drop.test(k)).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(record);
}
