import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for Electron's secure storage that can only unlock what it locked itself.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`ok:${s}`),
    decryptString: (b: Buffer) => {
      const s = b.toString();
      if (!s.startsWith('ok:')) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return s.slice(3);
    },
  },
}));

const { Settings } = await import('../src/main/settings');

describe('settings', () => {
  let file: string;
  beforeEach(() => {
    delete process.env.ALPACA_KEY_ID;
    delete process.env.ALPACA_SECRET_KEY;
    file = path.join(mkdtempSync(path.join(tmpdir(), 'mj-settings-')), 'settings.json');
  });

  it('reads back saved Alpaca keys', () => {
    new Settings(file).setAlpacaCredentials({ keyId: 'AK1', secretKey: 'S1' });
    expect(new Settings(file).alpacaCredentials()).toEqual({ keyId: 'AK1', secretKey: 'S1' });
  });

  it('forgets keys it cannot unlock instead of failing', () => {
    // Keys locked on another app folder, as after the rename copied settings.json across.
    writeFileSync(file, JSON.stringify({ timeZone: 'America/New_York', alpaca: Buffer.from('foreign').toString('base64') }));
    const settings = new Settings(file);
    expect(settings.alpacaCredentials()).toBeNull();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ timeZone: 'America/New_York' });
  });
});
