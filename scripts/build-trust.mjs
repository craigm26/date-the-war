// Build data/trust.json: public trust checks for every group the help list
// names. Nobody can measure corruption from outside an organization; these
// are the public signals that trouble tends to leave, each one repeatable by
// anyone with the linked tool. A group that fails a check is flagged and
// ranked below the ones that pass. No group is called corrupt here.
//
//   1. Tax-deductible: its US entity is on the IRS Publication 78 list.
//   2. Files in public: a recent Form 990 is published (IRS data via ProPublica).
//   3. Officer pay: officers' pay is at most 2% of total spending.
//   4. Paid fundraisers: outside fundraising fees are at most 5% of revenue.
//   5. Sanctions: the US entity's name is not on the Treasury OFAC SDN list.
//   6. Watchdog advisory: its Charity Navigator profile shows no CN Advisory.
//
// Needs `unzip` on PATH. Run monthly:  node scripts/build-trust.mjs
import { writeFileSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ORGS } from './build-help-orgs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 date-the-war';
const today = new Date().toISOString().slice(0, 10);
const thisYear = +today.slice(0, 4);
export const LIMITS = { officerPay: 0.02, fundraisingFees: 0.05, filingAgeYears: 3 };
export const SOURCES = {
  pub78: 'https://apps.irs.gov/pub/epostcard/data-download-pub78.zip',
  teos: 'https://apps.irs.gov/app/eos/',
  ofac: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV',
  ofacSearch: 'https://sanctionssearch.ofac.treas.gov/',
  propublica: 'https://projects.propublica.org/nonprofits/',
};

async function fetchOk(url, as = 'text') {
  const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return as === 'buffer' ? Buffer.from(await r.arrayBuffer()) : as === 'json' ? r.json() : r.text();
}
const fmtEin = (e) => `${e.slice(0, 2)}-${e.slice(2)}`;
const pct = (x) => `${(x * 100).toFixed(1)}%`;

// IRS Publication 78: every organization eligible to receive tax-deductible gifts.
const dir = mkdtempSync(join(tmpdir(), 'pub78-'));
writeFileSync(join(dir, 'p.zip'), await fetchOk(SOURCES.pub78, 'buffer'));
execFileSync('unzip', ['-o', '-q', 'p.zip'], { cwd: dir });
const txt = readdirSync(dir).find((f) => f.endsWith('.txt'));
const pub78Date = statSync(join(dir, txt)).mtime.toISOString().slice(0, 10);
const pub78 = new Map();
const wanted = new Set(ORGS.map((o) => o.us.ein.replace(/^0+/, '')));
for (const line of readFileSync(join(dir, txt), 'utf8').split('\n')) {
  const ein = line.slice(0, 9).replace(/^0+/, '');
  if (wanted.has(ein)) { const f = line.trim().split('|'); pub78.set(ein, { name: f[1], code: f[5] }); }
}

