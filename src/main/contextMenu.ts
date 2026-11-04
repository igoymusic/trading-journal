// The right-click menu: spelling suggestions for an underlined word, then Cut, Copy, Paste and
// Select all where they make sense. Electron shows no menu at all unless the app builds one.
import { type BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';

export function addContextMenu(win: BrowserWindow) {
  win.webContents.on('context-menu', (_event, params) => {
    const items: MenuItemConstructorOptions[] = [];
    if (params.misspelledWord) {
      for (const word of params.dictionarySuggestions.slice(0, 6)) {
        items.push({ label: word, click: () => win.webContents.replaceMisspelling(word) });
      }
      if (!params.dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false });
      items.push(
        { label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
        { type: 'separator' },
      );
    }
    const { editFlags } = params;
    if (params.isEditable) {
      items.push(
        { label: 'Cut', role: 'cut', enabled: editFlags.canCut },
        { label: 'Copy', role: 'copy', enabled: editFlags.canCopy },
        { label: 'Paste', role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { label: 'Select all', role: 'selectAll', enabled: editFlags.canSelectAll },
      );
    } else if (params.selectionText.trim()) {
      items.push({ label: 'Copy', role: 'copy' });
    }
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });
}
