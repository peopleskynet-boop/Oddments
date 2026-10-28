// The wall's shortcuts as one table: main.js runs them and the «?» sheet (keys.js) lists them, so a new key cannot be
// added to one and forgotten in the other. Layers (the preview, the feed, the icon constructor…) keep their own keys:
// they get the keyboard first (layers.js) and list theirs in keys.js.
//
// A row: { group, keys, what, hit(e), run(e) }. keys/what are what the sheet shows; a row without hit is
// documentation only (a key handled elsewhere: Ctrl+V, the context menu, the command palette).
export const HOTKEYS = [];
export const hotkey = (row) => { HOTKEYS.push(row); };

// the first row that matches runs; true when one did
export function runHotkey(e) {
  for (const r of HOTKEYS) if (r.hit && r.hit(e)) { r.run(e); return true; }
  return false;
}

// a key without Ctrl / ⌘ / Alt (Shift is the row's own business)
export const plain = (e) => !e.ctrlKey && !e.metaKey && !e.altKey;
export const mod = (e) => e.ctrlKey || e.metaKey;
