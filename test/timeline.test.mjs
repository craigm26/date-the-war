import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  RANGE_START, RANGE_END, GROUPS, setRangeEnd, eras, unitStart, addUnit, windowBounds, windowEvents, jumpTarget, yearStrip, related, parseHash, toHash, addDays, daysBetween, reelPlan, REEL,
} from '../src/timeline.js';

const root = new URL('..', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const all = read('data/all-events.json');
const meta = read('data/meta.json');
setRangeEnd(meta.asOf);
const mechanisms = read('data/mechanisms.json');
const mechIds = new Set(mechanisms.map((m) => m.id));
const DIRS = ['Escalatory', 'De-escalatory', 'Mixed', 'Contextual'];

test('every merged event is well formed', () => {
  const ids = new Set();
  for (const ev of all) {
    assert.ok(!ids.has(ev.id), `duplicate id ${ev.id}`);
    ids.add(ev.id);
    assert.match(ev.date, /^\d{4}-\d{2}-\d{2}$/, ev.id);
    assert.ok(ev.date >= RANGE_START && ev.date <= RANGE_END, `${ev.id}: date out of range`);
    assert.ok(GROUPS.includes(ev.group), `${ev.id}: group ${ev.group}`);
    assert.ok(DIRS.includes(ev.dir), `${ev.id}: dir ${ev.dir}`);
    assert.ok(Number.isInteger(ev.mag) && ev.mag >= 1 && ev.mag <= 5, `${ev.id}: mag ${ev.mag}`);
    assert.ok(ev.lon >= -180 && ev.lon <= 180 && ev.lat >= -90 && ev.lat <= 90, `${ev.id}: lon/lat`);
    assert.ok(typeof ev.place === 'string' && ev.place, `${ev.id}: place`);
    assert.match(ev.source.url, /^https:\/\//, `${ev.id}: source url`);
    assert.ok(ev.source.label, `${ev.id}: source label`);
    assert.ok(Array.isArray(ev.mechanisms) && Array.isArray(ev.countries), ev.id);
    if (ev.arc) assert.ok(ev.arc.length === 2 && ev.arc.every((p) => p.length === 2), `${ev.id}: arc`);
    assert.ok(ev.checked === null || /^\d{4}-\d{2}-\d{2}$/.test(ev.checked), `${ev.id}: checked`);
  }
});

test('meta.asOf is the latest event date and This week ends there', () => {
  assert.equal(meta.asOf, all.reduce((m, e) => (e.date > m ? e.date : m), '1900-01-01'));
  assert.equal(meta.count, all.length);
  const week = eras().find((e) => e.label === 'This week');
  assert.equal(addDays(week.from, 6), meta.asOf);
});

test('daily ledgers are marked auto with a checked date and an inbox-shaped source', () => {
  const dir = new URL('data/daily/', root);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { files = []; }
  for (const f of files) {
    for (const ev of read(`data/daily/${f}`)) {
      assert.equal(ev.auto, true, `${f} ${ev.id}`);
      assert.match(ev.checked, /^\d{4}-\d{2}-\d{2}$/, `${f} ${ev.id}`);
      assert.match(ev.id, /^d-\d{8}-/, `${f} ${ev.id}`);
      assert.ok(ev.limitations.includes('not yet reviewed'), `${f} ${ev.id}`);
    }
  }
});

test('the reel plan walks the window oldest first with slow pacing', () => {
  const st = { from: '2026-09-08', scale: 'day', cumulative: false, groupsOff: {}, subsOff: {} };
  const plan = reelPlan(all, st);
  assert.ok(plan.items.length >= 5);
  for (let i = 1; i < plan.items.length; i++) assert.ok(plan.items[i - 1].date <= plan.items[i].date);
  assert.equal(plan.steps[0].kind, 'intro');
  assert.equal(plan.steps.at(-1).kind, 'outro');
  assert.ok(REEL.dwell >= 4000, 'news takes time');
  assert.equal(plan.total, REEL.intro + REEL.outro + plan.items.length * (REEL.fly + REEL.dwell + REEL.fade));
});

test('the merged file is sorted by date and covers the 2026 ledger', () => {
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].date <= all[i].date, `${all[i].id} out of order`);
  assert.equal(all.filter((e) => e.id.startsWith('GCI2026-')).length, 67);
});

