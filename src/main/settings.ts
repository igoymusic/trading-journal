// App settings, kept in a JSON file in the app's data folder. API secrets are encrypted with the
// operating system's secure storage (Windows: tied to your Windows login) before they're written.

import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AlpacaCredentials } from '../core/alpaca';
import type { Goals } from '../core/goals';

interface StoredSettings {
  timeZone: string;
  /** Trade table columns, in display order. */
  tradeColumns?: string[];
  goals?: Goals;
  /** Report sections' columns, order and collapsed state. */
  reportsLayout?: { columns: string[][]; collapsed: string[] };
  /** Address of the SnapTrade relay; empty uses the one built into the app. */
  relayUrl?: string;
  /** This person's SnapTrade sign-in: the user id, and the secret encrypted like the Alpaca keys. */
  snaptrade?: { userId: string; secret: string };
  /** Accounts left out of the journal's numbers (by name). */
  hiddenAccounts?: string[];
  /** When broker sync last ran (ISO time). */
  lastBrokerSync?: string;
  /** Base64 of the encrypted "keyId\nsecretKey". */
  alpaca?: string;
}

/** Filled in at build time from the MOON_RELAY_URL repository variable once the relay is deployed. */
declare const __MOON_RELAY_URL__: string | undefined;
const BUILT_IN_RELAY_URL = typeof __MOON_RELAY_URL__ === 'string' ? __MOON_RELAY_URL__ : '';

const DEFAULTS: StoredSettings = { timeZone: 'America/New_York' };

export class Settings {
  private data: StoredSettings;

  constructor(private file: string) {
    this.data = existsSync(file) ? { ...DEFAULTS, ...JSON.parse(readFileSync(file, 'utf8')) } : { ...DEFAULTS };
  }

  private save() {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  get timeZone() {
    return this.data.timeZone;
  }

  set timeZone(tz: string) {
    this.data.timeZone = tz;
    this.save();
  }

  get tradeColumns() {
    return this.data.tradeColumns;
  }

  set tradeColumns(ids: string[] | undefined) {
    this.data.tradeColumns = ids;
    this.save();
  }

  get goals(): Goals {
    return this.data.goals ?? {};
  }

  set goals(g: Goals) {
    this.data.goals = g;
    this.save();
  }

  get reportsLayout() {
    return this.data.reportsLayout;
  }

  set reportsLayout(layout: StoredSettings['reportsLayout']) {
    this.data.reportsLayout = layout;
    this.save();
  }

  get relayUrl(): string {
    return this.data.relayUrl || process.env.MOON_RELAY_URL || BUILT_IN_RELAY_URL;
  }

  set relayUrl(url: string) {
    this.data.relayUrl = url.trim() || undefined;
    this.save();
  }

  get hiddenAccounts(): string[] {
    return this.data.hiddenAccounts ?? [];
  }

  set hiddenAccounts(names: string[]) {
    this.data.hiddenAccounts = names.length ? names : undefined;
    this.save();
  }

  get lastBrokerSync() {
    return this.data.lastBrokerSync;
  }

  set lastBrokerSync(iso: string | undefined) {
    this.data.lastBrokerSync = iso;
    this.save();
  }

  /** The SnapTrade user for this computer, or null if broker sync hasn't been set up. */
  snaptradeUser(): { userId: string; userSecret: string } | null {
    const st = this.data.snaptrade;
    if (!st || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return { userId: st.userId, userSecret: safeStorage.decryptString(Buffer.from(st.secret, 'base64')) };
    } catch {
      return null;
    }
  }

  setSnaptradeUser(user: { userId: string; userSecret: string } | null) {
    if (!user) {
      delete this.data.snaptrade;
      delete this.data.lastBrokerSync;
    } else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer.');
      this.data.snaptrade = { userId: user.userId, secret: safeStorage.encryptString(user.userSecret).toString('base64') };
    }
    this.save();
  }

  /** Keys from Settings, or from ALPACA_KEY_ID / ALPACA_SECRET_KEY environment variables when developing. */
  alpacaCredentials(): AlpacaCredentials | null {
    if (process.env.ALPACA_KEY_ID && process.env.ALPACA_SECRET_KEY) {
      return { keyId: process.env.ALPACA_KEY_ID, secretKey: process.env.ALPACA_SECRET_KEY };
    }
    if (!this.data.alpaca || !safeStorage.isEncryptionAvailable()) return null;
    let plain: string;
    try {
      plain = safeStorage.decryptString(Buffer.from(this.data.alpaca, 'base64'));
    } catch {
      // The keys were locked with a different lock than this app folder has, e.g. they were copied
      // over from the old "trading-journal" folder. They can't be recovered, so forget them and
      // let the chart ask for them again instead of failing every time.
      delete this.data.alpaca;
      this.save();
      return null;
    }
    const [keyId, secretKey] = plain.split('\n');
    return keyId && secretKey ? { keyId, secretKey } : null;
  }

  setAlpacaCredentials(creds: AlpacaCredentials | null) {
    if (!creds) {
      delete this.data.alpaca;
    } else {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer, so the keys were not saved.');
      this.data.alpaca = safeStorage.encryptString(`${creds.keyId.trim()}\n${creds.secretKey.trim()}`).toString('base64');
    }
    this.save();
  }
}
