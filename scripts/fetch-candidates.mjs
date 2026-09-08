// Pull the day's candidate items from a handful of RSS feeds, score them for
// conflict and stress relevance, and write data/inbox/YYYY-MM-DD.json.
// No dependencies. Run: node scripts/fetch-candidates.mjs [YYYY-MM-DD]
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const today = process.argv[2] || new Date().toISOString().slice(0, 10);

export const FEEDS = [
  { label: 'UN News', url: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml' },
  { label: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { label: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  // CENTCOM's own RSS endpoint answers every client with an empty 200 (checked
  // 2026-09-08), so its releases come in through the Defense Department feed.
  { label: 'U.S. Department of Defense', url: 'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=20' },
  { label: 'U.S. Department of State', url: 'https://www.state.gov/rss-feed/press-releases/feed/' },
  { label: 'UN Press', url: 'https://press.un.org/en/rss.xml' },
  { label: 'UK Ministry of Defence', url: 'https://www.gov.uk/government/organisations/ministry-of-defence.atom' },
  { label: 'International Crisis Group', url: 'https://www.crisisgroup.org/rss' },
];

// Words that mark an item as a possible indicator. Weight is rough on purpose.
const TERMS = [
  ['war', 3], ['strike', 2], ['airstrike', 3], ['missile', 3], ['drone', 2], ['ceasefire', 3], ['truce', 3], ['invasion', 3], ['offensive', 2],
  ['sanction', 3], ['tariff', 3], ['embargo', 3], ['blockade', 3], ['export ban', 3], ['Hormuz', 4], ['Red Sea', 2], ['pipeline', 2],
  ['mobiliz', 4], ['mobilis', 4], ['conscript', 4], ['reservist', 4], ['draft', 1], ['defense spending', 3], ['defence spending', 3], ['military budget', 3], ['rearm', 4],
  ['nuclear', 3], ['warhead', 3], ['treaty', 2], ['arms control', 3], ['NATO', 2], ['alliance', 2],
  ['famine', 4], ['hunger', 3], ['food prices', 3], ['harvest', 2], ['drought', 3], ['flood', 2], ['heat wave', 2], ['heatwave', 2], ['locust', 3], ['El Nino', 2], ['El Niño', 2],
  ['oil', 2], ['crude', 2], ['OPEC', 3], ['gas supply', 3], ['LNG', 2], ['rare earth', 4], ['critical mineral', 4], ['lithium', 2], ['cobalt', 2],
  ['refugee', 3], ['displaced', 3], ['migrant', 2], ['border', 1], ['water', 1], ['dam', 2], ['river', 1],
  ['coup', 4], ['martial law', 4], ['election', 1], ['protest', 2], ['uprising', 3], ['insurgen', 3], ['militia', 2], ['cyber', 2], ['hack', 2],
  ['default', 2], ['debt', 2], ['inflation', 2], ['IMF', 2], ['World Bank', 2], ['UCDP', 3], ['SIPRI', 3], ['IPC', 2], ['WFP', 2], ['FAO', 2], ['UNHCR', 3],
  ['Iran', 2], ['Ukraine', 2], ['Taiwan', 3], ['Gaza', 2], ['Sudan', 2], ['Yemen', 2], ['Korea', 2], ['Sahel', 2], ['Kashmir', 3],
];

function decode(s = '') {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function tag(xml, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
  return m ? decode(m[1]) : '';
}
function parseFeed(xml) {
  const items = [];
  for (const m of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const it = m[0];
    let link = tag(it, 'link');
    if (!link) { const h = /<link[^>]*href="([^"]+)"/i.exec(it); link = h ? h[1] : ''; }
    items.push({ title: tag(it, 'title'), link, published: tag(it, 'pubDate') || tag(it, 'published') || tag(it, 'updated'), summary: tag(it, 'description') || tag(it, 'summary') || tag(it, 'content') });
  }
  return items;
}
function score(text) {
  let s = 0;
  const lower = text.toLowerCase();
  for (const [term, w] of TERMS) if (lower.includes(term.toLowerCase())) s += w;
  return s;
}

const cutoff = Date.parse(`${today}T00:00:00Z`) - 36 * 3600 * 1000;
const out = [];
const seen = new Set();
for (const f of FEEDS) {
  try {
    const r = await fetch(f.url, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 date-the-war-daily' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { console.error(`${f.label}: HTTP ${r.status}`); continue; }
    const xml = await r.text();
    if (!xml.trim()) { console.error(`${f.label}: empty body`); continue; }
    let kept = 0;
    for (const it of parseFeed(xml)) {
      if (!it.link || seen.has(it.link)) continue;
      const t = Date.parse(it.published);
      if (!Number.isNaN(t) && t < cutoff) continue;
      const sc = score(`${it.title} ${it.summary}`);
      if (sc < 3) continue;
      seen.add(it.link);
      out.push({ source: f.label, title: it.title, link: it.link, published: Number.isNaN(t) ? null : new Date(t).toISOString(), summary: it.summary.slice(0, 600), score: sc });
      kept++;
    }
    console.error(`${f.label}: kept ${kept}`);
  } catch (e) {
    console.error(`${f.label}: ${e.message}`);
  }
}
out.sort((a, b) => b.score - a.score);
const top = out.slice(0, 40);
mkdirSync(join(root, 'data', 'inbox'), { recursive: true });
writeFileSync(join(root, 'data', 'inbox', `${today}.json`), JSON.stringify({ date: today, fetched: new Date().toISOString(), items: top }, null, 2));
console.log(`inbox ${today}: ${top.length} candidates from ${out.length} scored items`);
