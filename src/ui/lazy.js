// Rarely used screens load on first use, not at start: the duplicates, «Разобрать», batch rename, the player.
// Everything else asks about them through here — «is it open?» is answered from the body's classes without loading
// anything — and opening one loads its module once (from the app's own files, a few milliseconds) and sets it up.
// preloadLazy() fetches them quietly after start, when the window is idle, so even the first opening is instant.
let onSel = () => {};
let dupesMod = null, tidyMod = null;
const once = (load) => { let p = null; return () => (p ||= load()); };

const dupes = once(() => import('./dupes.js').then((m) => { m.initDupes(); return (dupesMod = m); }));
const rename = once(() => import('./rename.js'));

export const setLazySelection = (fn) => { onSel = fn; };

export const isDupesOpen = () => document.body.classList.contains('dupes-on');

// an open screen is loaded already, so closing stays synchronous (callers go on to change the view right after)
export const openDupes = () => dupes().then((m) => m.openDupes());
export const closeDupes = () => { if (dupesMod) dupesMod.closeDupes(); };
// «Разобрать» (#80): files in no collection with suggested collections (tidy.js)
const tidy = once(() => import('./tidy.js').then((m) => (tidyMod = m)));
export const isTidyOpen = () => document.body.classList.contains('tidy-on');
export const openTidy = () => tidy().then((m) => m.openTidy());
export const closeTidy = () => { if (tidyMod) tidyMod.closeTidy(); };
// any screen over the grid (the duplicates, «Разобрать»)
export const isOverlayOpen = () => isDupesOpen() || isTidyOpen();
export const closeOverlays = () => { closeDupes(); closeTidy(); };
export const openRename = (items) => rename().then((m) => m.openRename(items));
// the design feed (feed.js): a screen of its own, loaded on first open
export const isFeedOpen = () => document.body.classList.contains('feed-on');
export const openFeed = () => import('./feed.js').then((m) => m.openFeed());
// «Новости»: the daily digest and saved articles (news.js)
export const openNews = (which) => import('./news.js').then((m) => m.openNews(which));

// after start, in the browser's idle time: the screens people open most, then the rest
export function preloadLazy() {
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1200));
  const jobs = [rename, dupes, () => import('./player.js'), () => import('./iconkit.js')];
  const next = () => { const j = jobs.shift(); if (j) idle(() => j().catch(() => {}).finally(next), { timeout: 4000 }); };
  setTimeout(next, 2000);
}
