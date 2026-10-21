// The humanitarian assessment layer: INFORM Severity rows matched to the
// countries named in events and theaters. Pure. Imported by the page and tests.
import { theaterOf } from './theaters.js';

export const SEV_COLOURS = { 1: '#e4dfdf', 2: '#f6c5b8', 3: '#f0866b', 4: '#ec3013', 5: '#7c1405' };
export const SEV_WORDS = { 1: 'very low', 2: 'low', 3: 'medium', 4: 'high', 5: 'very high' };

// Names the event ledgers use that differ from INFORM's.
const ALIASES = {
  drc: 'Democratic Republic of the Congo', 'dr congo': 'Democratic Republic of the Congo', 'congo (kinshasa)': 'Democratic Republic of the Congo',
  'democratic republic of congo': 'Democratic Republic of the Congo',
  gaza: 'Palestine', 'gaza strip': 'Palestine', 'west bank': 'Palestine', 'palestinian territories': 'Palestine', 'state of palestine': 'Palestine',
  turkiye: 'Turkey', 'türkiye': 'Turkey', "cote d'ivoire": 'Ivory Coast', "côte d'ivoire": 'Ivory Coast', burma: 'Myanmar', car: 'Central African Republic',
};

// One row per country: where INFORM lists two crises in a country, keep the more severe.
export function indexAssessment(doc) {
  const byIso3 = {};
  for (const c of doc.countries) if (!byIso3[c.iso3] || c.index > byIso3[c.iso3].index) byIso3[c.iso3] = c;
  const rows = Object.values(byIso3).sort((a, b) => b.index - a.index || a.country.localeCompare(b.country));
  const byName = {};
  for (const c of rows) byName[c.country.toLowerCase()] = c;
  const byNum = {};
  for (const c of rows) if (c.isoNum) byNum[c.isoNum] = c;
  return { rows, byIso3, byName, byNum };
}

export function matchCountry(idx, name) {
  const k = String(name || '').trim().toLowerCase();
  return idx.byName[k] || idx.byName[(ALIASES[k] || '').toLowerCase()] || null;
}

// Assessed countries named in an event, most severe first.
export function eventCountries(idx, ev) {
  const seen = new Set();
  const out = [];
  for (const n of ev.countries || []) {
    const c = matchCountry(idx, n);
    if (c && !seen.has(c.iso3)) { seen.add(c.iso3); out.push(c); }
  }
  return out.sort((a, b) => b.index - a.index);
}

// The worst crises in a theater: the top category and the countries at it.
export function theaterSeverity(idx, theaterId) {
  const mine = idx.rows.filter((c) => theaterOf({ countries: [c.country], place: c.country }) === theaterId);
  if (!mine.length) return null;
  const top = Math.max(...mine.map((c) => c.category));
  return { category: top, countries: mine.filter((c) => c.category === top), all: mine };
}

export function people(n) {
  if (n == null) return null;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')} million`;
  return n.toLocaleString('en-US');
}
