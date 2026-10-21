// App settings, kept in a JSON file in the app's data folder. API secrets are encrypted with the
// operating system's secure storage (Windows: tied to your Windows login) before they're written.

import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AlpacaCredentials } from '../core/alpaca';
import type { Goals } from '../core/goals';
import { cleanMarkerStyles, type MarkerStyles } from '../core/markerStyles';
import { cleanIndicators, type Indicator } from '../core/indicators';
import type { SchwabSlot } from '../shared/api';

interface StoredSettings {
  timeZone: string;
  /** Where the window was when you last closed it. */
  windowBounds?: { x: number; y: number; width: number; height: number; maximized?: boolean };
  /** Trade table columns, in display order. */
  tradeColumns?: string[];
  goals?: Goals;
  /** Report sections' columns, order and collapsed state. */
  reportsLayout?: { columns: string[][]; collapsed: string[]; charts?: string[] };
  /** Address of the SnapTrade relay; empty uses the one built into the app. */
  relayUrl?: string;
  /** This person's SnapTrade sign-in: the user id, and the secret encrypted like the Alpaca keys. */
  snaptrade?: { userId: string; secret: string };
  /** Colors changed from the defaults, e.g. { win: "#00c853" }. */
  colors?: Record<string, string>;
  /** Accounts left out of the journal's numbers (by name). */
  hiddenAccounts?: string[];
  /** Indicators shown on every chart. */
  indicators?: Indicator[];
  /** Option prices as quoted ($0.15) or per contract ($15.00, the default). */
  optionPriceDisplay?: 'quote' | 'contract';
  /** SPX and other index options: chart the index ('index') or its ETF as-is (unset, the default). */
  indexChart?: 'index';
  /** How entry and exit markers look, when changed from the defaults. */
  markerStyles?: MarkerStyles;
  /** When broker sync last ran (ISO time). */
  lastBrokerSync?: string;
  /** Base64 of the encrypted "keyId\nsecretKey". */
  alpaca?: string;
  /** Your own Schwab developer app: key and secret encrypted together, plus its callback address. */
  schwab?: StoredSchwab;
  /** A second Schwab app used only for market data (Schwab allows one app per product). */
  schwabData?: StoredSchwab;
  /** Folder for the automatic daily backup (e.g. in OneDrive), and the day it last ran. */
  backupFolder?: string;
  lastAutoBackup?: string;
}

/** Settings that can't move to another computer: secrets locked to this one, and this computer's folders. */
const LOCAL_ONLY = ['alpaca', 'snaptrade', 'schwab', 'schwabData', 'lastBrokerSync', 'backupFolder', 'lastAutoBackup'] as const;

interface StoredSchwab { app: string; callbackUrl: string; tokens?: string; signedInAt?: string; lastSync?: string; marketDataOnly?: boolean }

export type { SchwabSlot };

export interface SchwabApp { appKey: string; secret: string; callbackUrl: string }
export interface SchwabTokens { refreshToken: string; accessToken?: string; accessExpires?: number }

/** Filled in at build time from the MOON_RELAY_URL repository variable once the relay is deployed. */
declare const __MOON_RELAY_URL__: string | undefined;
const BUILT_IN_RELAY_URL = typeof __MOON_RELAY_URL__ === 'string' ? __MOON_RELAY_URL__ : '';

const DEFAULTS: StoredSettings = { timeZone: 'America/New_York' };

export class Settings {
  private data: StoredSettings;

  constructor(private file: string) {
    this.data = existsSync(file) ? { ...DEFAULTS, ...JSON.parse(readFileSync(file, 'utf8')) } : { ...DEFAULTS };
    // A market-data-only app saved in the trading slot by an earlier version moves to its own slot.
    if (this.data.schwab?.marketDataOnly && !this.data.schwabData) this.schwabMarketDataOnly = true;
  }

  private save() {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  get windowBounds() {
    return this.data.windowBounds;
  }

  set windowBounds(bounds: StoredSettings['windowBounds']) {
    this.data.windowBounds = bounds;
    this.save();
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

  get colors() {
    return this.data.colors;
  }

  set colors(c: Record<string, string> | undefined) {
    // Only keep real "#rrggbb" colors.
    const clean = Object.fromEntries(Object.entries(c ?? {}).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v)));
    this.data.colors = Object.keys(clean).length ? clean : undefined;
    this.save();
  }

  get indicators(): Indicator[] {
    return cleanIndicators(this.data.indicators);
  }

  set indicators(list: Indicator[]) {
    const clean = cleanIndicators(list);
    this.data.indicators = clean.length ? clean : undefined;
    this.save();
  }

  get optionPriceDisplay(): 'quote' | 'contract' {
    return this.data.optionPriceDisplay === 'quote' ? 'quote' : 'contract';
  }

