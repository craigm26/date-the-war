import { Globe, buildTexture, greatCircle } from './globe.js';
import {
  RANGE_START, RANGE_END, GROUPS, ERAS, addDays, daysBetween, clampDate, unitStart, addUnit,
  windowBounds, passes, windowEvents, jumpTarget, yearStrip, related, fmt, parseHash, toHash,
} from './timeline.js';

const INK = '#201e1d';
const GROUND = '#f3f2f2';
const ACCENT = '#ec3013';

const $ = (id) => document.getElementById(id);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

async function load(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

const [events, topo, mechanisms] = await Promise.all([
  load('./data/all-events.json'),
  load('./data/countries-110m.json'),
  load('./data/mechanisms.json'),
]);

// ---------- state ----------
const state = {
  scale: 'month', from: '2026-09-01', cumulative: false, playing: false,
  groupsOff: {}, subsOff: {}, selected: null, hover: null, hoverPos: null,
  ...(parseHash(location.hash) || {}),
};
state.from = unitStart(state.from, state.scale);

// ---------- globe ----------
const canvas = $('globe');
const globe = new Globe(canvas, 720);
globe.setTexture(buildTexture(topo, { ocean: INK, land: GROUND, border: '#7d7979', grid: '#444141' }));
let drag = null;
let fly = null;
let lastMove = performance.now();
let markers = [];
let timer = null;

function flyTo(lon, lat, dur = 900) {
  let dl = lon - globe.lon0;
  dl = ((dl + 540) % 360) - 180;
  fly = { t0: performance.now(), dur, l0: globe.lon0, p0: globe.lat0, dl, dp: Math.max(-70, Math.min(70, lat)) - globe.lat0 };
  lastMove = performance.now();
}

function canvasPt(e) {
  const r = canvas.getBoundingClientRect();
  const src = e.touches ? e.touches[0] : e;
  return [(src.clientX - r.left) * (canvas.width / r.width), (src.clientY - r.top) * (canvas.height / r.height), src.clientX - r.left, src.clientY - r.top];
}

function hitTest(x, y) {
  let best = null;
  let bd = 1e9;
  for (const m of markers) {
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < m.r + 8 && d < bd) { bd = d; best = m; }
  }
  return best;
}

function onDown(e) { const [x, y] = canvasPt(e); drag = { x, y, moved: false }; fly = null; }
function onMove(e) {
  const [x, y, sx, sy] = canvasPt(e);
  if (drag) {
    const k = 40 / globe.R;
    globe.lon0 -= (x - drag.x) * k;
    globe.lat0 = Math.max(-80, Math.min(80, globe.lat0 + (y - drag.y) * k));
    if (Math.hypot(x - drag.x, y - drag.y) > 3) drag.moved = true;
    drag.x = x; drag.y = y; lastMove = performance.now();
    return;
  }
  const m = hitTest(x, y);
  const id = m ? m.ev.id : null;
  state.hoverPos = m ? [sx, sy] : null;
  if (id !== state.hover) { state.hover = id; markHover(); }
  renderTooltip();
}
function onUp() { if (drag) lastMove = performance.now(); drag = null; }
canvas.addEventListener('mousedown', onDown);
canvas.addEventListener('touchstart', onDown, { passive: true });
canvas.addEventListener('mousemove', onMove);
canvas.addEventListener('touchmove', onMove, { passive: true });
canvas.addEventListener('mouseup', onUp);
canvas.addEventListener('touchend', onUp);
canvas.addEventListener('mouseleave', () => { onUp(); if (state.hover) { state.hover = null; state.hoverPos = null; markHover(); renderTooltip(); } });
canvas.addEventListener('click', (e) => {
  if (drag && drag.moved) return;
  const [x, y] = canvasPt(e);
  const m = hitTest(x, y);
  if (m) select(m.ev.id);
});

function frame(t) {
  requestAnimationFrame(frame);
  if (!globe.tex) return;
  if (fly) {
    const k = Math.min(1, (t - fly.t0) / (fly.dur || 1));
    const e = 1 - (1 - k) ** 3;
    globe.lon0 = fly.l0 + fly.dl * e;
    globe.lat0 = fly.p0 + fly.dp * e;
    if (k >= 1) fly = null;
  } else if (!drag && t - lastMove > 2500) {
    globe.lon0 += 0.06 * Math.min(1, (t - lastMove - 2500) / 2000);
  }
  draw(t);
}

