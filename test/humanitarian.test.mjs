import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { indexAssessment, matchCountry, eventCountries, theaterSeverity, people } from '../src/humanitarian.js';

const root = new URL('..', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const hum = read('data/humanitarian.json');
const help = read('data/help.json');
const topo = read('data/countries-110m.json');
const idx = indexAssessment(hum);

test('the assessment is a sourced INFORM Severity release', () => {
  assert.equal(hum.source.publisher, 'ACAPS');
  assert.match(hum.source.edition, /^[A-Z][a-z]+ \d{4}$/);
  assert.match(hum.source.url, /^https:\/\/data\.humdata\.org\//);
  assert.ok(hum.countries.length >= 40);
  for (const c of hum.countries) {
    assert.ok(c.category >= 1 && c.category <= 5, `${c.country}: category`);
    assert.ok(c.index >= 0 && c.index <= 10, `${c.country}: index`);
    assert.match(c.url, /^https:\/\//, `${c.country}: url`);
    assert.match(c.isoNum || '', /^\d{3}$/, `${c.country}: isoNum`);
  }
});

test('every assessed country can be drawn on the map', () => {
  const ids = new Set(topo.objects.countries.geometries.map((g) => g.id));
  const missing = idx.rows.filter((c) => !ids.has(c.isoNum)).map((c) => c.country);
  // the 110m map leaves out a few small islands; nothing large may go missing
  assert.ok(missing.length <= 3, `missing from the map: ${missing.join(', ')}`);
});

test('one row per country, most severe crisis kept', () => {
  assert.equal(new Set(idx.rows.map((c) => c.iso3)).size, idx.rows.length);
  for (let i = 1; i < idx.rows.length; i++) assert.ok(idx.rows[i - 1].index >= idx.rows[i].index);
});

test('event country names match the assessment, aliases included', () => {
  assert.equal(matchCountry(idx, 'Sudan').iso3, 'SDN');
  assert.equal(matchCountry(idx, 'Gaza').iso3, 'PSE');
  assert.equal(matchCountry(idx, 'DRC').iso3, 'COD');
  assert.equal(matchCountry(idx, 'Atlantis'), null);
  const cs = eventCountries(idx, { countries: ['United States', 'Sudan', 'South Sudan', 'Sudan'] });
  assert.deepEqual(cs.map((c) => c.iso3).sort(), ['SDN', 'SSD']);
});

test('theaters report their most severe crisis', () => {
  const horn = theaterSeverity(idx, 'horn');
  assert.equal(horn.category, 5);
  assert.ok(horn.countries.some((c) => c.country === 'Sudan'));
});

test('people reads naturally', () => {
  assert.equal(people(33701000), '33.7 million');
  assert.equal(people(5000000), '5 million');
  assert.equal(people(640000), '640,000');
  assert.equal(people(null), null);
});

test('help lists only known groups, https links, and a checked date', () => {
  assert.match(help.checked, /^\d{4}-\d{2}-\d{2}$/);
  for (const [iso3, list] of Object.entries(help.countries)) {
    assert.ok(idx.byIso3[iso3], `${iso3} not assessed`);
    for (const e of list) {
      assert.ok(help.orgs[e.org], `${iso3}: unknown org ${e.org}`);
      assert.match(e.url, /^https:\/\//);
      assert.ok(!/[?&](utm_|ref=|aff)/i.test(e.url), `${e.url}: tracking parameter`);
    }
  }
  for (const k of ['check', 'civic', 'act']) assert.ok(help.general[k].length > 0, k);
});

test('the plain-text copy asks software to leave giving to the person', () => {
  assert.ok(existsSync(new URL('data/help.md', root)));
  const md = readFileSync(new URL('data/help.md', root), 'utf8');
  assert.match(md, /do not donate, pledge, or share anyone's payment details without their explicit instruction/);
});
