// A trade's screenshots: a grid you can paste, drop or pick pictures into, and a full-size viewer.

import { useEffect, useState } from 'react';
import type { TradeImage } from '../shared/api';

const CHANGED = 'screenshots-changed';
export const screenshotsChanged = (tradeId: string) => window.dispatchEvent(new CustomEvent(CHANGED, { detail: tradeId }));

/** How many screenshots a trade has, kept up to date as they're added and removed. */
export function useScreenshotCount(tradeId: string) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let current = true;
    const load = () => window.journal.screenshotCounts().then((c) => { if (current) setCount(c[tradeId] ?? 0); });
    load();
    const onChange = (e: Event) => { if ((e as CustomEvent).detail === tradeId) load(); };
    window.addEventListener(CHANGED, onChange);
    return () => { current = false; window.removeEventListener(CHANGED, onChange); };
  }, [tradeId]);
  return count;
}

export function ScreenshotGallery({ tradeId }: { tradeId: string }) {
  const [images, setImages] = useState<TradeImage[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [dropping, setDropping] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let current = true;
    const load = () => window.journal.listScreenshots(tradeId).then((l) => { if (current) setImages(l); });
    load();
    const onChange = (e: Event) => { if ((e as CustomEvent).detail === tradeId) load(); };
    window.addEventListener(CHANGED, onChange);
    return () => { current = false; window.removeEventListener(CHANGED, onChange); };
  }, [tradeId]);

  const flash = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(''), 3500); };
  const changed = () => screenshotsChanged(tradeId);

  async function paste() {
    if (await window.journal.pasteScreenshot(tradeId)) changed();
    else flash('There\'s no picture on the clipboard. Copy a screenshot first (Win+Shift+S takes one).');
  }
  async function pick() {
    if (await window.journal.pickScreenshots(tradeId)) changed();
  }
  async function drop(e: React.DragEvent) {
    e.preventDefault();
    setDropping(false);
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) { flash('Only pictures can be added here.'); return; }
    let added = 0;
    for (const f of files) if (await window.journal.addScreenshotData(tradeId, new Uint8Array(await f.arrayBuffer()))) added++;
    if (added) changed();
    if (added < files.length) flash('Some files couldn\'t be read. PNG and JPG pictures work.');
  }
  async function remove(id: string) {
    await window.journal.removeScreenshot(id);
    setOpen(null);
    changed();
  }
  function caption(id: string, text: string) {
    setImages((l) => l && l.map((i) => (i.id === id ? { ...i, caption: text } : i)));
    window.journal.captionScreenshot(id, text);
  }

  return (
    <div
      className={`gallery ${dropping ? 'dropping' : ''}`}
      tabIndex={-1}
      onPaste={(e) => { if (!(e.target as HTMLElement).closest('input, textarea')) { e.preventDefault(); paste(); } }}
      onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
      onDrop={drop}
    >
      <div className="gallery-actions">
        <button onClick={paste} title="Add the picture on the clipboard (Ctrl+V)">Paste screenshot</button>
        <button onClick={pick}>Add pictures…</button>
        <span className="muted small-inline">or drag pictures here</span>
        {message && <span className="gallery-message">{message}</span>}
      </div>
      {images && !images.length && (
        <div className="gallery-empty muted">
          No screenshots yet. Take one with Win+Shift+S, or copy a chart image in TradingView, then press Ctrl+V here.
        </div>
      )}
      <div className="gallery-grid">
        {images?.map((img, i) => (
          <figure key={img.id} className="shot">
            <img src={img.url} alt={img.caption || 'Screenshot'} onClick={() => setOpen(i)} />
            <figcaption>
              <input value={img.caption} placeholder="Caption" onChange={(e) => caption(img.id, e.target.value)} />
              <button className="danger-link" title="Delete" onClick={() => remove(img.id)}>×</button>
            </figcaption>
          </figure>
        ))}
      </div>
      {open !== null && images?.[open] && (
        <Lightbox images={images} index={open} onIndex={setOpen} onClose={() => setOpen(null)} onRemove={remove} />
      )}
    </div>
  );
}

function Lightbox({ images, index, onIndex, onClose, onRemove }: {
  images: TradeImage[]; index: number; onIndex: (i: number) => void; onClose: () => void; onRemove: (id: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onIndex(Math.min(images.length - 1, index + 1));
      else if (e.key === 'ArrowLeft') onIndex(Math.max(0, index - 1));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, images.length]);
  const img = images[index];
  return (
    <div className="lightbox" onClick={onClose}>
      <img src={img.url} alt={img.caption} onClick={(e) => e.stopPropagation()} />
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <button disabled={index === 0} onClick={() => onIndex(index - 1)}>←</button>
        <span>{img.caption || <span className="muted">No caption</span>} <span className="muted">· {index + 1} of {images.length}</span></span>
        <button disabled={index === images.length - 1} onClick={() => onIndex(index + 1)}>→</button>
        <button className="danger-link" onClick={() => onRemove(img.id)}>Delete</button>
        <button onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
