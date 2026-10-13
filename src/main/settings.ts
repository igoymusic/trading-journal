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
  /** Base64 of the encrypted "keyId\nsecretKey". */
  alpaca?: string;
}

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
