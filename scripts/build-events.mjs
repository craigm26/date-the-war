// Merge the ledgers into data/all-events.json, the one file the page reads.
//
//   data/events.json            hand-written repo ledger (theater ids, combat sides, links)
//   data/history-*.json         hand-written ledgers already in the merged shape
//   data/indicators-2026.csv    2026 Global Conflict Indicators (67 rows, sourced)
//
// Rules are stated in the README and in the page footer. Run: npm run build:events
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(root, 'data', p), 'utf8'));

const nodesFile = read('nodes.json');
const nodeById = Object.fromEntries(nodesFile.nodes.map((n) => [n.id, n]));
const mechName = Object.fromEntries(read('mechanisms.json').map((m) => [m.id, m.name]));
const MAJOR = new Set(nodesFile.majorPowers);

export const GROUPS = ['War / conflict', 'Economic', 'Political', 'Social', 'Environmental', 'Technology', 'Health'];
export const SUB_TO_GROUP = {
  'Interstate combat and intervention': 'War / conflict',
  'Conflict incidence and internationalization': 'War / conflict',
  'Non-state conflict and state capacity': 'War / conflict',
  'Interstate tensions and proxy support': 'War / conflict',
  'Nuclear weapons and arms control': 'War / conflict',
  'Alliances and military capacity': 'War / conflict',
  'Trade coercion and sanctions': 'Economic',
  'Trade integration and diplomacy': 'Economic',
  'Macroeconomic and financial conditions': 'Economic',
  'Energy and maritime chokepoints': 'Economic',
  'Critical minerals and strategic resources': 'Economic',
  'Domestic institutions and legitimacy': 'Political',
  'Diplomacy and crisis management': 'Political',
  'Humanitarian consequences': 'Social',
  'Food security and climate stress': 'Environmental',
  'Cyber and hybrid activity': 'Technology',
  'Mobilization and war economy': 'War / conflict',
  'Civil preparedness and resilience': 'Social',
};
export const DIRS = ['Escalatory', 'De-escalatory', 'Mixed', 'Contextual'];
const clamp = (n) => Math.max(1, Math.min(5, n));

// ---------- repo ledger ----------
const KIND_DEFAULTS = {
  'war-start': { dir: 'Escalatory', sub: 'Interstate combat and intervention' },
  link: { dir: 'Escalatory', sub: 'Conflict incidence and internationalization' },
  'war-end': { dir: 'De-escalatory', sub: 'Diplomacy and crisis management' },
  measure: { dir: 'Contextual', sub: 'Conflict incidence and internationalization' },
  event: { dir: 'Mixed', sub: 'Domestic institutions and legitimacy' },
};

function fromRepo(ev) {
  const t = nodeById[ev.theater];
  const [a = [], b = []] = ev.combat || [];
  const d = KIND_DEFAULTS[ev.kind] || KIND_DEFAULTS.event;
  const dir = ev.dir || (ev.kind === 'event' && a.length ? 'Escalatory' : d.dir);
  const sub = ev.sub || (ev.kind === 'event' && a.length ? 'Interstate combat and intervention' : d.sub);
  const group = ev.group || SUB_TO_GROUP[sub];
  const majorsBothSides = a.some((p) => MAJOR.has(p)) && b.some((p) => MAJOR.has(p));
  let mag = ev.mag;
  if (mag == null) {
    mag = ev.kind === 'war-start' ? (majorsBothSides ? 5 : 4)
      : ev.kind === 'link' ? 3
      : ev.kind === 'war-end' ? 3
      : ev.kind === 'measure' ? 2
      : a.length ? 3 : 2;
  }
  const countries = [...a, ...b].map((p) => nodeById[p]?.name ?? p);
  let arc = null;
  if (ev.link) {
    const [p, q] = ev.link.map((id) => nodeById[id]);
    if (p && q) arc = [[p.lon, p.lat], [q.lon, q.lat]];
  } else if (a[0] && b[0]) {
    const [p, q] = [nodeById[a[0]], nodeById[b[0]]];
    if (p && q) arc = [[p.lon, p.lat], [q.lon, q.lat]];
  }
  return {
    id: ev.id, date: ev.date, era: ev.era, group, sub, dir, mag: clamp(mag),
    title: ev.title, note: ev.note, effects: '', implication: '',
    mechanisms: (ev.mechanisms || []).map((m) => mechName[m] || m),
    metric: '', metricName: '', countries,
    lon: t.lon, lat: t.lat, place: t.name, arc, global: false,
    source: ev.source, checked: ev.checked ?? null, limitations: '',
  };
}

// ---------- history ledgers (already merged shape, mechanism ids) ----------
function fromHistory(ev) {
  return {
    effects: '', implication: '', metric: '', metricName: '', global: false, arc: null, limitations: '',
    ...ev,
    group: ev.group || SUB_TO_GROUP[ev.sub],
    mechanisms: (ev.mechanisms || []).map((m) => mechName[m] || m),
    mag: clamp(ev.mag),
    checked: ev.checked ?? null,
  };
}

