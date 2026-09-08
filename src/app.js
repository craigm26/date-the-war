import { project, arcPath, VIEWBOX } from './geo.js';
import { verdict, addDays, daysBetween, clampDate } from './timeline.js';

const SVG = 'http://www.w3.org/2000/svg';

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

async function load(name) {
  const r = await fetch(`./data/${name}.json`);
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  return r.json();
}

const [world, nodesFile, mechanisms, events, eras] = await Promise.all(
  ['world-paths', 'nodes', 'mechanisms', 'events', 'eras'].map(load),
);

const nodeById = Object.fromEntries(nodesFile.nodes.map((n) => [n.id, n]));
const mechById = Object.fromEntries(mechanisms.map((m) => [m.id, m]));
const PRESENT = ['days', 'years'];

const state = {
  era: eras.find((e) => e.id === (location.hash.slice(1).split('@')[0] || 'years')) || eras[1],
  from: null,
};
state.from = location.hash.includes('@') ? location.hash.split('@')[1] : state.era.defaultFrom;
state.from = clampDate(state.from, state.era.start, state.era.end);

// ---------- static map ----------
const mapEl = document.getElementById('map');
const svg = s('svg', { viewBox: VIEWBOX, role: 'img', 'aria-label': 'World map of active theaters and links' });
const land = s('g', { class: 'land' });
for (const c of world) land.append(s('path', { d: c.d }));
const linksG = s('g', { class: 'links' });
const nodesG = s('g', { class: 'nodes' });
svg.append(land, linksG, nodesG);
mapEl.append(svg);

// ---------- controls ----------
const eraBar = document.getElementById('eras');
for (const e of eras) {
  eraBar.append(
    h('button', { type: 'button', class: 'era', 'data-era': e.id, onclick: () => setEra(e) }, e.label),
  );
}
const slider = document.getElementById('from');
const fromLabel = document.getElementById('from-label');
const toLabel = document.getElementById('to-label');
const blurb = document.getElementById('era-blurb');
slider.addEventListener('input', () => {
  state.from = addDays(state.era.start, Number(slider.value));
  render();
});
document.getElementById('prev').addEventListener('click', () => nudge(-1));
document.getElementById('next').addEventListener('click', () => nudge(1));

function nudge(dir) {
  // Jump to the previous or next event date inside the era.
  const dates = [...new Set(events.filter((ev) => state.era.eventEras.includes(ev.era)).map((ev) => ev.date))].sort();
  const next = dir > 0 ? dates.find((d) => d > state.from) : [...dates].reverse().find((d) => d < state.from);
  if (next) {
    state.from = clampDate(next, state.era.start, state.era.end);
    render();
  }
}

function setEra(e) {
  state.era = e;
  state.from = e.defaultFrom;
  render();
}

// ---------- render ----------
function eraEvents() {
  return events.filter((ev) => state.era.eventEras.includes(ev.era));
}

function visibleNodeIds() {
  const ids = new Set();
  for (const ev of eraEvents()) {
    ids.add(ev.theater);
    for (const p of (ev.combat || []).flat()) ids.add(p);
    for (const p of ev.link || []) ids.add(p);
  }
  if (PRESENT.includes(state.era.id)) {
    for (const n of nodesFile.nodes) if (n.status === 'watch') ids.add(n.id);
  }
  return ids;
}

