// Schwab's own Trader API, through the developer app each person makes at developer.schwab.com.
// Used read-only: exact fill times (Schwab through SnapTrade only gives the day) and real index
// prices like $SPX. Schwab's sign-in lasts 7 days, after which it asks you to sign in again.

import { BrowserWindow, session } from 'electron';
import type { Bar } from '../core/alpaca';
import { type SchwabOrder, type SchwabTransaction, transactionsToFills } from '../core/schwab';
import type { SchwabStatus, SyncResult } from '../shared/api';
import type { JournalDb } from './db';
import type { SchwabApp, Settings } from './settings';

const API = process.env.TJ_SCHWAB_BASE_URL || 'https://api.schwabapi.com';
const DAY = 86_400_000;
/** Schwab's sign-in is good for 7 days. */
const SIGN_IN_DAYS = 7;
/** First sync reads this far back; Schwab keeps a year of transactions in reach. */
const HISTORY_DAYS = 365;
/** Re-reads this many days before the last sync. */
const OVERLAP_DAYS = 7;
/** Schwab's order list (the fallback for times) only reaches back 60 days. */
const ORDER_DAYS = 59;

export class SchwabSync {
  constructor(private db: JournalDb, private settings: Settings, private fetchFn: typeof fetch = fetch) {}

  status(): SchwabStatus {
    const app = this.settings.schwabApp();
    const signedInAt = this.settings.schwabSignedInAt;
    const expires = signedInAt ? Date.parse(signedInAt) + SIGN_IN_DAYS * DAY : undefined;
    return {
      configured: app !== null,
      callbackUrl: app?.callbackUrl,
      signedIn: this.settings.schwabTokens() !== null && !!expires && expires > Date.now(),
      signInExpires: expires ? new Date(expires).toISOString() : undefined,
      lastSync: this.settings.schwabLastSync,
    };
  }

  saveApp(app: SchwabApp | null) {
    if (app) {
      const url = new URL(app.callbackUrl.trim());
      if (url.protocol !== 'https:') throw new Error('The callback URL must start with https://, the same as on your Schwab app.');
    }
    this.settings.setSchwabApp(app);
  }

  /** Opens Schwab's sign-in page and keeps the tokens it hands back. */
  async connect(parent: BrowserWindow | null): Promise<boolean> {
    const app = this.settings.schwabApp();
    if (!app) throw new Error('Enter your Schwab App Key, Secret and Callback URL first.');
    const code = await this.signIn(app, parent);
    if (!code) return false;
    const tokens = await this.tokenRequest(app, { grant_type: 'authorization_code', code, redirect_uri: app.callbackUrl });
    this.settings.setSchwabTokens(tokens, true);
    return true;
  }

