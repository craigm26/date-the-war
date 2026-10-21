import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setRangeEnd, unitStart, addUnit, windowBounds, windowEvents, fmt } from '../src/timeline.js';
import { theaterOf, THEATERS } from '../src/theaters.js';
import { pressure, dailyPulse, trend, summarize, headline } from '../src/briefing.js';

const root = new URL('..', import.meta.url);
const all = JSON.parse(readFileSync(new URL('data/all-events.json', root), 'utf8'));
const meta = JSON.parse(readFileSync(new URL('data/meta.json', root), 'utf8'));
setRangeEnd(meta.asOf);

test('weeks run Monday to Sunday', () => {
  assert.equal(unitStart('2026-10-21', 'week'), '2026-10-19');   // a Wednesday
  assert.equal(unitStart('2026-10-19', 'week'), '2026-10-19');   // a Monday
  assert.equal(unitStart('2026-10-25', 'week'), '2026-10-19');   // a Sunday
  assert.equal(addUnit('2026-10-19', 'week', 1), '2026-10-26');
  setRangeEnd('2026-12-31');
  assert.deepEqual(windowBounds({ from: '2026-10-21', scale: 'week' }), { start: '2026-10-19', end: '2026-10-25', unit: '2026-10-19' });
  setRangeEnd(meta.asOf);
  assert.equal(fmt('2026-10-19', 'week'), 'Week of 19 Oct 2026');
});

test('theaters match whole word starts, not fragments', () => {
  assert.equal(theaterOf({ countries: ['Romania'], place: 'Bucharest' }), 'other');
  assert.equal(theaterOf({ countries: ['Oman'], place: 'Muscat' }), 'gulf');
  assert.equal(theaterOf({ countries: ['Ukraine'], place: 'Kyiv' }), 'europe');
  assert.equal(theaterOf({ countries: ['United States', 'Iran'], place: 'Washington' }), 'gulf');
  assert.equal(theaterOf({ countries: ['United States'], place: 'Washington' }), 'americas');
  assert.equal(theaterOf({ countries: ['Yemen'], place: 'Aden, Yemen' }), 'redsea');
});

test('the theater filter narrows the window', () => {
  const state = { scale: 'month', from: unitStart(meta.asOf, 'month'), theater: 'gulf' };
  const evs = windowEvents(all, state);
  assert.ok(evs.length > 0);
  assert.ok(evs.every((e) => theaterOf(e) === 'gulf'));
  assert.ok(evs.length < windowEvents(all, { ...state, theater: null }).length);
});

test('pressure and the pulse add up the impact rule', () => {
  assert.deepEqual(pressure({ dir: 'Escalatory', mag: 4 }), { up: 4, down: 0 });
  assert.deepEqual(pressure({ dir: 'Mixed', mag: 2 }), { up: 1, down: 1 });
  assert.deepEqual(pressure({ dir: 'Contextual', mag: 1 }), { up: 0, down: 0 });
  const p = dailyPulse(all, meta.asOf, 45);
  assert.equal(p.length, 45);
  assert.equal(p[44].date, meta.asOf);
  assert.equal(p[44].n, all.filter((e) => e.date === meta.asOf).length);
});

test('trend needs a clear margin', () => {
  assert.equal(trend({ n: 10, up: 20, down: 5 }, { n: 10, up: 19, down: 5 }), 'steady');
  assert.equal(trend({ n: 10, up: 30, down: 5 }, { n: 10, up: 15, down: 5 }), 'hotter');
  assert.equal(trend({ n: 10, up: 5, down: 15 }, { n: 10, up: 15, down: 5 }), 'cooler');
  assert.equal(trend({ n: 0, up: 0, down: 0 }, { n: 0, up: 0, down: 0 }), 'quiet');
});

test('the briefing covers every theater and reads as one sentence set', () => {
  const s = summarize(all, meta.asOf);
  assert.equal(s.theaters.length, THEATERS.length + 1);
  assert.equal(s.theaters[s.theaters.length - 1].id, 'other');
  assert.equal(s.theaters.reduce((a, t) => a + t.today, 0), s.today.n);
  const line = headline(s);
  assert.match(line, /latest day/);
  assert.ok(!line.includes('—'));
});