// Treasury's SDN list, names only, normalized.
const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\b(INC|INCORPORATED|THE|OF|FOR|USA|US)\b/g, ' ').replace(/\s+/g, ' ').trim();
const sdn = (await fetchOk(SOURCES.ofac)).split('\n').map((l) => norm((l.split('","')[1] || '').replace(/"/g, ''))).filter(Boolean);

const orgs = {};
for (const o of ORGS) {
  const ein = o.us.ein;
  const checks = [];
  const add = (id, label, pass, detail, link) => checks.push({ id, label, pass, detail, link });

  const p78 = pub78.get(ein.replace(/^0+/, ''));
  add('deductible', 'Tax-deductible in the US', !!p78,
    p78 ? `${p78.name}, EIN ${fmtEin(ein)}, is on the IRS Publication 78 list${p78.code === 'FORGN' ? ' (as a foreign-addressed organization)' : ''}.` : `EIN ${fmtEin(ein)} is not on the IRS Publication 78 list.`,
    SOURCES.teos);

  let pp = null;
  try { pp = await fetchOk(`https://projects.propublica.org/nonprofits/api/v2/organizations/${ein.replace(/^0+/, '')}.json`, 'json'); } catch (e) { console.error(o.id, e.message); }
  const f = pp && (pp.filings_with_data || [])[0];
  const page = `https://projects.propublica.org/nonprofits/organizations/${ein.replace(/^0+/, '')}`;
  if (f) {
    const age = thisYear - f.tax_prd_yr;
    add('files', 'Files its tax return in public', age <= LIMITS.filingAgeYears, `Form 990 for ${f.tax_prd_yr} is public.`, f.pdf_url || page);
    const op = f.totfuncexpns ? (f.compnsatncurrofcr || 0) / f.totfuncexpns : null;
    add('officerPay', `Officer pay at most ${pct(LIMITS.officerPay)} of spending`, op == null ? null : op <= LIMITS.officerPay,
      op == null ? 'Not reported.' : `Officers were paid ${pct(op)} of total spending in ${f.tax_prd_yr}.${op > LIMITS.officerPay && f.totfuncexpns < 20e6 ? ` It spent $${(f.totfuncexpns / 1e6).toFixed(1)} million that year; small charities usually show a higher share.` : ''}`, page);
    const ff = f.totrevenue ? (f.profndraising || 0) / f.totrevenue : null;
    add('fundraisers', `Paid outside fundraisers at most ${pct(LIMITS.fundraisingFees)} of revenue`, ff == null ? null : ff <= LIMITS.fundraisingFees,
      ff == null ? 'Not reported.' : `Professional fundraising fees were ${pct(ff)} of revenue in ${f.tax_prd_yr}.`, page);
  } else {
    add('files', 'Files its tax return in public', false, 'No Form 990 found in the IRS data ProPublica publishes.', page);
  }

  const n = norm(o.us.name.replace(/\(.*\)/, ''));
  const hit = sdn.some((x) => x === n || (n.length > 12 && x.includes(n)));
  add('sanctions', 'Not on the US sanctions list', !hit, hit ? 'A name match was found on the OFAC SDN list; check it by hand.' : 'No match on the Treasury OFAC SDN list.', SOURCES.ofacSearch);

  const cn = `https://www.charitynavigator.org/ein/${ein}`;
  let cnText = null;
  try { cnText = await fetchOk(cn); } catch (e) { console.error(o.id, 'Charity Navigator', e.message); }
  const advisory = cnText ? /CN Advisory/i.test(cnText) : null;
  add('advisory', 'No watchdog advisory', advisory == null ? null : !advisory,
    advisory == null ? 'Charity Navigator profile could not be read today.' : advisory ? 'Charity Navigator shows a CN Advisory on this profile. Read it before giving.' : 'No CN Advisory on its Charity Navigator profile.', cn);

  // Only link a US donate page that loads today.
  let usSite = null;
  if (o.us.site) { try { await fetchOk(o.us.site); usSite = o.us.site; } catch (e) { console.error(o.id, 'US donate page', e.message); } }
  const known = checks.filter((c) => c.pass !== null);
  orgs[o.id] = {
    usName: o.us.name, ein: fmtEin(ein), pub78Code: p78 ? p78.code : null, usSite,
    year: f ? f.tax_prd_yr : null, revenue: f ? f.totrevenue : null, expenses: f ? f.totfuncexpns : null,
    checks, passed: known.filter((c) => c.pass).length, total: known.length,
    flags: checks.filter((c) => c.pass === false).map((c) => c.label),
    links: { irs: SOURCES.teos, propublica: page, charityNavigator: cn, bbb: `https://give.org/search?term=${encodeURIComponent(o.us.name.replace(/\(.*\)/, '').trim())}` },
  };
  console.error(`${o.id}: ${orgs[o.id].passed}/${orgs[o.id].total}${orgs[o.id].flags.length ? ' flags: ' + orgs[o.id].flags.join('; ') : ''}`);
}

writeFileSync(join(root, 'data', 'trust.json'), JSON.stringify({
  checked: today, limits: LIMITS,
  sources: { ...SOURCES, pub78Date },
  method: 'Public signals only. Nobody can measure corruption from outside an organization; these checks look for the traces trouble tends to leave. A failed check is a reason to look closer, not a finding of wrongdoing.',
  orgs,
}, null, 1) + '\n');
console.log(`trust: ${Object.keys(orgs).length} groups checked`);
