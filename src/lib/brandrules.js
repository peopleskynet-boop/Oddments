// Where the brand rules (brand.js) come from: a connected team's folder (oddments-team.json → brand), so the whole team
// checks against the same palette and limits; otherwise one's own (Настройки › Правила бренда); otherwise the defaults.
import { DEFAULT_RULES } from './brand.js';
import { readPref, writePref } from './prefs.js';

const PREF = 'perch.brand';
let teamRules = null; // { rules, team } — read from a team's manifest by team.js

const merge = (r) => ({ ...DEFAULT_RULES, ...r, model: { ...DEFAULT_RULES.model, ...((r && r.model) || {}) } });
export const setTeamRules = (rules, team) => { teamRules = rules ? { rules: merge(rules), team } : null; };
export const rulesSource = () => (teamRules ? `команда «${teamRules.team}»` : readPref(PREF, null) ? 'ваши' : 'по умолчанию');
export function brandRules() {
  if (teamRules) return teamRules.rules;
  const own = readPref(PREF, null);
  return own ? merge(own) : DEFAULT_RULES;
}
export const ownRules = () => merge(readPref(PREF, {}));
export const saveOwnRules = (r) => writePref(PREF, r);
