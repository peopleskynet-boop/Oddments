// The person's Anthropic key and the model for icon generation (iconai.js); the AI through the API (aicloud.js) and the
// feed's translation use the same key. Small on purpose: aicloud.js loads at start, the icon generation does not.
import { readPref, writePref } from './prefs.js';

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — быстро и недорого' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — лучше качество, дороже' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — самый дешёвый' },
];
const PREFS = 'perch.iconai';
export const aiPrefs = () => readPref(PREFS, { key: '', model: MODELS[0].id });
export const setAiPrefs = (p) => writePref(PREFS, { ...aiPrefs(), ...p });
