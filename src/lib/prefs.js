// Preferences in localStorage, in one place: the storage can be blocked (a private window), full, or hold a value
// another version wrote (broken JSON, an array where an object is expected). A read never throws and always comes
// back in the shape of its defaults; a write that fails keeps the value in memory for this session.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// an object: the defaults with what was stored over them (unknown stored fields are kept); an array: the stored
// array, or a copy of the defaults when what is stored is not an array; anything else: the stored value or the default
export function readPref(key, defaults) {
  let v;
  try { v = JSON.parse(localStorage.getItem(key)); } catch (e) { v = null; }
  if (isObj(defaults)) return isObj(v) ? { ...defaults, ...v } : { ...defaults };
  if (Array.isArray(defaults)) return Array.isArray(v) ? v : [...defaults];
  return v == null ? defaults : v;
}

export function writePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
}

// a plain string (the library path, a page id, a template)
export function readText(key, fallback = '') {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch (e) { return fallback; }
}
export function writeText(key, value) {
  try { localStorage.setItem(key, String(value)); return true; } catch (e) { return false; }
}