// ---------- 2026 indicators CSV ----------
export const CENTROIDS = {
  Afghanistan: [66, 33.5], Argentina: [-64, -34], Australia: [134, -25.5], Brazil: [-53, -10.5], Cambodia: [105, 12.5],
  Canada: [-100, 58], Chad: [18.5, 15.5], China: [104, 35.5], Colombia: [-74, 4.5], Cuba: [-79.5, 21.5],
  'Democratic Republic of the Congo': [24, -2.5], Denmark: [10, 56], Ecuador: [-78.5, -1.5], Eritrea: [39, 15.2],
  Ethiopia: [39, 9], 'European NATO member countries': [10, 50], Finland: [26, 64], France: [2.3, 46.5], Germany: [10.4, 51],
  Greenland: [-42, 72], Haiti: [-72.7, 19], India: [78, 22], Iran: [53.5, 32.5], Iraq: [43.7, 33.2], Israel: [35, 31.5],
  Japan: [138, 36.5], Jordan: [36.5, 31.2], Lebanon: [35.9, 33.9], Libya: [17.5, 27], Mali: [-2, 17.5],
  'Multiple countries': [0, 20], Myanmar: [96, 20], Netherlands: [5.3, 52.2], 'North Korea': [127, 40], Norway: [9, 61],
  Oman: [56, 21], Pakistan: [69, 30], Palestine: [34.4, 31.4], Paraguay: [-58, -23.5], Philippines: [122, 12.5],
  Qatar: [51.2, 25.3], Russia: [60, 60], Rwanda: [29.9, -2], 'Saudi Arabia': [45, 24], Somalia: [46, 5.5],
  'South Korea': [127.8, 36.5], 'South Sudan': [30, 7], Sudan: [30, 15.5], Sweden: [16, 62], Switzerland: [8.2, 46.8],
  Syria: [38.5, 35], Taiwan: [121, 23.7], Thailand: [101, 15.5], Turkey: [35, 39], Ukraine: [31, 49],
  'United Arab Emirates': [54, 24], 'United Kingdom': [-2, 54], 'United States': [-98, 39], Uruguay: [-56, -33],
  Venezuela: [-66.6, 7.1], Yemen: [47.5, 15.5], Bahrain: [50.55, 26], Kuwait: [47.7, 29.3], Egypt: [30, 27],
  Mexico: [-102, 23.5], Nigeria: [8, 9.5], 'South Africa': [25, -29], Indonesia: [117, -2.5], Vietnam: [106, 16],
  Poland: [19.5, 52], Italy: [12.5, 42.5], Spain: [-3.7, 40.4], Greece: [22, 39], Armenia: [45, 40.2], Azerbaijan: [47.5, 40.4],
  Georgia: [43.5, 42.3], Belarus: [28, 53.7], Kazakhstan: [67, 48], Niger: [8, 17.5], 'Burkina Faso': [-1.5, 12.3],
  Kenya: [37.9, 0.2], Uganda: [32.3, 1.4], Tanzania: [35, -6.4], Mozambique: [35.5, -18.7], Angola: [17.9, -12.3],
  Peru: [-75, -9.2], Chile: [-71, -35], Bolivia: [-64.7, -16.7], Nicaragua: [-85.2, 12.9], Guatemala: [-90.4, 15.8],
  Panama: [-80.1, 8.5], Honduras: [-86.6, 14.8], 'El Salvador': [-88.9, 13.8], 'Sri Lanka': [80.7, 7.9], Bangladesh: [90.4, 23.7],
  Nepal: [84.1, 28.4], Malaysia: [102, 4.2], Singapore: [103.8, 1.35], Laos: [102.5, 18], Mongolia: [104, 46.9],
  Hungary: [19.5, 47.2], 'Czech Republic': [15.5, 49.8], Austria: [14.5, 47.5], Romania: [25, 45.9], Bulgaria: [25.5, 42.7],
  Serbia: [20.9, 44], Croatia: [16, 45.2], 'Bosnia and Herzegovina': [17.7, 44], Kosovo: [20.9, 42.6], Albania: [20.1, 41.2],
  Portugal: [-8, 39.5], Ireland: [-8, 53.3], Iceland: [-18, 65], Belgium: [4.5, 50.8], Luxembourg: [6.1, 49.8],
  Estonia: [25.5, 58.7], Latvia: [24.6, 56.9], Lithuania: [23.9, 55.2], Moldova: [28.4, 47.2], Cyprus: [33.4, 35.1],
  Morocco: [-6, 32], Algeria: [2.6, 28], Tunisia: [9.5, 34], Senegal: [-14.5, 14.5], Ghana: [-1, 8], Cameroon: [12.4, 5.7],
  'Central African Republic': [20.9, 6.6], Zimbabwe: [29.9, -19], Zambia: [27.8, -13.1], Madagascar: [46.9, -19.4],
  Cabo_Verde: [-23.6, 16], 'New Zealand': [172.5, -41.5], 'Papua New Guinea': [144, -6.3], Fiji: [178, -17.8],
  Tonga: [-175.2, -21.2], Vanuatu: [167, -16], 'Solomon Islands': [160, -9.6],
};

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.replace(/^﻿/, ''), r[i] ?? ''])));
}

