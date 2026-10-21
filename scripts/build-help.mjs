// Build data/help.json: for each country in data/humanitarian.json, which
// UN agencies and NGOs have a working page about that country, plus the
// general ways to help. A link is kept only if it answers HTTP 200, still
// points at that country after redirects, and its page title names the
// country. Nothing here is a ranking or an endorsement; it is a checked list.
// Run monthly after build-humanitarian.py:  node scripts/build-help.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 date-the-war';
const today = new Date().toISOString().slice(0, 10);

import { ORGS } from './build-help-orgs.mjs';

// Slugs to try and words a page title may use for the country.
const ALIASES = {
  'Democratic Republic of the Congo': { slugs: ['democratic-republic-congo', 'drcongo', 'democratic-republic-of-the-congo', 'drc', 'dr-congo'], words: ['congo', 'drc'] },
  Palestine: { slugs: ['palestine', 'sop', 'state-of-palestine', 'occupied-palestinian-territory', 'israel-and-occupied-territories', 'gaza'], words: ['palestin', 'gaza', 'occupied territor'] },
  Myanmar: { slugs: ['myanmar', 'burma'], words: ['myanmar', 'burma'] },
  Turkey: { slugs: ['turkiye', 'turkey'], words: ['turkiye', 'turkey'] },
  'Ivory Coast': { slugs: ['cote-divoire', 'ivory-coast'], words: ['ivoire', 'ivory'] },
  'Central African Republic': { slugs: ['central-african-republic', 'car'], words: ['central african'] },
  Syria: { slugs: ['syria', 'syrian-arab-republic'], words: ['syria'] },
  Iran: { slugs: ['iran', 'iran-islamic-republic'], words: ['iran'] },
  Eswatini: { slugs: ['eswatini', 'swaziland'], words: ['eswatini', 'swaziland'] },
};
const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const plain = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&([a-z])(acute|grave|circ|uml|tilde);/gi, '$1').replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'");

// Some sites start refusing after a burst of requests; wait and try again
// before calling a link dead.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let attempt = 0; ; attempt++) {
    const r = await getOnce(url);
    if (r.status === 200 || r.status === 404 || attempt >= 2) return r;
    await sleep(4000 * (attempt + 1));
  }
}
async function getOnce(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const text = r.ok ? await r.text() : '';
    const title = decode((/<title[^>]*>([^<]*)/i.exec(text) || [, ''])[1]).trim();
    return { status: r.status, url: r.url, title, text };
  } catch (e) {
    return { status: 0, url, title: '', text: '' };
  }
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const hum = JSON.parse(readFileSync(join(root, 'data', 'humanitarian.json'), 'utf8'));
const countries = [...new Map(hum.countries.map((c) => [c.iso3, c])).values()];

// World Central Kitchen has no per-country pages: a country counts when its
// Relief page names it on the day this runs.
const relief = await get('https://wck.org/relief/');
const reliefText = plain(relief.text.replace(/<[^>]+>/g, ' '));

const result = {};
await pool(countries, 2, async (c) => {
  const al = ALIASES[c.country] || { slugs: [slugify(c.country)], words: [plain(c.country)] };
  const words = al.words.map(plain);
  const found = [];
  for (const org of ORGS) {
    if (org.id === 'unhcr') { if (c.displaced) found.push({ org: org.id, url: org.donate, general: true }); continue; }
    if (org.id === 'wck') {
      if (relief.status === 200 && words.some((w) => new RegExp(`(^|[^a-z])${w}`).test(reliefText))) found.push({ org: org.id, url: 'https://wck.org/relief/', general: true, note: 'Named on WCK\'s Relief page' });
      continue;
    }
    for (const s of al.slugs) {
      const r = await get(org.page(s));
      const stillThere = plain(decodeURIComponent(r.url)).includes(s);
      const named = words.some((w) => plain(r.title).includes(w));
      if (r.status === 200 && stillThere && named) { found.push({ org: org.id, url: r.url, title: r.title }); break; }
    }
  }
  result[c.iso3] = found;
  console.error(`${c.country}: ${found.filter((f) => !f.general).map((f) => f.org).join(', ') || 'no country pages'}`);
});

// The general ways to help. Each is re-checked; a dead one is reported and left out.
const GENERAL = {
  check: [
    ['Charity Navigator', 'https://www.charitynavigator.org/', 'Ratings and finances for US charities.'],
    ['BBB Wise Giving Alliance', 'https://give.org/', 'Checks charities against 20 accountability standards.'],
  ],
  civic: [
    ['Register or check your registration (USAGov)', 'https://www.usa.gov/register-to-vote', 'Official US government guide, by state.'],
    ['VOTE411', 'https://www.vote411.org/', 'Nonpartisan voter guide from the League of Women Voters Education Fund.'],
    ['Ballotpedia', 'https://ballotpedia.org/Main_Page', 'Nonpartisan encyclopedia of candidates and ballot measures.'],
    ['Find your US Representative', 'https://www.house.gov/representatives/find-your-representative', 'Look up by ZIP code.'],
    ['Contact your US Senators', 'https://www.senate.gov/senators/senators-contact.htm', 'Phone, mail and web forms.'],
    ['Find and contact elected officials (USAGov)', 'https://www.usa.gov/elected-officials', 'Federal, state and local.'],
    ['National parliaments worldwide (IPU)', 'https://www.ipu.org/national-parliaments', 'Outside the US: find your parliament and its members.'],
  ],
  act: [
    ['Map for responders (HOT Tasking Manager)', 'https://tasks.hotosm.org/', 'Trace roads and buildings from satellite imagery so aid teams can find people. Remote, free training.'],
    ['Missing Maps', 'https://missingmaps.org/', 'Mapping events and beginner guides for the same work.'],
    ['Translators without Borders', 'https://translatorswithoutborders.org/meet-the-twb-community/', 'Volunteer translation for aid groups.'],
    ['Volunteer with refugees near you (IRC)', 'https://www.rescue.org/volunteer', 'Help families who have already arrived.'],
    ['Volunteer with the American Red Cross', 'https://www.redcross.org/volunteer/become-a-volunteer.html', 'Local disaster response and blood drives.'],
  ],
};
const general = {};
for (const [k, list] of Object.entries(GENERAL)) {
  general[k] = [];
  for (const [name, url, what] of list) {
    const r = await get(url);
    if (r.status === 200) general[k].push({ name, url, what }); else console.error(`left out ${name}: HTTP ${r.status}`);
  }
}
const orgs = {};
for (const o of ORGS) {
  const r = await get(o.donate);
  orgs[o.id] = { name: o.name, kind: o.kind, what: o.what, donate: r.status === 200 ? o.donate : null };
  if (r.status !== 200) console.error(`donate link for ${o.name}: HTTP ${r.status}`);
}

writeFileSync(join(root, 'data', 'help.json'), JSON.stringify({ checked: today, basedOn: hum.source.edition, orgs, countries: result, general }, null, 1) + '\n');
const n = Object.values(result).reduce((a, l) => a + l.filter((f) => !f.general).length, 0);
console.log(`help: ${countries.length} countries, ${n} checked country pages, WCK relief page ${relief.status}`);
await import('./build-help-md.mjs');