  set optionPriceDisplay(mode: 'quote' | 'contract') {
    this.data.optionPriceDisplay = mode === 'quote' ? 'quote' : undefined;
    this.save();
  }

  /** Whether SPX trades chart on SPY ('etf') or on SPX itself ('index'). */
  get indexChart(): 'etf' | 'index' {
    return this.data.indexChart === 'index' ? 'index' : 'etf';
  }

  set indexChart(mode: 'etf' | 'index') {
    this.data.indexChart = mode === 'index' ? 'index' : undefined;
    this.save();
  }

  get markerStyles(): MarkerStyles {
    return cleanMarkerStyles(this.data.markerStyles);
  }

  set markerStyles(s: MarkerStyles | undefined) {
    this.data.markerStyles = s ? cleanMarkerStyles(s) : undefined;
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

  private decrypt(b64: string): string | null {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(Buffer.from(b64, 'base64'));
    } catch {
      return null;
    }
  }

  private encrypt(plain: string): string {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this computer, so the keys were not saved.');
    return safeStorage.encryptString(plain).toString('base64');
  }

  private schwab(slot: SchwabSlot): StoredSchwab | undefined {
    return slot === 'trading' ? this.data.schwab : this.data.schwabData;
  }

  /** The Schwab developer app entered in Settings for this slot, or null. */
  schwabApp(slot: SchwabSlot): SchwabApp | null {
    const s = this.schwab(slot);
    const plain = s && this.decrypt(s.app);
    if (!s || !plain) return null;
    const [appKey, secret] = plain.split('\n');
    return appKey && secret ? { appKey, secret, callbackUrl: s.callbackUrl } : null;
  }

  setSchwabApp(slot: SchwabSlot, app: SchwabApp | null) {
    const stored = app ? { app: this.encrypt(`${app.appKey.trim()}\n${app.secret.trim()}`), callbackUrl: app.callbackUrl.trim() } : undefined;
    if (slot === 'trading') this.data.schwab = stored;
    else this.data.schwabData = stored;
    this.save();
  }

  schwabTokens(slot: SchwabSlot): SchwabTokens | null {
    const t = this.schwab(slot)?.tokens;
    const plain = t && this.decrypt(t);
    return plain ? JSON.parse(plain) : null;
  }

  /** Saves new tokens; `signedIn` marks a fresh sign-in, which starts Schwab's 7-day clock. */
  setSchwabTokens(slot: SchwabSlot, tokens: SchwabTokens | null, signedIn = false) {
    const s = this.schwab(slot);
    if (!s) return;
    if (!tokens) {
      delete s.tokens;
      delete s.signedInAt;
    } else {
      s.tokens = this.encrypt(JSON.stringify(tokens));
      if (signedIn) s.signedInAt = new Date().toISOString();
    }
    this.save();
  }

  schwabSignedInAt(slot: SchwabSlot) {
    return this.schwab(slot)?.signedInAt;
  }

  /** True when the trading slot's app turned out to have only market data. */
  get schwabMarketDataOnly() {
    return !!this.data.schwab?.marketDataOnly;
  }

  set schwabMarketDataOnly(v: boolean) {
    if (!this.data.schwab) return;
    if (v && !this.data.schwabData) {
      // It's a market data app: move it to that slot, signed in as it is.
      this.data.schwabData = { ...this.data.schwab, marketDataOnly: undefined, lastSync: undefined };
      delete this.data.schwab;
    } else {
      this.data.schwab.marketDataOnly = v || undefined;
    }
    this.save();
  }

  get schwabLastSync() {
    return this.data.schwab?.lastSync;
  }

  set schwabLastSync(iso: string | undefined) {
    if (!this.data.schwab) return;
    this.data.schwab.lastSync = iso;
    this.save();
  }

  get backupFolder() {
    return this.data.backupFolder;
  }

  set backupFolder(folder: string | undefined) {
    this.data.backupFolder = folder;
    this.save();
  }

  get lastAutoBackup() {
    return this.data.lastAutoBackup;
  }

  set lastAutoBackup(day: string | undefined) {
    this.data.lastAutoBackup = day;
    this.save();
  }

  /** The settings worth taking to another computer (no keys or sign-ins, not even encrypted). */
  portable(): Partial<StoredSettings> {
    const copy: Partial<StoredSettings> = { ...this.data };
    for (const k of LOCAL_ONLY) delete copy[k];
    return copy;
  }

  /** Takes settings from a backup, keeping this computer's keys, sign-ins and backup folder. */
  restorePortable(from: Partial<StoredSettings>) {
    const local = Object.fromEntries(LOCAL_ONLY.map((k) => [k, this.data[k]]));
    const incoming = { ...from };
    for (const k of LOCAL_ONLY) delete incoming[k];
    this.data = { ...DEFAULTS, ...incoming, ...local } as StoredSettings;
    this.save();
  }
}