function draw(t) {
  const ctx = globe.ctx;
  const S = globe.size;
  globe.drawBase();
  ctx.lineWidth = 2; ctx.strokeStyle = INK;
  ctx.beginPath(); ctx.arc(globe.cx, globe.cy, globe.R + 1, 0, Math.PI * 2); ctx.stroke();
  const evs = windowEvents(events, state);
  const sel = state.selected;
  const hov = state.hover;
  for (const ev of evs) {
    if (!ev.arc) continue;
    const pts = greatCircle(ev.arc[0], ev.arc[1]);
    const emph = ev.id === sel || ev.id === hov;
    ctx.beginPath();
    let pen = false;
    for (const [lon, lat, lift] of pts) {
      const [x, y, , z] = globe.project(lon, lat);
      if (z > -0.02) {
        const px = globe.cx + (x - globe.cx) * lift;
        const py = globe.cy + (y - globe.cy) * lift;
        if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        pen = true;
      } else pen = false;
    }
    ctx.setLineDash(emph ? [] : [5, 4]);
    ctx.lineWidth = emph ? 2.5 : 1.5;
    ctx.strokeStyle = ev.dir === 'De-escalatory' ? 'rgba(243,242,242,.9)' : ACCENT;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  markers = [];
  const sorted = [...evs].sort((a, b) => (a.id === sel) - (b.id === sel));
  for (const ev of sorted) {
    const [x, y, vis] = globe.project(ev.lon, ev.lat);
    if (!vis) continue;
    const r = ev.global ? 4 + ev.mag : 4 + ev.mag * 2.2;
    const emph = ev.id === sel || ev.id === hov;
    markers.push({ ev, x, y, r });
    if (emph || ev.dir === 'Escalatory') {
      ctx.beginPath(); ctx.arc(x, y, r + 6 + ev.mag * 5, 0, Math.PI * 2);
      ctx.strokeStyle = ev.dir === 'Escalatory' ? 'rgba(236,48,19,.45)' : 'rgba(243,242,242,.5)';
      ctx.lineWidth = 1; ctx.stroke();
    }
    if (ev.id === sel) {
      const pulse = (t / 900) % 1;
      ctx.beginPath(); ctx.arc(x, y, r + 4 + pulse * 22, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(236,48,19,${(1 - pulse) * 0.9})`; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.lineWidth = 1.5; ctx.strokeStyle = INK;
    if (ev.dir === 'Escalatory') {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = ACCENT; ctx.fill(); ctx.strokeStyle = GROUND; ctx.stroke();
    } else if (ev.dir === 'De-escalatory') {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(32,30,29,.55)'; ctx.fill(); ctx.strokeStyle = GROUND; ctx.lineWidth = 2; ctx.stroke();
    } else if (ev.dir === 'Mixed') {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, Math.PI / 2, Math.PI * 1.5); ctx.fillStyle = GROUND; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = GROUND; ctx.lineWidth = 2; ctx.stroke();
    } else {
      const s = Math.max(6, r * 1.2);
      ctx.fillStyle = GROUND; ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.strokeStyle = INK; ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    }
    if (emph) {
      ctx.font = '600 14px Archivo, system-ui, sans-serif'; ctx.textBaseline = 'middle';
      const label = ev.place;
      const w = ctx.measureText(label).width;
      const lx = x + r + 10 + w > S - 8 ? x - r - 10 - w : x + r + 10;
      ctx.fillStyle = INK; ctx.fillRect(lx - 5, y - 11, w + 10, 22);
      ctx.fillStyle = GROUND; ctx.fillText(label, lx, y);
    }
  }
}

// ---------- state changes ----------
function setFrom(iso, extra = {}) {
  const scale = extra.scale || state.scale;
  Object.assign(state, extra, { from: clampDate(unitStart(clampDate(iso), scale)) });
  render();
}

function setScale(scale) {
  stopPlay();
  state.scale = scale;
  state.from = unitStart(state.from, scale);
  render();
}

function stopPlay() {
  clearInterval(timer);
  timer = null;
  state.playing = false;
}

function togglePlay() {
  if (state.playing) { stopPlay(); render(); return; }
  const ms = { day: 90, month: 220, year: 700 }[state.scale];
  timer = setInterval(() => {
    const next = addUnit(unitStart(state.from, state.scale), state.scale, 1);
    if (next > RANGE_END) { stopPlay(); render(); return; }
    state.from = next;
    render();
  }, ms);
  state.playing = true;
  render();
}

function jump(dir) {
  const hit = jumpTarget(events, state, dir);
  if (!hit) return;
  state.selected = hit.id;
  flyTo(hit.lon, hit.lat);
  setFrom(hit.date);
}

function select(id) {
  const ev = events.find((e) => e.id === id);
  const same = state.selected === id;
  state.selected = same ? null : id;
  if (ev && !same) {
    flyTo(ev.lon, ev.lat);
    const { unit, end } = windowBounds(state);
    if (ev.date < unit || ev.date > end) { setFrom(ev.date); return; }
  }
  render();
}

function goEra(era) {
  stopPlay();
  state.selected = null;
  state.scale = era.scale;
  state.from = unitStart(era.from, era.scale);
  const first = events.find((e) => e.date >= era.from && passes(e, state));
  if (first) flyTo(first.lon, first.lat);
  render();
}

// ---------- static UI ----------
$('total-count').textContent = `${events.length} sourced events`;
const scaleBar = $('scales');
for (const [id, label] of [['day', 'Days'], ['month', 'Months'], ['year', 'Years']]) {
  scaleBar.append(h('button', { type: 'button', class: 'seg', 'data-scale': id, onclick: () => setScale(id) }, label));
}
$('play').addEventListener('click', togglePlay);
$('prev').addEventListener('click', () => jump(-1));
$('next').addEventListener('click', () => jump(1));
$('mode-window').addEventListener('click', () => { state.cumulative = false; render(); });
$('mode-cumulative').addEventListener('click', () => { state.cumulative = true; render(); });
const eraBar = $('era-shortcuts');
for (const era of ERAS) eraBar.append(h('button', { type: 'button', class: 'ghost', onclick: () => goEra(era) }, era.label));

const strip = $('strip');
const stripCells = [];
const Y0 = +RANGE_START.slice(0, 4);
const Y1 = +RANGE_END.slice(0, 4);
for (let y = Y0; y <= Y1; y++) {
  const cell = h('div', { class: 'cell' });
  stripCells.push(cell);
  strip.append(cell);
}
strip.addEventListener('click', (e) => {
  const r = strip.getBoundingClientRect();
  const y = Y0 + Math.floor(((e.clientX - r.left) / r.width) * (Y1 - Y0 + 1));
  setFrom(`${Math.min(Y1, y)}-01-01`);
});
const slider = $('slider');
slider.max = daysBetween(RANGE_START, RANGE_END);
slider.addEventListener('input', () => setFrom(addDays(RANGE_START, +slider.value)));
$('groups-reset').addEventListener('click', () => { state.groupsOff = {}; state.subsOff = {}; render(); });

const mechList = $('mechanisms');
const images = { 1: 'the leader', 2: 'the state', 3: 'the system' };
for (const m of mechanisms) {
  mechList.append(h('li', {}, h('p', { class: 'mtitle' }, m.name, ' ', h('span', { class: 'image' }, images[m.image])), h('p', { class: 'mnote' }, m.short)));
}

// ---------- render ----------
function render() {
  history.replaceState(null, '', toHash(state));
  const { unit, end } = windowBounds(state);
  const win = windowEvents(events, state);

  for (const b of scaleBar.children) b.setAttribute('aria-pressed', b.dataset.scale === state.scale);
  $('mode-label').textContent = state.cumulative ? `Cumulative since ${Y0}` : `${state.scale} window`;
  $('window-label').textContent = state.cumulative ? `→ ${fmt(end, 'day')}` : fmt(unit, state.scale);
  $('window-count').textContent = `${win.length} events · ${win.filter((e) => e.arc).length} links`;
  $('play').textContent = state.playing ? '❚❚ Pause' : '▶ Play';
  $('mode-window').setAttribute('aria-pressed', !state.cumulative);
  $('mode-cumulative').setAttribute('aria-pressed', state.cumulative);

  yearStrip(events, state).forEach((c, i) => {
    const el = stripCells[i];
    el.style.height = `${c.h}px`;
    el.title = `${c.year}: ${c.n} events`;
    el.className = `cell ${c.inWindow ? 'in' : c.n ? 'has' : ''}`;
  });
  slider.value = daysBetween(RANGE_START, unit);

  renderFilters();
  renderList(win);
  renderTooltip();
}

function renderFilters() {
  const counts = {};
  for (const e of events) counts[e.group] = (counts[e.group] || 0) + 1;
  const anyOff = GROUPS.some((g) => state.groupsOff[g]) || Object.values(state.subsOff).some(Boolean);
  $('groups-reset').textContent = anyOff ? 'Show all' : 'Reset';
  $('groups').replaceChildren(...GROUPS.map((name) =>
    h('button', {
      type: 'button', class: 'chip', 'aria-pressed': !state.groupsOff[name],
      onclick: () => { state.groupsOff[name] = !state.groupsOff[name]; render(); },
    }, h('span', {}, name), h('span', { class: 'count' }, String(counts[name] || 0))),
  ));
  const subNames = [...new Set(events.filter((e) => !state.groupsOff[e.group]).map((e) => e.sub))].sort();
  const on = subNames.filter((s) => !state.subsOff[s]).length;
  $('subs-summary').textContent = `Refine by indicator (${on} of ${subNames.length})`;
  $('subs').replaceChildren(...subNames.map((name) =>
    h('button', {
      type: 'button', class: 'tag', 'aria-pressed': !state.subsOff[name],
      onclick: () => { state.subsOff[name] = !state.subsOff[name]; render(); },
    }, name),
  ));
}

function glyph(ev) {
  const d = 8 + ev.mag * 1.6;
  const s = h('span', { class: `glyph ${ev.dir.toLowerCase().replace('-', '')}` });
  const size = ev.dir === 'Contextual' ? d * 0.7 : d;
  s.style.width = `${size}px`;
  s.style.height = `${size}px`;
  return s;
}

function renderList(win) {
  $('list-count').textContent = `${win.length} in window`;
  $('list-empty').hidden = win.length > 0;
  $('list').replaceChildren(...win.map((ev) => {
    const open = state.selected === ev.id;
    const rel = open ? related(events, ev) : [];
    return h('li', {
      class: `row ${open ? 'selected' : state.hover === ev.id ? 'hovered' : ''}`, 'data-id': ev.id,
      onmouseenter: () => { state.hover = ev.id; state.hoverPos = null; markHover(); renderTooltip(); },
      onmouseleave: () => { if (state.hover === ev.id) { state.hover = null; markHover(); } },
    },
      h('div', { class: 'gcol' }, glyph(ev)),
      h('div', { class: 'body' },
        h('button', { type: 'button', class: 'rowbtn', onclick: () => select(ev.id) },
          h('div', { class: 'meta' },
            h('span', {}, fmt(ev.date, 'day')), h('span', {}, ev.place),
            h('span', { class: 'mag', title: `Impact ${ev.mag} of 5` }, ...[1, 2, 3, 4, 5].map((i) => h('span', { class: `sq ${i <= ev.mag ? 'on' : ''}` }))),
          ),
          h('div', { class: 'title' }, ev.title),
          h('div', { class: 'tags' },
            h('span', { class: 'tag-group' }, ev.group),
            h('span', { class: 'tag-sub' }, ev.sub),
            ev.metric && h('span', { class: 'tag-metric' }, ev.metric),
          ),
        ),
        open && h('div', { class: 'detail' },
          h('p', {}, ev.note),
          ev.effects && h('p', {}, h('b', {}, 'Reported effects. '), ev.effects),
          ev.implication && h('p', { class: 'analysis' }, h('b', {}, 'Analysis. '), ev.implication),
          ev.limitations && h('p', { class: 'limits' }, h('b', {}, 'Limits. '), ev.limitations),
          ev.mechanisms.length > 0 && h('div', { class: 'mechs' }, ...ev.mechanisms.map((m) => h('span', {}, m))),
          h('div', { class: 'actors' }, `Actors: ${ev.countries.join(', ') || ev.place}`),
          h('div', { class: 'srcline' },
            h('a', { href: ev.source.url, target: '_blank', rel: 'noopener' }, `Source: ${ev.source.label} ↗`),
            h('span', { class: ev.checked ? 'checked' : 'unchecked', title: ev.checked ? `Source opened and read on ${ev.checked}` : 'Source link not yet re-opened for this page' }, ev.checked ? `checked ${ev.checked}` : 'unchecked'),
            rel.length > 0 && h('span', { class: 'relhead' }, 'Related:'),
            ...rel.map((o) => h('button', { type: 'button', class: 'rel', onclick: () => select(o.id) }, `${o.title} (${fmt(o.date, 'day')})`)),
          ),
        ),
      ),
    );
  }));
}

function markHover() {
  for (const li of $('list').children) {
    li.classList.toggle('hovered', li.dataset.id === state.hover && !li.classList.contains('selected'));
  }
}

function renderTooltip() {
  const tip = $('tooltip');
  const ev = state.hover && state.hoverPos ? events.find((e) => e.id === state.hover) : null;
  tip.hidden = !ev;
  if (!ev) return;
  tip.style.left = `${state.hoverPos[0] + 20}px`;
  tip.style.top = `${state.hoverPos[1] + 8}px`;
  $('tip-title').textContent = ev.title;
  $('tip-meta').textContent = `${fmt(ev.date, 'day')} · ${ev.dir} · impact ${ev.mag}`;
}

flyTo(48, 30, 0);
render();
requestAnimationFrame(frame);
