// Pure window logic. No DOM. Imported by the page and by the tests.
import { theaterOf, theater } from './theaters.js';

export const RANGE_START = '1900-01-01';
// The end of the record moves every day the daily job runs; the page sets it
// from data/meta.json. Tests set it from the events file.
export let RANGE_END = '2026-09-08';
export function setRangeEnd(iso) { RANGE_END = iso; }
export const SCALES = ['day', 'week', 'month', 'year'];
export const GROUPS = ['War / conflict', 'Economic', 'Political', 'Social', 'Environmental', 'Technology', 'Health'];
export function eras() {
  return [
    { label: '1914', from: '1914-06-01', scale: 'month' },
    { label: '1939', from: '1931-09-01', scale: 'month' },
    { label: 'Since 2011', from: '2011-01-01', scale: 'year' },
    { label: 'This week', from: RANGE_END, scale: 'week' },
  ];
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function clampDate(iso, lo = RANGE_START, hi = RANGE_END) {
  return iso < lo ? lo : iso > hi ? hi : iso;
}

// Weeks run Monday to Sunday.
export function unitStart(iso, scale) {
  if (scale === 'week') return addDays(iso, -((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7));
  return scale === 'day' ? iso : scale === 'month' ? `${iso.slice(0, 8)}01` : `${iso.slice(0, 5)}01-01`;
}

export function addUnit(iso, scale, n) {
  if (scale === 'day') return addDays(iso, n);
  if (scale === 'week') return addDays(iso, 7 * n);
  const d = new Date(`${iso}T00:00:00Z`);
  if (scale === 'month') d.setUTCMonth(d.getUTCMonth() + n);
  else d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}

export function windowBounds({ from, scale, cumulative }) {
  const start = unitStart(from, scale);
  const end = clampDate(addDays(addUnit(start, scale, 1), -1));
  return { start: cumulative ? RANGE_START : start, end, unit: start };
}

export function passes(ev, { groupsOff = {}, subsOff = {}, theater: th = null }) {
  return !groupsOff[ev.group] && !subsOff[ev.sub] && (!th || theaterOf(ev) === th);
}

// Events inside the window, newest first.
export function windowEvents(events, state) {
  const { start, end } = windowBounds(state);
  return events
    .filter((ev) => ev.date >= start && ev.date <= end && passes(ev, state))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : 1));
}

// Next event after the window (dir > 0) or before it (dir < 0), respecting filters.
export function jumpTarget(events, state, dir) {
  const { unit, end } = windowBounds(state);
  const evs = events.filter((ev) => passes(ev, state));
  return dir > 0 ? evs.find((ev) => ev.date > end) : [...evs].reverse().find((ev) => ev.date < unit);
}

// One bucket per year for the strip: count, and whether the year is in the window.
export function yearStrip(events, state) {
  const { unit, end, start } = windowBounds(state);
  const per = {};
  for (const ev of events) if (passes(ev, state)) per[ev.date.slice(0, 4)] = (per[ev.date.slice(0, 4)] || 0) + 1;
  const max = Math.max(1, ...Object.values(per));
  const y0 = +RANGE_START.slice(0, 4);
  const y1 = +RANGE_END.slice(0, 4);
  const yFrom = +(state.cumulative ? start : unit).slice(0, 4);
  const yEnd = +end.slice(0, 4);
  const out = [];
  for (let y = y0; y <= y1; y++) {
    const n = per[y] || 0;
    out.push({ year: y, n, inWindow: y >= yFrom && y <= yEnd, h: n ? Math.max(3, Math.round(Math.sqrt(n / max) * 42)) : 1 });
  }
  return out;
}

// Up to three related events: same indicator, or same place with an arc, within 400 days.
export function related(events, ev) {
  return events
    .filter((o) => o.id !== ev.id && (o.sub === ev.sub || (ev.arc && o.arc && o.place === ev.place)) && Math.abs(daysBetween(ev.date, o.date)) <= 400)
    .sort((a, b) => Math.abs(daysBetween(ev.date, a.date)) - Math.abs(daysBetween(ev.date, b.date)))
    .slice(0, 3);
}

export function fmt(iso, style) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (style === 'week') return `Week of ${fmt(iso, 'day')}`;
  const o = style === 'day' ? { day: 'numeric', month: 'short', year: 'numeric' }
    : style === 'month' ? { month: 'long', year: 'numeric' }
    : { year: 'numeric' };
  return dt.toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });
}

export function parseHash(hash) {
  const m = /^#?(day|week|month|year)@(\d{4}-\d{2}-\d{2})((?:@(?:c|flat|sev|reel|t=[a-z]+))*)$/.exec(hash || '');
  if (!m) return null;
  const flags = m[3].split('@').filter(Boolean);
  const t = flags.find((f) => f.startsWith('t='));
  const th = t && theater(t.slice(2)) ? t.slice(2) : null;
  return { scale: m[1], from: clampDate(m[2]), cumulative: flags.includes('c'), view: flags.includes('flat') ? 'flat' : 'globe', layer: flags.includes('sev') ? 'sev' : 'events', reel: flags.includes('reel'), theater: th };
}

export function toHash({ scale, from, cumulative, view, layer, reel, theater: th }) {
  return `#${scale}@${from}${cumulative ? '@c' : ''}${view === 'flat' ? '@flat' : ''}${layer === 'sev' ? '@sev' : ''}${th ? `@t=${th}` : ''}${reel ? '@reel' : ''}`;
}

// The reel: a flyover of the window's events, oldest first, paced slowly.
// Timings in milliseconds. Pure so the tests can check the plan.
export const REEL = { intro: 2600, fly: 1600, dwell: 4600, fade: 500, outro: 3200 };
export function reelPlan(events, state) {
  const items = [...windowEvents(events, state)].reverse();
  const steps = [{ kind: 'intro', ms: REEL.intro }];
  for (const ev of items) steps.push({ kind: 'event', ev, ms: REEL.fly + REEL.dwell + REEL.fade });
  steps.push({ kind: 'outro', ms: REEL.outro });
  return { items, steps, total: steps.reduce((a, s) => a + s.ms, 0) };
}
