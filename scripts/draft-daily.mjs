// Turn the day's inbox into ledger entries with the Claude Code CLI, then
// validate them hard before anything is written. Run after fetch-candidates.
//   node scripts/draft-daily.mjs [YYYY-MM-DD]
// Writes data/daily/YYYY-MM-DD.json (up to 8 entries) or nothing.
// Every entry is marked auto: true and checked: <today>; the page shows
// "auto" on those rows so a reader knows they have not been reviewed.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CENTROIDS, SUB_TO_GROUP, DIRS } from './build-events.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const today = process.argv[2] || new Date().toISOString().slice(0, 10);
const inboxPath = join(root, 'data', 'inbox', `${today}.json`);
if (!existsSync(inboxPath)) { console.log('no inbox for', today); process.exit(0); }
const inbox = JSON.parse(readFileSync(inboxPath, 'utf8'));
if (!inbox.items.length) { console.log('inbox empty'); process.exit(0); }

const all = JSON.parse(readFileSync(join(root, 'data', 'all-events.json'), 'utf8'));
const knownUrls = new Set(all.map((e) => e.source.url));
const recentTitles = all.filter((e) => e.date >= new Date(Date.parse(today) - 5 * 864e5).toISOString().slice(0, 10)).map((e) => `${e.date} ${e.title}`);
const mechanisms = JSON.parse(readFileSync(join(root, 'data', 'mechanisms.json'), 'utf8')).map((m) => m.id);
const SUBS = Object.keys(SUB_TO_GROUP);

const prompt = `You curate a public ledger of sourced events that bear on how wars start, widen, or end (a page called "Date the war"). Below are today's candidate news items. Select up to 8 that are genuine indicators: direct combat, ceasefires, sanctions and tariffs, mobilization and defense budgets, nuclear and arms control, famine and food prices, drought, floods and heat, water disputes, oil and gas supply, critical minerals, displacement, coups and legitimacy crises, major diplomacy. Skip celebrity, sport, crime, and anything already covered by the recent entries listed.

House rule, no exceptions: no individual person's name anywhere in a title or note. Refer to people by role ("Canada's prime minister", "a Bosnian Serb wartime commander convicted of genocide", "Ukraine's president"). Company, agency and country names are fine.

Return ONLY a JSON array. Each element:
{
  "id": "d-${today.replace(/-/g, '')}-<short-slug>",
  "date": "${today}" (or the actual event date if the item says it happened within the last 3 days),
  "sub": one of ${JSON.stringify(SUBS)},
  "dir": one of ${JSON.stringify(DIRS)},
  "mag": integer 1-5 (Escalatory 3, Mixed 2, De-escalatory 2, Contextual 1; +1 for direct interstate combat; +1 when a reported number is large, at least 10,000 people or 50 percent or 10 billion; +2 for at least 1,000,000 people or 100 billion; declared war between major powers is 5),
  "title": at most 80 characters, plain, present tense, NO individual person's name (write "the US president", "Iran's foreign minister"),
  "note": one or two sentences stating what the source reports and why it matters for war or peace; no person's name; no em-dash character; no hype,
  "mechanisms": array (may be empty) from ${JSON.stringify(mechanisms)},
  "countries": array of country names, using these spellings when possible: ${JSON.stringify(Object.keys(CENTROIDS))},
  "place": a short place label,
  "lon": number, "lat": number (the place; use 0 and 20 for world-wide items),
  "global": true only for world-wide items,
  "arc": null, or [[lon,lat],[lon,lat]] when one actor acts on another,
  "metric": "" or the reported number with unit as text (e.g. "about 12,000 people", "35 percent", "2.5 USD billion"),
  "metricName": "" or what the number measures,
  "source": {"label": the publisher name given, "url": the item's link exactly as given},
  "limitations": one short sentence on what the source cannot establish (attribution, contested figures, single-source).
}

Recent entries already on the ledger (do not duplicate these topics):
${recentTitles.slice(-40).join('\n')}

Candidate items:
${JSON.stringify(inbox.items.map(({ source, title, link, published, summary }) => ({ source, title, link, published, summary })), null, 1)}`;

