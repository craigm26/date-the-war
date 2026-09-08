import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { verdict, eventsIn, linksFormed, majorPowerPairs, addDays, daysBetween } from '../src/timeline.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url), 'utf8'));
const events = read('events.json');
const { nodes, majorPowers, asOf } = read('nodes.json');
const mechanisms = read('mechanisms.json');
const eras = read('eras.json');
const nodeIds = new Set(nodes.map((n) => n.id));
const mechIds = new Set(mechanisms.map((m) => m.id));
const eraIds = new Set(eras.map((e) => e.id));
const era = (id) => eras.find((e) => e.id === id);
const opts = (id) => ({ majorPowers, eventEras: era(id).eventEras });

test('every event is well formed and points at things that exist', () => {
  const ids = new Set();
  for (const ev of events) {
    assert.match(ev.date, /^\d{4}-\d{2}-\d{2}$/, ev.id);
    assert.ok(!ids.has(ev.id), `duplicate id ${ev.id}`);
    ids.add(ev.id);
    assert.ok(nodeIds.has(ev.theater), `${ev.id}: theater ${ev.theater}`);
    for (const m of ev.mechanisms) assert.ok(mechIds.has(m), `${ev.id}: mechanism ${m}`);
    if (ev.combat) {
      assert.equal(ev.combat.length, 2, `${ev.id}: combat must be two sides`);
      for (const p of ev.combat.flat()) assert.ok(nodeIds.has(p), `${ev.id}: combat ${p}`);
    }
    for (const p of ev.link || []) assert.ok(nodeIds.has(p), `${ev.id}: link ${p}`);
    assert.ok(eraIds.has(ev.era) || ev.era === 'days', `${ev.id}: era ${ev.era}`);
    assert.match(ev.source.url, /^https:\/\//, `${ev.id}: source url`);
    assert.ok(ev.checked === null || /^\d{4}-\d{2}-\d{2}$/.test(ev.checked), `${ev.id}: checked`);
    assert.ok(ev.date <= asOf, `${ev.id}: dated after asOf`);
  }
});

test('every era default sits inside its range and every era has events', () => {
  for (const e of eras) {
    assert.ok(e.start <= e.defaultFrom && e.defaultFrom <= e.end, e.id);
    assert.ok(eventsIn(events, e.start, e.end, e.eventEras).length > 0, `${e.id} has no events`);
  }
});

test('1914: dating from 28 July gives a regional war; from 1 August it is general', () => {
  const july = verdict(events, '1914-07-28', '1914-07-31', opts('1914'));
  assert.equal(july.label, 'regional');
  assert.deepEqual(july.pairs, []);
  const aug = verdict(events, '1914-07-28', '1914-08-04', opts('1914'));
  assert.equal(aug.label, 'general');
  assert.ok(aug.pairs.length >= 3, 'three major-power pairs by 4 August');
  assert.ok(aug.theaters.length >= 2);
});

test('1939: dating from 1931 folds in Manchuria; dating from 1939 does not', () => {
  const from1931 = verdict(events, '1931-09-18', era('1939').end, opts('1939'));
  assert.ok(from1931.theaters.includes('manchuria'));
  assert.ok(from1931.theaters.includes('ethiopia'));
  const from1939 = verdict(events, '1939-09-01', era('1939').end, opts('1939'));
  assert.ok(!from1939.theaters.includes('manchuria'));
  assert.equal(from1939.label, 'general');
  assert.equal(from1931.label, 'general');
});

test('the present, dated from the 2022 invasion, reads as linked wars, not general', () => {
  const v = verdict(events, '2022-02-24', asOf, opts('years'));
  assert.equal(v.label, 'linked');
  assert.deepEqual(v.pairs, [], 'no two major powers in direct combat with each other');
  assert.ok(v.links.length >= 4);
  assert.ok(v.powers.includes('us') && v.powers.includes('iran'));
});

test('the present, dated from 2011, is still linked and includes Libya and Syria', () => {
  const v = verdict(events, '2011-01-01', asOf, opts('years'));
  assert.equal(v.label, 'linked');
  assert.ok(v.theaters.includes('libya') && v.theaters.includes('syria'));
});

test('this week alone is a regional war between the US and Iran', () => {
  const v = verdict(events, era('days').defaultFrom, era('days').end, opts('days'));
  assert.equal(v.label, 'regional');
  assert.deepEqual(v.theaters, ['gulf']);
  assert.ok(v.events.every((ev) => ev.checked), 'every live-layer event is checked');
});

test('links and pairs are deduplicated', () => {
  const evs = [
    { id: 'a', date: '2000-01-01', era: 'x', theater: 't', link: ['p', 'q'], combat: [['us'], ['uk']], mechanisms: [] },
    { id: 'b', date: '2000-01-02', era: 'x', theater: 't', link: ['q', 'p'], combat: [['uk'], ['us']], mechanisms: [] },
  ];
  assert.equal(linksFormed(evs).length, 1);
  assert.equal(majorPowerPairs(evs, ['us', 'uk']).length, 1);
});

test('a coalition on one side is not a major-power pair', () => {
  const evs = [{ id: 'c', date: '2011-03-19', era: 'x', theater: 't', combat: [['us', 'uk', 'france'], []], mechanisms: [] }];
  assert.deepEqual(majorPowerPairs(evs, ['us', 'uk', 'france']), []);
});

test('date arithmetic', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(daysBetween('2026-08-01', '2026-09-08'), 38);
});

test('no em-dashes in anything that ships', () => {
  const root = new URL('..', import.meta.url);
  const files = ['index.html', 'README.md', ...readdirSync(new URL('data/', root)).map((f) => `data/${f}`)];
  for (const f of files) {
    const text = readFileSync(new URL(f, root), 'utf8');
    assert.ok(!text.includes('—'), `${f} contains an em-dash`);
  }
});