const ARC_SUBS = new Set(['Trade coercion and sanctions', 'Diplomacy and crisis management']);

function metricBump(value, unit) {
  const v = Number(value);
  if (!value || Number.isNaN(v)) return 0;
  const u = unit.toLowerCase();
  if (u === 'people') return v >= 1e6 ? 2 : v >= 1e4 ? 1 : 0;
  if (u === 'percent') return v >= 50 ? 1 : 0;
  if (u.includes('billion')) return v >= 100 ? 2 : v >= 10 ? 1 : 0;
  if (u === 'warheads' || u === 'million barrels' || u === 'troops') return 1;
  return 0;
}

function metricText(r) {
  if (!r.metric_value) return '';
  const v = Number(r.metric_value);
  const num = Number.isNaN(v) ? r.metric_value : v.toLocaleString('en-US');
  const q = r.metric_qualifier && r.metric_qualifier !== 'exact' ? `${r.metric_qualifier} ` : '';
  return `${q}${num} ${r.metric_unit}`.trim();
}

function fromCsv(r) {
  const sub = r.indicator_category;
  const title = r.event_title;
  const group = /health|dialysis|malnutrition/i.test(title) ? 'Health' : SUB_TO_GROUP[sub] || 'Political';
  const dir = r.indicator_direction_analyst_assessment;
  const base = { Escalatory: 3, Mixed: 2, 'De-escalatory': 2, Contextual: 1 }[dir] ?? 2;
  const mag = clamp(base + (sub === 'Interstate combat and intervention' ? 1 : 0) + metricBump(r.metric_value, r.metric_unit));
  const countries = r.countries_or_territories.split(';').map((s) => s.trim()).filter(Boolean);
  const isGlobal = r.region === 'Global' || countries.includes('Multiple countries') || countries.length === 0;
  const anchorName = countries.find((c) => c !== 'United States' && c !== 'Multiple countries') || countries[0];
  const anchor = isGlobal && !anchorName ? [0, 20] : CENTROIDS[anchorName] || [0, 20];
  const global = isGlobal && (!anchorName || anchorName === 'Multiple countries');
  let arc = null;
  const named = countries.filter((c) => CENTROIDS[c] && c !== 'Multiple countries');
  if (named.length >= 2 && (group === 'War / conflict' || ARC_SUBS.has(sub))) {
    arc = [CENTROIDS[named[0]], CENTROIDS[named[1]]];
  }
  return {
    id: r.event_id, date: r.event_date, era: '2026', group, sub, dir, mag,
    title, note: r.reported_event_details,
    effects: [r.reported_economic_effects, r.reported_political_security_consequences, r.reported_humanitarian_effects].filter(Boolean).join(' '),
    implication: r.analytical_implications,
    mechanisms: r.war_causation_mechanisms.split(';').map((s) => s.trim()).filter(Boolean),
    metric: metricText(r), metricName: r.metric_name,
    countries: countries.filter((c) => c !== 'Multiple countries'),
    lon: global ? 0 : anchor[0], lat: global ? 20 : anchor[1],
    place: global ? 'Global' : anchorName, arc, global,
    source: { label: r.source_publisher, url: r.source_url },
    checked: r.as_of_date || null,
    limitations: r.limitations,
  };
}

// ---------- merge ----------
const repo = read('events.json').map(fromRepo);
const history = readdirSync(join(root, 'data')).filter((f) => /^history-.*\.json$/.test(f)).sort()
  .flatMap((f) => read(f).map(fromHistory));
const csv = parseCsv(readFileSync(join(root, 'data', 'indicators-2026.csv'), 'utf8')).map(fromCsv);

const all = [...repo, ...history, ...csv].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
const ids = new Set();
for (const ev of all) {
  if (ids.has(ev.id)) throw new Error(`duplicate id ${ev.id}`);
  ids.add(ev.id);
  if (!GROUPS.includes(ev.group)) throw new Error(`${ev.id}: group ${ev.group}`);
  if (!DIRS.includes(ev.dir)) throw new Error(`${ev.id}: dir ${ev.dir}`);
  if (!(ev.lon >= -180 && ev.lon <= 180 && ev.lat >= -90 && ev.lat <= 90)) throw new Error(`${ev.id}: lon/lat`);
}
writeFileSync(join(root, 'data', 'all-events.json'), JSON.stringify(all));
console.log(`wrote ${all.length} events (${repo.length} repo, ${history.length} history, ${csv.length} indicators)`);
