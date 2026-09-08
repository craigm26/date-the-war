// Pure dating logic. No DOM. Imported by the page and by the tests.

export function inWindow(ev, from, to) {
  return ev.date >= from && ev.date <= to;
}

export function eventsIn(events, from, to, eventEras) {
  return events
    .filter((ev) => (!eventEras || eventEras.includes(ev.era)) && inWindow(ev, from, to))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function activeTheaters(events) {
  return [...new Set(events.map((ev) => ev.theater))];
}

export function linksFormed(events) {
  const seen = new Set();
  const out = [];
  for (const ev of events) {
    if (!ev.link) continue;
    const key = [...ev.link].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from: ev.link[0], to: ev.link[1], date: ev.date, eventId: ev.id });
  }
  return out;
}

// `combat` on an event is two sides: [[powers on side A], [powers on side B]].
// A coalition on one side is not fighting itself.
export function combatSides(ev) {
  const [a = [], b = []] = ev.combat || [];
  return [a, b];
}

// Pairs of major powers that fired on each other directly inside the window.
export function majorPowerPairs(events, majorPowers) {
  const seen = new Set();
  const out = [];
  for (const ev of events) {
    const [a, b] = combatSides(ev);
    for (const p of a.filter((x) => majorPowers.includes(x))) {
      for (const q of b.filter((x) => majorPowers.includes(x))) {
        const key = [p, q].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ pair: [p, q], date: ev.date, eventId: ev.id });
      }
    }
  }
  return out;
}

// Powers in direct combat with anyone, major or not.
export function powersInCombat(events) {
  return [...new Set(events.flatMap((ev) => combatSides(ev).flat()))];
}

export function mechanismCounts(events) {
  const counts = {};
  for (const ev of events) for (const m of ev.mechanisms || []) counts[m] = (counts[m] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([id, n]) => ({ id, n }));
}

// The rule, stated so a reader can disagree with it:
//   general  = at least one pair of major powers fighting each other directly,
//              in at least two theaters
//   linked   = no such pair, but at least one link between theaters
//   regional = neither
export const RULE = {
  general: 'At least one pair of major powers in direct combat with each other, across two or more theaters.',
  linked: 'No two major powers fighting each other directly, but at least one theater feeding another.',
  regional: 'Fighting confined to one theater, with no cross-theater links.',
};

export function classify({ theaters, pairs, links }) {
  if (pairs.length >= 1 && theaters.length >= 2) return 'general';
  if (links.length >= 1) return 'linked';
  return 'regional';
}

export function verdict(events, from, to, { majorPowers, eventEras }) {
  const evs = eventsIn(events, from, to, eventEras);
  const theaters = activeTheaters(evs);
  const links = linksFormed(evs);
  const pairs = majorPowerPairs(evs, majorPowers);
  const powers = powersInCombat(evs);
  const mechanisms = mechanismCounts(evs);
  const label = classify({ theaters, pairs, links });
  return { from, to, events: evs, theaters, links, pairs, powers, mechanisms, label, rule: RULE[label] };
}

// Date arithmetic on ISO strings, UTC, no library.
export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function clampDate(iso, lo, hi) {
  return iso < lo ? lo : iso > hi ? hi : iso;
}
