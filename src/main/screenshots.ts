// Screenshots attached to trades: PNG files in the data folder, listed in the database.

import { clipboard, nativeImage } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseTradingViewClipboard } from '../core/drawings';
import type { JournalDb } from './db';
import type { PasteResult, TradeImage } from '../shared/api';

export class Screenshots {
  constructor(private db: JournalDb, private dir: string, private sampleFile: string) {
    // Earlier versions saved whatever was on the clipboard, which could be a password or key.
    // Only TradingView copies are worth keeping.
    try {
      if (existsSync(sampleFile) && !/tradingview/i.test(readFileSync(sampleFile, 'utf8'))) rmSync(sampleFile, { force: true });
    } catch { /* not important */ }
  }

  private file(id: string) {
    // Ids are UUIDs we made; never let one point outside the folder.
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Bad screenshot id');
    return path.join(this.dir, `${id}.png`);
  }

  list(tradeId: string): TradeImage[] {
    return this.db.tradeImages(tradeId).flatMap((row) => {
      try {
        return [{ ...row, url: `data:image/png;base64,${readFileSync(this.file(row.id)).toString('base64')}` }];
      } catch {
        return []; // The file was deleted by hand.
      }
    });
  }

  /** Saves an image (any format Electron can read) as a PNG on the trade. False if it isn't an image. */
  add(tradeId: string, image: Electron.NativeImage): boolean {
    if (image.isEmpty()) return false;
    mkdirSync(this.dir, { recursive: true });
    const id = randomUUID();
    writeFileSync(this.file(id), image.toPNG());
    this.db.addTradeImage(id, tradeId);
    return true;
  }

  addFiles(tradeId: string, files: string[]): number {
    return files.filter((f) => this.add(tradeId, nativeImage.createFromPath(f))).length;
  }

  addData(tradeId: string, data: Uint8Array): boolean {
    return this.add(tradeId, nativeImage.createFromBuffer(Buffer.from(data)));
  }

  remove(id: string) {
    rmSync(this.file(id), { force: true });
    this.db.removeTradeImage(id);
  }

  /** Every format on the clipboard: text formats as text, pictures as an image. */
  private async clipboardContents() {
    const texts: Record<string, string> = {};
    let image: Electron.NativeImage | null = null;
    for (const item of await clipboard.read()) {
      for (const type of item.types) {
        try {
          const blob = (await item.getType(type)) as Blob;
          const bytes = Buffer.from(await blob.arrayBuffer());
          if (type.startsWith('image/')) {
            const img = nativeImage.createFromBuffer(bytes);
            if (!img.isEmpty() && !image) image = img;
          } else {
            texts[type] = bytes.toString('utf8');
          }
        } catch { /* a format that can't be read */ }
      }
    }
    return { texts, image };
  }

  /**
   * What's on the clipboard: TradingView drawings if it holds any, and whether there's a picture.
   * When there's text but no drawings, a copy of everything on the clipboard is saved so we can
   * see how the app that copied it stores its data.
   */
  async readPaste(): Promise<PasteResult> {
    const { texts, image } = await this.clipboardContents();
    const { drawings, skipped } = parseTradingViewClipboard(...Object.values(texts));
    let sampleSaved = false;
    // The latest TradingView copy is kept so new drawing types can be added from it.
    // Nothing else you copied is ever saved, since it could be a password or key.
    if (!image && Object.values(texts).some((t) => /tradingview/i.test(t))) {
      try {
        const sample = Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v.slice(0, 2_000_000)]));
        const json = JSON.stringify({ when: new Date().toISOString(), formats: Object.keys(texts), skipped, ...sample }, null, 1);
        writeFileSync(this.sampleFile, json);
        // Copies with types that can't be drawn yet are also kept one by one (the latest 30), so
        // several pastes in a row don't overwrite each other.
        if (skipped.length) {
          const dir = path.join(path.dirname(this.sampleFile), 'tradingview-samples');
          mkdirSync(dir, { recursive: true });
          writeFileSync(path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`), json);
          for (const old of readdirSync(dir).sort().reverse().slice(30)) rmSync(path.join(dir, old), { force: true });
        }
        sampleSaved = true;
      } catch { /* not important */ }
    }
    return { drawings, skipped, hasImage: !!image, sampleSaved };
  }

  async addFromClipboard(tradeId: string): Promise<boolean> {
    const { image } = await this.clipboardContents();
    return image ? this.add(tradeId, image) : false;
  }
}
