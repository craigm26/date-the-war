// The situation briefing: what the record says about the last few days.
// Pure. Imported by the page and by the tests.
import { addDays } from './timeline.js';
import { THEATERS, OTHER, theaterOf } from './theaters.js';

// Pressure counts an event's impact toward escalation; mixed events count
// half each way. Contextual rows describe conditions and count neither way.
export function pressure(ev) {
  if (ev.dir === 'Escalatory') return { up: ev.mag, down: 0 };
  if (ev.dir === 'De-escalatory') return { up: 0, down: ev.mag };
  if (ev.dir === 'Mixed') return { up: ev.mag / 2, down: ev.mag / 2 };
  return { up: 0, down: 0 };
}

// One bucket per day for the `days` days ending on `end`, oldest first.
export function dailyPulse(events, end, days, pick = () => true) {
  const start = addDays(end, -(days - 1));
  const out = [];
  const byDay = {};
  for (let i = 0; i < days; i++) { const d = addDays(start, i); byDay[d] = { date: d, n: 0, up: 0, down: 0 }; out.push(byDay[d]); }
  for (const ev of events) {
    const b = byDay[ev.date];
    if (!b || !pick(ev)) continue;
    const p = pressure(ev);
    b.n += 1; b.up += p.up; b.down += p.down;
  }
  return out;
}

function totals(buckets) {
  return buckets.reduce((a, b) => ({ n: a.n + b.n, up: a.up + b.up, down: a.down + b.down }), { n: 0, up: 0, down: 0 });
}

// Compare the last 7 days with the 7 before. "Hotter" needs a clear margin:
// a couple of extra reports on a quiet week is not a trend.
export function trend(cur, prev) {
  const a = cur.up - cur.down;
  const b = prev.up - prev.down;
  const margin = Math.max(3, Math.abs(b) * 0.25);
  if (cur.n === 0 && prev.n === 0) return 'quiet';
  if (a > b + margin) return 'hotter';
  if (a < b - margin) return 'cooler';
  return 'steady';
}

export function summarize(events, end) {
  const today = events.filter((e) => e.date === end);
  const pulse = dailyPulse(events, end, 14);
  const week = totals(pulse.slice(7));
  const prevWeek = totals(pulse.slice(0, 7));
  const theaters = [...THEATERS, OTHER].map((t) => {
    const mine = (ev) => theaterOf(ev) === t.id;
    const p = dailyPulse(events, end, 30, mine);
    const cur = totals(p.slice(-7));
    const prev = totals(p.slice(-14, -7));
    const latest = events.filter((ev) => ev.date <= end && mine(ev)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.mag - a.mag))[0] || null;
    return { ...t, spark: p, week: cur, prevWeek: prev, trend: trend(cur, prev), latest, today: today.filter(mine).length };
  });
  // busiest first by this week's pressure; worldwide rows last
  theaters.sort((a, b) => (a.id === 'other') - (b.id === 'other') || (b.week.up + b.week.down) - (a.week.up + a.week.down) || b.week.n - a.week.n);
  return {
    end,
    today: { n: today.length, esc: today.filter((e) => e.dir === 'Escalatory').length, des: today.filter((e) => e.dir === 'De-escalatory').length },
    week, prevWeek, trend: trend(week, prevWeek), theaters,
  };
}

// One plain sentence for the top of the page.
export function headline(s) {
  const t = s.today;
  const parts = [];
  parts.push(t.n ? `${t.n} new ${t.n === 1 ? 'event' : 'events'} on the latest day: ${t.esc} escalatory, ${t.des} de-escalatory.` : 'No new events on the latest day.');
  const words = { hotter: 'more escalatory than the week before', cooler: 'calmer than the week before', steady: 'about the same as the week before', quiet: 'quiet' };
  parts.push(`The last 7 days (${s.week.n} events) read ${words[s.trend]}.`);
  const busy = s.theaters.filter((x) => x.id !== 'other' && x.week.n > 0).slice(0, 2).map((x) => x.label);
  if (busy.length) parts.push(`Most active: ${busy.join(' and ')}.`);
  return parts.join(' ');
}