function fmt(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function name(id) {
  return nodeById[id]?.name ?? id;
}

function render() {
  const era = state.era;
  const v = verdict(events, state.from, era.end, { majorPowers: nodesFile.majorPowers, eventEras: era.eventEras });
  history.replaceState(null, '', `#${era.id}@${state.from}`);

  // controls
  for (const b of eraBar.children) b.classList.toggle('active', b.dataset.era === era.id);
  slider.min = 0;
  slider.max = daysBetween(era.start, era.end);
  slider.value = daysBetween(era.start, state.from);
  fromLabel.textContent = fmt(state.from);
  toLabel.textContent = fmt(era.end);
  blurb.textContent = era.blurb;

  // map
  const visible = visibleNodeIds();
  const active = new Set(v.theaters);
  const fighting = new Set(v.powers);
  linksG.replaceChildren();
  nodesG.replaceChildren();
  for (const l of v.links) {
    const a = nodeById[l.from];
    const b = nodeById[l.to];
    if (!a || !b) continue;
    linksG.append(s('path', { d: arcPath(project(a.lon, a.lat), project(b.lon, b.lat)), class: 'link' }));
  }
  for (const n of nodesFile.nodes) {
    if (!visible.has(n.id)) continue;
    const [x, y] = project(n.lon, n.lat);
    const g = s('g', { transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` });
    if (n.kind === 'theater') {
      const on = active.has(n.id);
      const cls = `theater ${on ? 'on' : n.status === 'watch' ? 'watch' : 'off'}`;
      g.append(s('circle', { r: on ? 7 : 4.5, class: cls }));
      if (on || n.status === 'watch') g.append(labelFor(n, 10, 4, 'label'));
    } else {
      const on = fighting.has(n.id);
      g.append(s('rect', { x: -4, y: -4, width: 8, height: 8, class: `power ${on ? 'on' : 'off'}` }));
      if (on) g.append(labelFor(n, 8, -6, 'label power-label'));
    }
    g.append(s('title', {}, n.name));
    nodesG.append(g);
  }

  // verdict
  const vd = document.getElementById('verdict');
  const labels = { general: 'a general war among major powers', linked: 'linked wars', regional: 'a regional war' };
  vd.replaceChildren(
    h('p', { class: 'lede' }, 'Dated from ', h('b', {}, fmt(state.from)), ' and read as of ', fmt(era.end), ', the record shows ',
      h('b', { class: `tag ${v.label}` }, labels[v.label]), '.'),
    h('p', { class: 'rule' }, 'Rule applied: ', v.rule),
    h('div', { class: 'cols' },
      block('Theaters you would have to include', v.theaters.map(name)),
      block('Major powers in direct combat with each other', v.pairs.map((p) => `${name(p.pair[0])} and ${name(p.pair[1])}, from ${fmt(p.date)}`)),
      block('Links formed between theaters', v.links.map((l) => `${name(l.from)} to ${name(l.to)}, ${fmt(l.date)}`)),
      block('Mechanisms visible', v.mechanisms.map((m) => `${mechById[m.id]?.name ?? m.id} (${m.n})`)),
    ),
  );

  // events
  const list = document.getElementById('events');
  list.replaceChildren(
    ...v.events.map((ev) =>
      h('li', { class: `ev ${ev.kind}` },
        h('time', { datetime: ev.date }, fmt(ev.date)),
        h('div', {},
          h('p', { class: 'title' }, ev.title),
          h('p', { class: 'note' }, ev.note),
          h('p', { class: 'meta' },
            ...(ev.mechanisms || []).map((m) => h('span', { class: 'chip' }, mechById[m]?.name ?? m)),
            h('a', { href: ev.source.url, rel: 'noopener', target: '_blank' }, ev.source.label),
            ev.checked
              ? h('span', { class: 'checked', title: `Source opened and read on ${ev.checked}` }, `checked ${ev.checked}`)
              : h('span', { class: 'unchecked', title: 'Source link not yet re-opened for this page' }, 'unchecked'),
          ),
        ),
      ),
    ),
  );
  document.getElementById('event-count').textContent = `${v.events.length} in window`;
}

function labelFor(n, dx, dy, cls) {
  const l = n.label || {};
  return s('text', { x: l.dx ?? dx, y: l.dy ?? dy, class: cls, 'text-anchor': l.anchor ?? null }, n.name);
}

function block(title, items) {
  return h('div', { class: 'block' },
    h('h3', {}, title),
    items.length ? h('ul', {}, ...items.map((t) => h('li', {}, t))) : h('p', { class: 'none' }, 'none'),
  );
}

// mechanisms legend
const legend = document.getElementById('mechanisms');
const images = { 1: 'the leader', 2: 'the state', 3: 'the system' };
for (const m of mechanisms) {
  legend.append(
    h('li', {},
      h('p', { class: 'title' }, m.name, ' ', h('span', { class: 'image' }, images[m.image])),
      h('p', { class: 'note' }, m.short),
    ),
  );
}

render();