  private signIn(app: SchwabApp, parent: BrowserWindow | null): Promise<string | null> {
    const callback = new URL(app.callbackUrl);
    const isCallback = (url: string) => {
      try {
        const u = new URL(url);
        return u.origin === callback.origin && u.pathname.replace(/\/$/, '') === callback.pathname.replace(/\/$/, '');
      } catch {
        return false;
      }
    };
    // A private browser session, so signing in never touches anything else.
    const ses = session.fromPartition('schwab-sign-in');
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        parent: parent ?? undefined, width: 520, height: 760, title: 'Sign in to Schwab', autoHideMenuBar: true,
        webPreferences: { contextIsolation: true, sandbox: true, session: ses },
      });
      let done = false;
      const finish = (code: string | null) => {
        if (done) return;
        done = true;
        ses.webRequest.onBeforeRequest(null);
        resolve(code);
        if (!win.isDestroyed()) win.close();
      };
      const watch = (url: string) => {
        if (!isCallback(url)) return false;
        // URLSearchParams turns Schwab's "...%40" into the "...@" the token request needs.
        finish(new URL(url).searchParams.get('code'));
        return true;
      };
      // Catch the hand-back before it tries to load (nothing is listening at the callback address).
      ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: watch(details.url) }));
      win.webContents.on('will-redirect', (_e, url) => { watch(url); });
      win.webContents.on('will-navigate', (_e, url) => { watch(url); });
      win.on('closed', () => finish(null));
      const authorize = new URL(`${API}/v1/oauth/authorize`);
      authorize.searchParams.set('client_id', app.appKey);
      authorize.searchParams.set('redirect_uri', app.callbackUrl);
      win.loadURL(authorize.toString());
    });
  }

  private async tokenRequest(app: SchwabApp, form: Record<string, string>) {
    const res = await this.fetchFn(`${API}/v1/oauth/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${app.appKey}:${app.secret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(form).toString(),
    });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok || !data.access_token) {
      throw new Error(`Schwab didn't accept the sign-in (${data.error_description || data.error || res.status}). Check the App Key, Secret and Callback URL.`);
    }
    return { refreshToken: data.refresh_token ?? form.refresh_token, accessToken: data.access_token, accessExpires: Date.now() + (Number(data.expires_in) || 1800) * 1000 - 60_000 };
  }

  /** A working access token, refreshing it (every 30 minutes) as needed. */
  private async accessToken(): Promise<string> {
    const app = this.settings.schwabApp();
    const tokens = this.settings.schwabTokens();
    if (!app || !tokens || !this.status().signedIn) throw new Error('Schwab sign-in has expired. Open Settings and press "Sign in to Schwab".');
    if (tokens.accessToken && (tokens.accessExpires ?? 0) > Date.now()) return tokens.accessToken;
    try {
      const fresh = await this.tokenRequest(app, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
      this.settings.setSchwabTokens(fresh);
      return fresh.accessToken;
    } catch {
      this.settings.setSchwabTokens(null);
      throw new Error('Schwab sign-in has expired. Open Settings and press "Sign in to Schwab".');
    }
  }

  private async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${API}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await this.fetchFn(url.toString(), { headers: { authorization: `Bearer ${await this.accessToken()}`, accept: 'application/json' } });
    const data = await res.json().catch(() => null) as any;
    if (!res.ok) {
      const why = data?.message || data?.error_description || data?.errors?.[0]?.detail || data?.errors?.[0]?.title || '';
      const what = path.includes('/marketdata/') ? 'market data' : path.split('/').filter((p) => p && !/^[A-F0-9]{20,}$/i.test(p)).pop();
      const hint = res.status === 401 || res.status === 403
        ? ' Your Schwab app may not be fully approved yet, or may be missing the "Accounts and Trading Production" API product (developer.schwab.com, Dashboard, View Details).'
        : '';
      throw new Error(`Schwab answered ${res.status} when reading ${what}${why ? ` (${why})` : ''}.${hint}`);
    }
    return data as T;
  }

  /**
   * Reads trades from every Schwab account. With SnapTrade also connected (it already brings the
   * trades in), Schwab only fills in their exact times; otherwise it brings in the trades too.
   */
  async sync(opts: { addNew: boolean }): Promise<SyncResult & { retimed: number }> {
    const numbers = await this.get<{ accountNumber: string; hashValue: string }[]>('/trader/v1/accounts/accountNumbers');
    const prefs = await this.get<any>('/trader/v1/userPreference').catch(() => null);
    const prefAccounts: any[] = (Array.isArray(prefs) ? prefs.flatMap((p) => p.accounts ?? []) : prefs?.accounts) ?? [];
    const now = Date.now();
    const last = this.settings.schwabLastSync;
    const from = last ? Math.max(now - HISTORY_DAYS * DAY, Date.parse(last) - OVERLAP_DAYS * DAY) : now - HISTORY_DAYS * DAY;
    let added = 0;
    let retimed = 0;
    const errors: string[] = [];
    for (const { accountNumber, hashValue } of numbers) {
      // Named like SnapTrade names it ("Schwab · Trading"); the number itself is never kept.
      const nick = prefAccounts.find((p) => p.accountNumber === accountNumber)?.nickName;
      const account = `Schwab · ${nick || `···${accountNumber.slice(-3)}`}`;
      try {
        const transactions: SchwabTransaction[] = [];
        // Ask in 90-day pieces; Schwab caps how much one request returns.
        for (let start = from; start < now; start += 90 * DAY) {
          const end = Math.min(now, start + 90 * DAY);
          const page = await this.get<SchwabTransaction[]>(`/trader/v1/accounts/${hashValue}/transactions`, {
            startDate: new Date(start).toISOString(), endDate: new Date(end).toISOString(), types: 'TRADE,RECEIVE_AND_DELIVER',
          });
          transactions.push(...(Array.isArray(page) ? page : []));
        }
        const orders = await this.get<SchwabOrder[]>(`/trader/v1/accounts/${hashValue}/orders`, {
          fromEnteredTime: new Date(now - ORDER_DAYS * DAY).toISOString(), toEnteredTime: new Date(now).toISOString(), status: 'FILLED',
        }).catch(() => [] as SchwabOrder[]);
        const fills = transactionsToFills(transactions, Array.isArray(orders) ? orders : [], {
          account, timeZone: this.settings.timeZone, existing: this.db.allFills(),
        });
        const result = this.db.addFills(fills, { addNew: opts.addNew });
        added += result;
        retimed += this.db.lastRetimed;
      } catch (err) {
        errors.push(`${account}: ${(err as Error).message}`);
      }
    }
    if (!errors.length) this.settings.schwabLastSync = new Date().toISOString();
    return { added, retimed, accounts: numbers.length, errors };
  }

  /** One-minute bars of an index like $SPX from Schwab, or null when Schwab isn't signed in or has none. */
  async indexBars(symbol: string, startMillis: number, endMillis: number): Promise<Bar[] | null> {
    if (!this.status().signedIn) return null;
    const data = await this.get<{ candles?: { datetime: number; open: number; high: number; low: number; close: number; volume?: number }[] }>(
      '/marketdata/v1/pricehistory', {
        symbol, periodType: 'day', frequencyType: 'minute', frequency: '1',
        startDate: String(startMillis), endDate: String(endMillis), needExtendedHoursData: 'false',
      },
    ).catch(() => null);
    const bars = (data?.candles ?? []).filter((c) => c.datetime >= startMillis && c.datetime < endMillis)
      .map((c) => ({ time: c.datetime, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 }));
    return bars.length ? bars : null;
  }

  /** Forgets the sign-in; with `everything`, the app key and secret too. */
  disconnect(everything: boolean) {
    if (everything) this.settings.setSchwabApp(null);
    else this.settings.setSchwabTokens(null);
    session.fromPartition('schwab-sign-in').clearStorageData().catch(() => {});
  }
}