let raw;
try {
  raw = execFileSync(process.env.CLAUDE_BIN || 'claude', ['-p', '--model', process.env.DTW_MODEL || 'sonnet', '--output-format', 'text', prompt], { encoding: 'utf8', timeout: 600000, maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
} catch (e) {
  console.error('claude failed:', e.message);
  process.exit(0);
}
const start = raw.indexOf('[');
const end = raw.lastIndexOf(']');
if (start < 0 || end < 0) { console.error('no JSON array in output'); process.exit(0); }
let drafts;
try { drafts = JSON.parse(raw.slice(start, end + 1)); } catch (e) { console.error('bad JSON:', e.message); process.exit(0); }

const linkSet = new Set(inbox.items.map((i) => i.link));
const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Math.abs(Date.parse(d) - Date.parse(today)) <= 3 * 864e5;
const kept = [];
const seenIds = new Set(all.map((e) => e.id));
for (const d of drafts) {
  const why = [];
  if (!d.id || seenIds.has(d.id) || !/^d-\d{8}-[a-z0-9-]+$/.test(d.id)) why.push('id');
  if (!okDate(d.date)) why.push('date');
  if (!SUBS.includes(d.sub)) why.push('sub');
  if (!DIRS.includes(d.dir)) why.push('dir');
  if (!Number.isInteger(d.mag) || d.mag < 1 || d.mag > 5) why.push('mag');
  if (typeof d.title !== 'string' || !d.title || d.title.length > 90) why.push('title');
  if (typeof d.note !== 'string' || !d.note) why.push('note');
  if (`${d.title} ${d.note}`.includes('—')) why.push('em-dash');
  if (!Array.isArray(d.mechanisms) || d.mechanisms.some((m) => !mechanisms.includes(m))) why.push('mechanisms');
  if (!(typeof d.lon === 'number' && typeof d.lat === 'number' && d.lon >= -180 && d.lon <= 180 && d.lat >= -90 && d.lat <= 90)) why.push('lonlat');
  if (!d.source || !linkSet.has(d.source.url)) why.push('source-url-not-from-inbox');
  if (d.source && knownUrls.has(d.source.url)) why.push('duplicate-url');
  if (d.arc && !(Array.isArray(d.arc) && d.arc.length === 2 && d.arc.every((p) => Array.isArray(p) && p.length === 2))) why.push('arc');
  if (why.length) { console.error(`dropped ${d.id || '?'}: ${why.join(', ')}`); continue; }
  let status = 0;
  try { status = (await fetch(d.source.url, { method: 'GET', headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000), redirect: 'follow' })).status; } catch { status = 0; }
  if (status !== 200) { console.error(`dropped ${d.id}: source HTTP ${status}`); continue; }
  seenIds.add(d.id);
  kept.push({
    id: d.id, date: d.date, era: 'daily', group: SUB_TO_GROUP[d.sub], sub: d.sub, dir: d.dir, mag: d.mag,
    title: d.title.trim(), note: d.note.trim(), mechanisms: d.mechanisms, countries: Array.isArray(d.countries) ? d.countries.filter((c) => typeof c === 'string') : [],
    lon: d.lon, lat: d.lat, place: String(d.place || d.countries?.[0] || 'Global'), arc: d.arc || null, global: !!d.global,
    metric: String(d.metric || ''), metricName: String(d.metricName || ''),
    source: { label: String(d.source.label || 'Source'), url: d.source.url },
    checked: today, auto: true,
    limitations: `${String(d.limitations || '').trim()} Drafted by an automated daily job from the linked report; not yet reviewed.`.trim(),
  });
  if (kept.length >= 8) break;
}
if (!kept.length) { console.log('nothing kept'); process.exit(0); }
mkdirSync(join(root, 'data', 'daily'), { recursive: true });
const outPath = join(root, 'data', 'daily', `${today}.json`);
const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : [];
const merged = [...existing, ...kept.filter((k) => !existing.some((e) => e.id === k.id || e.source.url === k.source.url))];
writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n');
console.log(`daily ${today}: ${kept.length} new, ${merged.length} total`);
