// Screenshots attached to trades: PNG files in the data folder, listed in the database.

import { clipboard, nativeImage } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseTradingViewClipboard } from '../core/drawings';
import type { JournalDb } from './db';
import type { PasteResult, TradeImage } from '../shared/api';

export class Screenshots {
  constructor(private db: JournalDb, private dir: string, private sampleFile: string) {}

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
    const drawings = parseTradingViewClipboard(...Object.values(texts));
    let sampleSaved = false;
    if (!drawings.length && !image && Object.values(texts).some(Boolean)) {
      try {
        const sample = Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v.slice(0, 200_000)]));
        writeFileSync(this.sampleFile, JSON.stringify({ when: new Date().toISOString(), formats: Object.keys(texts), ...sample }, null, 1));
        sampleSaved = true;
      } catch { /* not important */ }
    }
    return { drawings, hasImage: !!image, sampleSaved };
  }

  async addFromClipboard(tradeId: string): Promise<boolean> {
    const { image } = await this.clipboardContents();
    return image ? this.add(tradeId, image) : false;
  }
}
