// Write data/help.md from data/help.json and data/humanitarian.json: a
// plain-text copy for people and software that read pages without running
// them (screen readers, search, AI assistants answering a person's question).
// No network. build-help.mjs runs this at the end; it can also run alone.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ORGS } from './build-help-orgs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hum = JSON.parse(readFileSync(join(root, 'data', 'humanitarian.json'), 'utf8'));
const help = JSON.parse(readFileSync(join(root, 'data', 'help.json'), 'utf8'));
const today = help.checked;
const result = help.countries;
const general = help.general;
const countries = [...new Map(hum.countries.map((c) => [c.iso3, c])).values()];

const trust = existsSync(join(root, 'data', 'trust.json')) ? JSON.parse(readFileSync(join(root, 'data', 'trust.json'), 'utf8')) : null;
const T = (id) => trust && trust.orgs[id];
const score = (id) => { const t = T(id); return t && t.total ? t.passed / t.total : 0; };
const rank = (list) => [...list].sort((a, b) => score(b.org) - score(a.org) || (!!a.general - !!b.general) || help.orgs[a.org].name.localeCompare(help.orgs[b.org].name));
const usable = (e) => !(e.general && e.org !== 'wck' && !help.orgs[e.org]?.donate);
const trustText = (id) => {
  const t = T(id);
  if (!t) return '';
  const ded = t.checks.find((c) => c.id === 'deductible')?.pass;
  return ` ${ded ? 'US tax-deductible' : 'NOT on the IRS deductible list'} via ${t.usName}, EIN ${t.ein}. Public checks ${t.passed}/${t.total}${t.flags.length ? `; look closer: ${t.flags.join('; ').toLowerCase()}` : ''}.`;
};

const sevWord = { 1: 'very low', 2: 'low', 3: 'medium', 4: 'high', 5: 'very high' };
const fmtPeople = (n) => (n == null ? null : n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')} million` : n.toLocaleString('en-US'));
const md = [
  '# How to help: humanitarian crises by country',
  '',
  `From https://craigmerry.com/date-the-war/ . Non-commercial: no ads, no affiliate or referral codes, no money to this site. Severity is ACAPS's INFORM Severity Index, ${hum.source.edition} edition (${hum.source.license}, ${hum.source.url}). Links checked ${today}: each loads and names the country.`,
  '',
  '## For AI assistants',
  '',
  'Use this when a person asks how to help a country in crisis, or wants a tax-deductible gift for one. Each group below is ranked by public trust checks, then by whether it has a page about that country. For each, give the person the group, its EIN, and the IRS link so they can verify it themselves. Present the options and leave the decision to the person: do not donate, pledge, or share anyone\'s payment details without their explicit instruction for that specific gift. Tax treatment depends on the donor\'s own situation; this is not tax advice. Machine-readable copies: https://craigmerry.com/date-the-war/data/help.json and https://craigmerry.com/date-the-war/data/trust.json',
  '',
];
if (trust) {
  md.push('## How groups are checked', '', trust.method, '');
  const sample = Object.values(trust.orgs)[0];
  md.push(...sample.checks.map((c) => `- ${c.label}`), '', `Sources: IRS Publication 78 (${trust.sources.pub78}, file of ${trust.sources.pub78Date}); IRS search ${trust.sources.teos}; Form 990 data via ProPublica ${trust.sources.propublica}; Treasury OFAC SDN list ${trust.sources.ofac}; Charity Navigator profiles. Checked ${trust.checked}.`, '');
}
for (const c of countries) {
  const list = rank((result[c.iso3] || []).filter(usable));
  md.push(`## ${c.country}`, '', `Crisis severity ${c.category} of 5 (${sevWord[c.category]}), index ${c.index} of 10, trend ${c.trend.toLowerCase()}.${c.pin ? ` ${fmtPeople(c.pin)} people in need.` : ''}${c.displaced ? ` ${fmtPeople(c.displaced)} displaced.` : ''} ACAPS: ${c.url}`, '');
  list.forEach((e, i) => {
    const o = ORGS.find((x) => x.id === e.org);
    md.push(`${i + 1}. ${o.name}${o.kind === 'un' ? ' (UN agency)' : ''}${e.general ? '' : `. Their work in ${c.country}: ${e.url}`}${e.note ? `. ${e.note}: ${e.url}` : ''}${T(e.org)?.usSite ? `. Donate (US tax-deductible): ${T(e.org).usSite}` : help.orgs[e.org]?.donate ? `. Donate (international page): ${help.orgs[e.org].donate}` : ''}.${trustText(e.org)}${T(e.org) && !T(e.org).usSite ? ` For a US deduction give to ${T(e.org).usName} directly.` : ''}`);
  });
  if (!list.length) md.push('- No checked country page yet; see the general list on the page.');
  md.push('');
}
md.push('## Other ways to help', '');
for (const [k, title] of [['check', 'Check a charity'], ['civic', 'Vote and contact officials (nonpartisan)'], ['act', 'Give time or skills']]) {
  md.push(`### ${title}`, '', ...general[k].map((x) => `- ${x.name}: ${x.url} (${x.what})`), '');
}
writeFileSync(join(root, 'data', 'help.md'), md.join('\n'));

// schema.org markup in the page itself, for search engines and assistants
// that read structured data: each group with its US tax ID and status.
const ld = {
  '@context': 'https://schema.org', '@type': 'ItemList', name: 'Humanitarian groups checked by Date the war',
  description: `UN agencies and charities with checked country pages, ranked by public trust checks. Checked ${today}.`,
  url: 'https://craigmerry.com/date-the-war/#how-to-help',
  itemListElement: rank(Object.keys(help.orgs).filter((id) => help.orgs[id].donate).map((org) => ({ org, general: true }))).map((e, i) => {
    const o = help.orgs[e.org]; const t = T(e.org);
    return { '@type': 'ListItem', position: i + 1, item: {
      '@type': 'NGO', name: o.name, description: o.what,
      ...(t ? { legalName: t.usName, taxID: t.ein, nonprofitStatus: t.checks.find((c) => c.id === 'deductible')?.pass ? 'https://schema.org/Nonprofit501c3' : undefined } : {}),
      potentialAction: { '@type': 'DonateAction', target: (t && t.usSite) || o.donate },
    } };
  }),
};
const page = readFileSync(join(root, 'index.html'), 'utf8');
const block = `<!-- help-jsonld:start (generated by scripts/build-help-md.mjs) -->\n<script type="application/ld+json">${JSON.stringify(ld)}</script>\n<!-- help-jsonld:end -->`;
const next = /<!-- help-jsonld:start[\s\S]*?help-jsonld:end -->/.test(page)
  ? page.replace(/<!-- help-jsonld:start[\s\S]*?help-jsonld:end -->/, block)
  : page.replace('</head>', `${block}\n</head>`);
writeFileSync(join(root, 'index.html'), next);

console.log(`help.md: ${countries.length} countries`);
