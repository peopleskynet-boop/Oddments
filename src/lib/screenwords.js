// What a screen is said to be (screens.js, the `scr` field), as words for search — kept small: the search loads at
// start, the guessing word lists of screens.js do not have to.
export const OSES = [['ios', 'iOS'], ['android', 'Android'], ['web', 'Веб']];
export function screenWords(scr) {
  if (!scr) return '';
  const os = OSES.find(([k]) => k === scr.os);
  return [scr.app, os && os[1], scr.type, ...(scr.pat || []), scr.ver].filter(Boolean).join(' ');
}
