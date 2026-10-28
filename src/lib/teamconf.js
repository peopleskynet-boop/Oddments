// What a team agrees on, kept in its folder's manifest (oddments-team.json) and used by everyone connected: the brand
// rules (brand.js) and the tag dictionary (glossary.js). Without a team — one's own (prefs), then the defaults.
import { readPref, writePref } from './prefs.js';

const fromTeam = {}; // key → { value, team }
export const setTeamConf = (key, value, team) => { if (value) fromTeam[key] = { value, team }; else delete fromTeam[key]; };
export const teamConf = (key) => fromTeam[key] || null;

// the tag dictionary: { canonical: [synonyms] }
export const glossary = () => (fromTeam.glossary ? fromTeam.glossary.value : readPref('perch.glossary', {}));
export const glossarySource = () => (fromTeam.glossary ? `команда «${fromTeam.glossary.team}»` : 'ваш');
export const saveOwnGlossary = (g) => writePref('perch.glossary', g);