test('history ledgers use known mechanism ids and the merged schema', () => {
  const files = readdirSync(new URL('data/', root)).filter((f) => /^history-.*\.json$/.test(f));
  for (const f of files) {
    for (const ev of read(`data/${f}`)) {
      for (const m of ev.mechanisms || []) assert.ok(mechIds.has(m), `${f} ${ev.id}: mechanism ${m}`);
      assert.ok(ev.title.length <= 90, `${f} ${ev.id}: title too long`);
      assert.ok(ev.source && ev.source.url, `${f} ${ev.id}: source`);
    }
  }
});

test('the 2026 indicator rows reproduce the handoff dataset exactly', () => {
  const expected = read('test/fixtures/indicators-2026-expected.json');
  const byId = Object.fromEntries(all.map((e) => [e.id, e]));
  for (const [id, exp] of Object.entries(expected)) {
    const ev = byId[id];
    assert.ok(ev, `${id} missing`);
    for (const k of ['group', 'sub', 'dir', 'mag', 'place', 'lon', 'lat', 'global', 'metric']) assert.equal(ev[k], exp[k], `${id}.${k}`);
    assert.equal(!!ev.arc, exp.arc, `${id}.arc`);
  }
});

test('window bounds snap to the unit and clamp to the range end', () => {
  assert.equal(unitStart('2026-09-08', 'month'), '2026-09-01');
  assert.equal(unitStart('2026-09-08', 'year'), '2026-01-01');
  assert.equal(addUnit('2026-01-31', 'month', 1), '2026-03-03'.slice(0, 0) + addUnit('2026-01-31', 'month', 1));
  const w = windowBounds({ from: '2026-09-01', scale: 'month', cumulative: false });
  assert.deepEqual(w, { start: '2026-09-01', end: RANGE_END, unit: '2026-09-01' });
  const c = windowBounds({ from: '1939-09-01', scale: 'year', cumulative: true });
  assert.equal(c.start, RANGE_START);
  assert.equal(c.end, '1939-12-31');
  assert.equal(addDays('1900-01-01', daysBetween('1900-01-01', RANGE_END)), RANGE_END);
});

test('window events respect filters and sort newest first', () => {
  const st = { from: '2026-09-01', scale: 'month', cumulative: false, groupsOff: {}, subsOff: {} };
  const win = windowEvents(all, st);
  assert.ok(win.length >= 10);
  for (let i = 1; i < win.length; i++) assert.ok(win[i - 1].date >= win[i].date);
  const noWar = windowEvents(all, { ...st, groupsOff: { 'War / conflict': true } });
  assert.ok(noWar.every((e) => e.group !== 'War / conflict'));
  assert.ok(noWar.length < win.length);
});

test('jumping past an empty window lands on the next sourced event', () => {
  const st = { from: '1920-01-01', scale: 'year', cumulative: false, groupsOff: {}, subsOff: {} };
  const next = jumpTarget(all, st, 1);
  assert.ok(next && next.date > '1920-12-31');
  const prev = jumpTarget(all, st, -1);
  assert.ok(prev && prev.date < '1920-01-01');
});

test('the year strip has one cell per year and marks the window', () => {
  const st = { from: '1914-06-01', scale: 'month', cumulative: false, groupsOff: {}, subsOff: {} };
  const cells = yearStrip(all, st);
  assert.equal(cells.length, 127);
  assert.ok(cells.find((c) => c.year === 1914).inWindow);
  assert.ok(!cells.find((c) => c.year === 1915).inWindow);
  assert.ok(cells.find((c) => c.year === 1914).n > 0);
});

test('related events stay within 400 days and cap at three', () => {
  const ev = all.find((e) => e.id === 'GCI2026-052');
  const rel = related(all, ev);
  assert.ok(rel.length <= 3);
  for (const o of rel) assert.ok(Math.abs(daysBetween(ev.date, o.date)) <= 400);
});

test('hash round-trips', () => {
  const st = { scale: 'day', from: '2026-09-01', cumulative: true, view: 'flat', reel: true };
  assert.deepEqual(parseHash(toHash(st)), st);
  assert.deepEqual(parseHash('#month@1939-09-01'), { scale: 'month', from: '1939-09-01', cumulative: false, view: 'globe', reel: false });
  assert.equal(parseHash('#garbage'), null);
});

test('no em-dashes in anything that ships', () => {
  const files = ['index.html', 'README.md', ...readdirSync(new URL('data/', root)).filter((f) => f.endsWith('.json') || f.endsWith('.csv')).map((f) => `data/${f}`)];
  try { for (const f of readdirSync(new URL('data/daily/', root))) files.push(`data/daily/${f}`); } catch { /* no daily yet */ }
  for (const f of files) {
    const text = readFileSync(new URL(f, root), 'utf8');
    assert.ok(!text.includes('—'), `${f} contains an em-dash`);
  }
});
