import { Globe, buildTexture, greatCircle, countryPoints } from './globe.js';
import {
  RANGE_START, RANGE_END, GROUPS, setRangeEnd, eras, addDays, daysBetween, clampDate, unitStart, addUnit,
  windowBounds, passes, windowEvents, jumpTarget, yearStrip, related, fmt, parseHash, toHash, reelPlan, REEL,
} from './timeline.js';
import { THEATERS, OTHER, theater } from './theaters.js';
import { summarize, headline, dailyPulse } from './briefing.js';
import { SEV_COLOURS, SEV_WORDS, indexAssessment, eventCountries, theaterSeverity, people } from './humanitarian.js';

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

const [events, topo, mechanisms, meta] = await Promise.all([
  load('./data/all-events.json'),
  load('./data/countries-110m.json'),
  load('./data/mechanisms.json'),
  load('./data/meta.json'),
]);
// The assessment layer is optional: the page still works if either file is missing.
const [hum, helpDoc, trust] = await Promise.all([
  load('./data/humanitarian.json').catch(() => null),
  load('./data/help.json').catch(() => null),
  load('./data/trust.json').catch(() => null),
]);
const H = hum ? indexAssessment(hum) : null;
setRangeEnd(meta.asOf);
const ERAS = eras();
const END = meta.asOf;
$('loading').remove();

// ---------- state ----------
const state = {
  scale: 'month', from: unitStart(END, 'month'), cumulative: false, playing: false, view: 'globe', layer: 'events', rotate: true, reel: false,
  groupsOff: {}, subsOff: {}, theater: null, selected: null, hover: null, hoverPos: null,
  ...(parseHash(location.hash) || {}),
};
const wantReel = state.reel;
state.reel = false;
state.from = unitStart(state.from, state.scale);

// ---------- globe ----------
const canvas = $('globe');
const globe = new Globe(canvas, 720);
// One texture per map layer, built when first shown; each also kept as a
// drawable image for the flat view.
const TW = 2048;
const TH = 1024;
const layerCache = {};
let texCanvas = null;
function layerTexture(name) {
  if (layerCache[name]) return layerCache[name];
  const fills = name === 'sev' && H ? Object.fromEntries(H.rows.filter((c) => c.isoNum).map((c) => [c.isoNum, SEV_COLOURS[c.category]])) : null;
  const tex = buildTexture(topo, { ocean: INK, land: GROUND, border: '#7d7979', grid: '#444141', fills });
  const cv = document.createElement('canvas');
  cv.width = TW; cv.height = TH;
  cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(tex.buffer), TW, TH), 0, 0);
  return (layerCache[name] = { tex, canvas: cv });
}
function applyLayer() {
  if (!H) state.layer = 'events';
  const L = layerTexture(state.layer);
  globe.setTexture(L.tex);
  texCanvas = L.canvas;
}
const PTS = countryPoints(topo);
const FLAT_W = 1440;
const FLAT_H = 720;

function isFlat() { return state.view === 'flat'; }
// Marker sizes are tuned for a 720px canvas; the flat canvas is twice as wide.
function K() { return isFlat() ? 1.5 : 1; }
function proj(lon, lat) {
  if (!isFlat()) return globe.project(lon, lat);
  return [((lon + 180) / 360) * FLAT_W, ((90 - lat) / 180) * FLAT_H, true, 1];
}
function applyView() {
  if (isFlat()) {
    canvas.width = FLAT_W; canvas.height = FLAT_H;
    canvas.style.aspectRatio = '2 / 1'; canvas.style.maxWidth = '100%'; canvas.style.cursor = 'default';
  } else {
    canvas.width = 720; canvas.height = 720;
    canvas.style.aspectRatio = '1 / 1'; canvas.style.maxWidth = '680px'; canvas.style.cursor = 'grab';
  }
  $('rotate').hidden = isFlat();
}
let drag = null;
let fly = null;
let lastMove = performance.now();
let markers = [];
let timer = null;

function flyTo(lon, lat, dur = 900) {
  if (isFlat()) return;
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
  // Tolerance grows as the canvas is scaled down, so a fingertip on a phone
  // still lands.
  const scale = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
  const tol = 8 * Math.max(1, scale) + (matchMedia('(pointer: coarse)').matches ? 10 * scale : 0);
  let best = null;
  let bd = 1e9;
  for (const m of markers) {
    const d = Math.hypot(m.x - x, m.y - y);
    if (d < m.r + tol && d < bd) { bd = d; best = m; }
  }
  return best;
}

function onDown(e) { stopReel(); if (isFlat()) return; const [x, y] = canvasPt(e); drag = { x, y, moved: false }; fly = null; }
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
  const id = m ? (m.ev ? m.ev.id : `h:${m.hum.iso3}`) : null;
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
  if (m && m.hum) openHelp(m.hum);
  else if (m) { select(m.ev.id); revealRow(m.ev.id); }
});
function revealRow(id) {
  const li = [...$('list').children].find((el) => el.dataset.id === id);
  if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- the reel ----------
// A flyover of the window's events, oldest first: a title card, then for
// each event a slow fly, a long dwell with a card and a progress bar, a fade,
// and a closing card. Deliberately unhurried: news takes time to settle.
let reel = null;
function startReel() {
  const plan = reelPlan(events, state);
  if (!plan.items.length) return;
  stopPlay();
  reel = { plan, i: 0, t0: performance.now() };
  state.reel = true;
  state.selected = null;
  $('reel-card').hidden = false;
  render();
}
function stopReel() {
  if (!reel) return;
  reel = null;
  state.reel = false;
  $('reel-card').hidden = true;
  render();
}
function reelTick(t) {
  const step = reel.plan.steps[reel.i];
  if (!step) { stopReel(); return; }
  const el = t - reel.t0;
  const card = $('reel-card');
  if (step.kind === 'intro') {
    setCard(fmt(windowBounds(state).unit, state.scale), `${reel.plan.items.length} sourced ${reel.plan.items.length === 1 ? 'event' : 'events'} in the window`, 'The record, in the order it arrived.', 0, 'intro');
  } else if (step.kind === 'outro') {
    setCard('End of the record for this window', 'Entries marked auto were drafted by a daily job and have not been reviewed.', 'Sources take days to settle. Come back.', 0, 'outro');
  } else {
    const ev = step.ev;
    if (el < 16 || state.selected !== ev.id) {
      state.selected = ev.id;
      flyTo(ev.lon, ev.lat, REEL.fly);
      renderList(windowEvents(events, state));
    }
    const dwellStart = REEL.fly;
    const p = Math.max(0, Math.min(1, (el - dwellStart) / REEL.dwell));
    setCard(`${fmt(ev.date, 'day')} · ${ev.place}`, ev.title, `${ev.dir} · impact ${ev.mag} of 5 · ${ev.sub}${ev.auto ? ' · auto' : ''}`, p, ev.dir.toLowerCase().replace('-', ''));
    card.style.opacity = el < 300 ? String(el / 300) : el > step.ms - REEL.fade ? String(Math.max(0, (step.ms - el) / REEL.fade)) : '1';
  }
  if (el >= step.ms) { reel.i += 1; reel.t0 = t; }
}
function setCard(kicker, title, meta, progress, cls) {
  const card = $('reel-card');
  if (card.dataset.cls !== cls) { card.className = `reel-card ${cls}`; card.dataset.cls = cls; }
  if ($('reel-kicker').textContent !== kicker) $('reel-kicker').textContent = kicker;
  if ($('reel-title').textContent !== title) $('reel-title').textContent = title;
  if ($('reel-meta').textContent !== meta) $('reel-meta').textContent = meta;
  $('reel-bar').style.width = `${progress * 100}%`;
  if (cls === 'intro' || cls === 'outro') card.style.opacity = '1';
}

function frame(t) {
  requestAnimationFrame(frame);
  if (!globe.tex) return;
  if (reel) reelTick(t);
  if (isFlat()) { draw(t); return; }
  if (fly) {
    const k = Math.min(1, (t - fly.t0) / (fly.dur || 1));
    const e = 1 - (1 - k) ** 3;
    globe.lon0 = fly.l0 + fly.dl * e;
    globe.lat0 = fly.p0 + fly.dp * e;
    if (k >= 1) fly = null;
  } else if (state.rotate && !drag && t - lastMove > 2500) {
    globe.lon0 += 0.06 * Math.min(1, (t - lastMove - 2500) / 2000);
  }
  draw(t);
}

function draw(t) {
  const ctx = globe.ctx;
  const S = canvas.width;
  const k = K();
  if (isFlat()) {
    ctx.clearRect(0, 0, FLAT_W, FLAT_H);
    ctx.drawImage(texCanvas, 0, 0, FLAT_W, FLAT_H);
    ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.strokeRect(1, 1, FLAT_W - 2, FLAT_H - 2);
  } else {
    globe.drawBase();
    ctx.lineWidth = 2; ctx.strokeStyle = INK;
    ctx.beginPath(); ctx.arc(globe.cx, globe.cy, globe.R + 1, 0, Math.PI * 2); ctx.stroke();
  }
  if (state.layer === 'sev' && H) { drawSeverity(ctx, k, S); return; }
  const evs = windowEvents(events, state);
  const sel = state.selected;
  const hov = state.hover;
  for (const ev of evs) {
    if (!ev.arc) continue;
    const pts = greatCircle(ev.arc[0], ev.arc[1]);
    const emph = ev.id === sel || ev.id === hov;
    ctx.beginPath();
    let pen = false;
    let last = null;
    for (const [lon, lat, lift] of pts) {
      const [x, y, , z] = proj(lon, lat);
      if (z > -0.02) {
        const px = isFlat() ? x : globe.cx + (x - globe.cx) * lift;
        const py = isFlat() ? y : globe.cy + (y - globe.cy) * lift;
        // In the flat view, break the path where the arc crosses the antimeridian.
        if (pen && isFlat() && last && Math.abs(px - last) > FLAT_W / 2) pen = false;
        if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        pen = true;
        last = px;
      } else pen = false;
    }
    ctx.setLineDash(emph ? [] : [5 * k, 4 * k]);
    ctx.lineWidth = (emph ? 2.5 : 1.5) * k;
    ctx.strokeStyle = ev.dir === 'De-escalatory' ? 'rgba(243,242,242,.9)' : ACCENT;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  markers = [];
  const sorted = [...evs].sort((a, b) => (a.id === sel) - (b.id === sel));
  for (const ev of sorted) {
    const [x, y, vis] = proj(ev.lon, ev.lat);
    if (!vis) continue;
    const r = (ev.global ? 4 + ev.mag : 4 + ev.mag * 2.2) * k;
    const emph = ev.id === sel || ev.id === hov;
    markers.push({ ev, x, y, r });
    if (emph || ev.dir === 'Escalatory') {
      ctx.beginPath(); ctx.arc(x, y, r + (6 + ev.mag * 5) * k, 0, Math.PI * 2);
      ctx.strokeStyle = ev.dir === 'Escalatory' ? 'rgba(236,48,19,.45)' : 'rgba(243,242,242,.5)';
      ctx.lineWidth = k; ctx.stroke();
    }
    if (ev.id === sel) {
      const pulse = (t / 900) % 1;
      ctx.beginPath(); ctx.arc(x, y, r + (4 + pulse * 22) * k, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(236,48,19,${(1 - pulse) * 0.9})`; ctx.lineWidth = 2 * k; ctx.stroke();
    }
    ctx.lineWidth = 1.5 * k; ctx.strokeStyle = INK;
    if (ev.dir === 'Escalatory') {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = ACCENT; ctx.fill(); ctx.strokeStyle = GROUND; ctx.stroke();
    } else if (ev.dir === 'De-escalatory') {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(32,30,29,.55)'; ctx.fill(); ctx.strokeStyle = GROUND; ctx.lineWidth = 2 * k; ctx.stroke();
    } else if (ev.dir === 'Mixed') {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, Math.PI / 2, Math.PI * 1.5); ctx.fillStyle = GROUND; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.strokeStyle = GROUND; ctx.lineWidth = 2 * k; ctx.stroke();
    } else {
      const s = Math.max(6 * k, r * 1.2);
      ctx.fillStyle = GROUND; ctx.fillRect(x - s / 2, y - s / 2, s, s);
      ctx.strokeStyle = INK; ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    }
    if (emph) {
      ctx.font = `600 ${14 * k}px Archivo, system-ui, sans-serif`; ctx.textBaseline = 'middle';
      const label = ev.place;
      const w = ctx.measureText(label).width;
      const lx = x + r + 10 * k + w > S - 8 ? x - r - 10 * k - w : x + r + 10 * k;
      ctx.fillStyle = INK; ctx.fillRect(lx - 5 * k, y - 11 * k, w + 10 * k, 22 * k);
      ctx.fillStyle = GROUND; ctx.fillText(label, lx, y);
    }
  }
}

// The severity layer: one square per assessed country, its category inside.
function drawSeverity(ctx, k, S) {
  markers = [];
  for (const c of H.rows) {
    const pt = PTS[c.isoNum];
    if (!pt) continue;
    const [x, y, vis] = proj(pt[0], pt[1]);
    if (!vis) continue;
    const r = (6 + c.category * 1.2) * k;
    const emph = state.hover === `h:${c.iso3}`;
    markers.push({ hum: c, x, y, r });
    ctx.fillStyle = SEV_COLOURS[c.category];
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.lineWidth = (emph ? 3 : 1.5) * k; ctx.strokeStyle = emph ? ACCENT : INK; ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    ctx.fillStyle = c.category >= 3 ? GROUND : INK;
    ctx.font = `800 ${(9 + c.category) * k}px Archivo, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(c.category), x, y + 0.5 * k);
    ctx.textAlign = 'start';
    if (emph) {
      ctx.font = `600 ${14 * k}px Archivo, system-ui, sans-serif`;
      const w = ctx.measureText(c.country).width;
      const lx = x + r + 10 * k + w > S - 8 ? x - r - 10 * k - w : x + r + 10 * k;
      ctx.fillStyle = INK; ctx.fillRect(lx - 5 * k, y - 11 * k, w + 10 * k, 22 * k);
      ctx.fillStyle = GROUND; ctx.fillText(c.country, lx, y);
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
  stopReel();
  const ms = { day: 90, week: 160, month: 220, year: 700 }[state.scale];
  timer = setInterval(() => {
    const next = addUnit(unitStart(state.from, state.scale), state.scale, 1);
    if (next > END) { stopPlay(); render(); return; }
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
$('range-caption').textContent = `1900 → ${fmt(END, 'day')} · `;
$('year-last').textContent = END.slice(0, 4);
const scaleBar = $('scales');
for (const [id, label] of [['day', 'Days'], ['week', 'Weeks'], ['month', 'Months'], ['year', 'Years']]) {
  scaleBar.append(h('button', { type: 'button', class: 'seg', 'data-scale': id, onclick: () => setScale(id) }, label));
}
$('play').addEventListener('click', () => { stopReel(); togglePlay(); });
$('reel').addEventListener('click', () => (reel ? stopReel() : startReel()));
$('view-globe').addEventListener('click', () => { state.view = 'globe'; applyView(); render(); });
$('view-flat').addEventListener('click', () => { state.view = 'flat'; applyView(); render(); });
function setLayer(layer) { stopReel(); state.layer = layer; state.hover = null; applyLayer(); render(); }
$('layer-events').addEventListener('click', () => setLayer('events'));
$('layer-sev').addEventListener('click', () => setLayer('sev'));
$('rotate').addEventListener('click', () => { state.rotate = !state.rotate; lastMove = performance.now(); render(); });
$('prev').addEventListener('click', () => jump(-1));
$('next').addEventListener('click', () => jump(1));
$('mode-window').addEventListener('click', () => { state.cumulative = false; render(); });
$('mode-cumulative').addEventListener('click', () => { state.cumulative = true; render(); });
const eraBar = $('era-shortcuts');
for (const era of ERAS) eraBar.append(h('button', { type: 'button', class: 'ghost', onclick: () => goEra(era) }, era.label));

const strip = $('strip');
const stripCells = [];
const Y0 = +RANGE_START.slice(0, 4);
const Y1 = +END.slice(0, 4);
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
slider.max = daysBetween(RANGE_START, END);
slider.addEventListener('input', () => setFrom(addDays(RANGE_START, +slider.value)));
$('groups-reset').addEventListener('click', () => { state.groupsOff = {}; state.subsOff = {}; render(); });

const mechList = $('mechanisms');
const images = { 1: 'the leader', 2: 'the state', 3: 'the system' };
for (const m of mechanisms) {
  mechList.append(h('li', {}, h('p', { class: 'mtitle' }, m.name, ' ', h('span', { class: 'image' }, images[m.image])), h('p', { class: 'mnote' }, m.short)));
}

// ---------- the situation briefing ----------
// Built once from the record; render() only marks the chosen theater.
const brief = summarize(events, END);
$('brief-date').textContent = `As of ${new Date(`${END}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`;
$('brief-line').textContent = headline(brief);

function showLatest(scale) {
  stopPlay(); stopReel();
  state.cumulative = false;
  state.selected = null;
  setFrom(END, { scale });
}
$('brief-day').addEventListener('click', () => showLatest('day'));
$('brief-week').addEventListener('click', () => showLatest('week'));
$('brief-reel').addEventListener('click', () => { showLatest('day'); setTimeout(startReel, 300); });

function setTheater(id) {
  state.theater = id && state.theater !== id ? id : null;
  state.selected = null;
  const t = state.theater && theater(state.theater);
  if (t) flyTo(t.centre[0], t.centre[1]);
  render();
}
$('theater-clear').addEventListener('click', () => setTheater(null));
const thSel = $('theater-select');
thSel.append(h('option', { value: '' }, 'All theaters'), ...[...THEATERS, OTHER].map((t) => h('option', { value: t.id }, t.label)));
thSel.addEventListener('change', () => setTheater(thSel.value || null));

const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) el.append(c);
  return el;
}
// Bars above the line are escalatory impact, below are de-escalatory.
function bars(target, days, w, h, zero, { hit = false, mark = null } = {}) {
  const max = Math.max(4, ...days.map((d) => Math.max(d.up, d.down)));
  const bw = w / days.length;
  target.replaceChildren();
  days.forEach((d, i) => {
    const x = i * bw;
    if (hit && i % 7 === (days.length - 1) % 7 && i < days.length - 1) target.append(svg('line', { class: 'wk', x1: x + bw, x2: x + bw, y1: 0, y2: h }));
    if (d.up) target.append(svg('rect', { class: 'up', x: x + 1, y: zero - (d.up / max) * (zero - 2), width: Math.max(1, bw - 2), height: (d.up / max) * (zero - 2) }));
    if (d.down) target.append(svg('rect', { class: 'down', x: x + 1, y: zero, width: Math.max(1, bw - 2), height: (d.down / max) * (h - zero - 2) }));
    if (mark === d.date) target.append(svg('rect', { class: 'cur', x: x + 0.5, y: 0.5, width: bw - 1, height: h - 1 }));
    if (hit) {
      const r = svg('rect', { class: 'hit', x, y: 0, width: bw, height: h, 'data-date': d.date },
        svg('title', {}, `${fmt(d.date, 'day')}: ${d.n} ${d.n === 1 ? 'event' : 'events'}, escalatory impact ${d.up}, de-escalatory ${d.down}`));
      target.append(r);
    }
  });
  target.append(svg('line', { class: 'zero', x1: 0, x2: w, y1: zero, y2: zero }));
}
const pulseDays = dailyPulse(events, END, 45);
const pulseSvg = $('pulse');
pulseSvg.addEventListener('click', (e) => {
  const d = e.target.closest('[data-date]');
  if (d) { stopPlay(); stopReel(); state.cumulative = false; state.selected = null; setFrom(d.dataset.date, { scale: 'day' }); }
});
$('pulse-axis').replaceChildren(...[0, 15, 30, 44].map((i) => h('span', {}, fmt(pulseDays[i].date, 'day').replace(/ \d{4}$/, ''))));

const TREND = { hotter: '▲ hotter', cooler: '▼ calmer', steady: '= steady', quiet: 'quiet' };
const thCards = {};
$('theaters').replaceChildren(...brief.theaters.map((t) => {
  const spark = svg('svg', { class: 'th-spark', viewBox: '0 0 120 26', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  bars(spark, t.spark, 120, 26, 16);
  const latest = t.latest;
  const card = h('div', { class: 'th' },
    h('button', { type: 'button', class: 'th-pick', title: `Show only ${t.label}`, onclick: () => setTheater(t.id) },
      h('div', { class: 'th-top' }, h('span', { class: 'th-name' }, t.label), h('span', { class: `th-trend ${t.trend}` }, TREND[t.trend])),
      spark,
      h('div', { class: 'th-nums' }, h('b', {}, String(t.week.n)), ` this week · ${t.prevWeek.n} the week before`, t.today ? ` · ${t.today} today` : ''),
    ),
    thSevLine(t.id),
    latest
      ? h('button', { type: 'button', class: 'th-latest', title: latest.title, onclick: () => { state.cumulative = false; if (state.theater && state.theater !== t.id) state.theater = null; select(latest.id); revealRow(latest.id); } },
        h('span', { class: 'd' }, fmt(latest.date, 'day').replace(/ \d{4}$/, '')), latest.title)
      : h('span', { class: 'th-latest none' }, 'Nothing recorded yet.'),
  );
  thCards[t.id] = card;
  return card;
}));

$('theaters-more').addEventListener('click', () => {
  const box = $('theaters');
  box.classList.toggle('collapsed');
  $('theaters-more').textContent = box.classList.contains('collapsed') ? `Show all ${brief.theaters.length} theaters` : 'Show fewer';
});
$('theaters-more').textContent = `Show all ${brief.theaters.length} theaters`;

function thSevLine(id) {
  const ts = H && id !== 'other' && theaterSeverity(H, id);
  if (!ts) return null;
  const names = ts.countries.slice(0, 3).map((c) => c.country).join(', ') + (ts.countries.length > 3 ? ` +${ts.countries.length - 3}` : '');
  return h('div', { class: 'th-sev', title: 'Highest INFORM Severity category among this theater\'s countries' }, h('i', { class: `sv s${ts.category}` }), `Crisis severity ${ts.category}: ${names}`);
}

function renderBrief() {
  const sel = state.scale === 'day' && !state.cumulative ? state.from : null;
  bars(pulseSvg, pulseDays, 450, 132, 84, { hit: true, mark: sel });
  for (const [id, el] of Object.entries(thCards)) {
    el.classList.toggle('on', state.theater === id);
    el.classList.toggle('dim', !!state.theater && state.theater !== id);
  }
  $('theater-clear').hidden = !state.theater;
  thSel.value = state.theater || '';
}

// ---------- humanitarian assessment ----------
const assess = { region: '', all: false };
function sevSentence(c) {
  const bits = [`Crisis severity ${c.category} of 5, ${SEV_WORDS[c.category]} (index ${c.index} of 10), ${c.trend.toLowerCase()} over the last three months.`];
  if (c.pin) bits.push(`${people(c.pin)} people in need${c.displaced ? `, ${people(c.displaced)} displaced` : ''}.`);
  bits.push(`Drivers: ${c.drivers.join(', ').toLowerCase()}.`);
  return bits.join(' ');
}
function renderAssessment() {
  if (!H) { $('assess').hidden = true; return; }
  const src = hum.source;
  $('assess-src').replaceChildren('Each crisis rated 1 to 5 by ', h('a', { href: src.url, rel: 'noopener', target: '_blank' }, `${src.publisher}'s ${src.name}`),
    `, ${src.edition} edition (${src.license}). It combines the scale of the crisis, the conditions of the people in it, and how hard it is to reach them. ACAPS also rates how reliable its own data is for each country.`);
  $('sev-edition').textContent = src.edition;
  const rows = H.rows.filter((c) => !assess.region || c.region === assess.region);
  const shown = assess.all ? rows : rows.slice(0, 12);
  $('assess-count').textContent = `${rows.length} countries`;
  $('assess-more').hidden = rows.length <= 12;
  $('assess-more').textContent = assess.all ? 'Show fewer' : `Show all ${rows.length}`;
  $('assess-list').replaceChildren(...shown.map((c) => h('li', { class: 'arow' },
    h('div', { class: `cat c${c.category}`, title: `Category ${c.category} of 5` }, String(c.category)),
    h('div', {},
      h('div', { class: 'nm' }, c.country),
      h('div', { class: 'sub' }, `${c.label} · index ${c.index}`, c.pin ? h('span', {}, ' · ', h('b', {}, people(c.pin)), ' in need') : '', c.displaced ? ` · ${people(c.displaced)} displaced` : ''),
      h('div', { class: 'sub' }, c.drivers.join(', '), ` · data reliability ${c.reliability.toLowerCase()}`),
    ),
    h('span', { class: `tr ${c.trend}` }, { Increasing: '▲ worsening', Decreasing: '▼ easing', Stable: '= stable' }[c.trend] || c.trend),
    h('div', { class: 'acts' },
      h('button', { type: 'button', class: 'play', onclick: () => openHelp(c) }, 'How to help'),
      h('button', { type: 'button', class: 'ghost', onclick: () => { const pt = PTS[c.isoNum]; setLayer('sev'); if (pt) flyTo(pt[0], pt[1]); $('globe').scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 'On the map'),
      h('a', { class: 'ghost', href: c.url, target: '_blank', rel: 'noopener' }, 'ACAPS ↗'),
    ),
  )));
}
if (H) {
  const regions = [...new Set(H.rows.map((c) => c.region))].sort();
  $('assess-region').append(h('option', { value: '' }, 'All regions'), ...regions.map((r) => h('option', { value: r }, r)));
  $('assess-region').addEventListener('change', (e) => { assess.region = e.target.value; renderAssessment(); });
  $('assess-more').addEventListener('click', () => { assess.all = !assess.all; renderAssessment(); });
}
renderAssessment();

// ---------- how to help ----------
const helpdlg = $('helpdlg');
// Rank by public trust checks passed, then country-specific pages first.
function trustOf(id) { return trust && trust.orgs[id]; }
function rankEntries(list) {
  const score = (e) => { const t = trustOf(e.org); return t && t.total ? t.passed / t.total : 0; };
  return [...list].sort((a, b) => score(b) - score(a) || (!!a.general - !!b.general) || helpDoc.orgs[a.org].name.localeCompare(helpDoc.orgs[b.org].name));
}
function trustLine(id) {
  const t = trustOf(id);
  if (!t) return null;
  const deductible = t.checks.find((c) => c.id === 'deductible')?.pass;
  return h('details', { class: 'trust' },
    h('summary', {},
      deductible ? h('span', { class: 'ded' }, 'US tax-deductible') : h('span', { class: 'flag' }, 'Not on the IRS deductible list'),
      ` · EIN ${t.ein} · `,
      h('span', { class: t.flags.length ? 'flag' : 'ok' }, `${t.passed} of ${t.total} public checks`),
      t.flags.length ? h('span', { class: 'flag' }, ` · look closer: ${t.flags.join('; ').toLowerCase()}`) : ''),
    h('ul', { class: 'checks' }, ...t.checks.map((c) => h('li', { class: c.pass === false ? 'fail' : c.pass ? 'pass' : 'na' },
      h('b', {}, c.pass === false ? '✕ ' : c.pass ? '✓ ' : '? '), `${c.label}. ${c.detail} `, h('a', { href: c.link, target: '_blank', rel: 'noopener' }, 'Check it ↗')))),
    h('p', { class: 'checks-who' }, t.usSite ? `The Donate button goes to ${t.usName}, the US entity with this EIN. Also see ` : `The Donate button is the international page. For a US tax deduction, give to ${t.usName} directly; its site blocks automated checks, so find it by name or EIN. Also see `, h('a', { href: t.links.charityNavigator, target: '_blank', rel: 'noopener' }, 'Charity Navigator'), ', ',
      h('a', { href: t.links.bbb, target: '_blank', rel: 'noopener' }, 'BBB Wise Giving Alliance'), ' and ', h('a', { href: t.links.propublica, target: '_blank', rel: 'noopener' }, 'its filings on ProPublica'), '.'),
  );
}
function orgItem(id, entry, country) {
  const o = helpDoc.orgs[id];
  if (!o || (entry && entry.general && entry.org !== 'wck' && !o.donate)) return null;
  const links = [];
  if (entry && !entry.general) links.push(h('a', { href: entry.url, target: '_blank', rel: 'noopener' }, `Their work in ${country} ↗`));
  if (entry && entry.org === 'wck') links.push(h('a', { href: entry.url, target: '_blank', rel: 'noopener' }, 'Where WCK is cooking ↗'));
  // A US entity's own page when it loads; otherwise the group's international page.
  const t = trustOf(id);
  const giveUrl = (t && t.usSite) || o.donate;
  if (giveUrl) links.push(h('a', { class: 'give', href: giveUrl, target: '_blank', rel: 'noopener', title: t && t.usSite ? `US tax-deductible gift to ${t.usName}` : 'International donation page' }, entry && entry.general && id === 'unhcr' && !(t && t.usSite) ? 'Global appeal ↗' : 'Donate ↗'));
  return h('li', {},
    h('span', { class: 'on' }, o.name, o.kind === 'un' ? h('span', { class: 'un' }, 'UN agency') : ''),
    h('span', { class: 'ow' }, o.what),
    h('span', { class: 'ol' }, ...links),
    trustLine(id),
  );
}
function openHelp(c) {
  if (!helpDoc) { $('how-to-help').scrollIntoView(); return; }
  stopReel();
  $('helpdlg-title').textContent = `How to help: ${c.country}`;
  $('helpdlg-sev').replaceChildren(h('i', { class: `sv s${c.category}` }), ' ', sevSentence(c), ' ', h('a', { href: c.url, target: '_blank', rel: 'noopener' }, 'ACAPS crisis page ↗'));
  $('helpdlg-checked').textContent = helpDoc.checked;
  const entries = rankEntries(helpDoc.countries[c.iso3] || []);
  const body = [];
  if (entries.length) {
    body.push(h('p', { class: 'rankline' }, `Ranked by public trust checks, then by whether the group has a page about ${c.country}. Open a line to see each check and repeat it yourself.`),
      h('ol', { class: 'orglist' }, ...entries.map((e) => orgItem(e.org, e, c.country))));
  } else {
    body.push(h('p', {}, `None of the groups this page checks has a page about ${c.country} right now. These work across many crises and accept general donations:`),
      h('ol', { class: 'orglist' }, ...rankEntries(Object.keys(helpDoc.orgs).map((org) => ({ org, general: true }))).map((e) => orgItem(e.org, null, c.country))));
  }
  $('helpdlg-body').replaceChildren(...body);
  helpdlg.hidden = false;
  helpdlg.querySelector('[data-close]').focus();
}
function closeHelp() { helpdlg.hidden = true; }
helpdlg.addEventListener('click', (e) => {
  if (e.target === helpdlg) { closeHelp(); return; }
  const b = e.target.closest('[data-close]');
  if (!b) return;
  e.preventDefault();
  closeHelp();
  if (b.getAttribute('href') === '#how-to-help') $('how-to-help').scrollIntoView({ behavior: 'smooth' });
});
// "#help" links scroll without touching the hash, which holds the page state.
for (const a of document.querySelectorAll('a.tohelp')) a.addEventListener('click', (e) => { e.preventDefault(); $('how-to-help').scrollIntoView({ behavior: 'smooth' }); });

function renderGuideLinks() {
  if (!helpDoc) return;
  const li = (x) => h('li', {}, h('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.name), h('span', {}, ` · ${x.what}`));
  $('help-check').replaceChildren(...helpDoc.general.check.map(li));
  $('help-civic').replaceChildren(...helpDoc.general.civic.map(li));
  $('help-act').replaceChildren(...helpDoc.general.act.map(li));
  $('help-orgs').replaceChildren(...rankEntries(Object.keys(helpDoc.orgs).filter((id) => helpDoc.orgs[id].donate).map((org) => ({ org, general: true })))
    .map(({ org }) => { const o = helpDoc.orgs[org]; return h('li', {}, h('a', { href: o.donate, target: '_blank', rel: 'noopener' }, o.name), h('span', {}, ` · ${o.kind === 'un' ? 'UN agency · ' : ''}${o.what}`), trustLine(org)); }));
  $('help-checked').textContent = `Every link in this section was checked on ${helpDoc.checked}; ones that failed were left out.`;
}
renderGuideLinks();

// ---------- the guide ----------
const guide = $('guide');
function openGuide() { guide.hidden = false; guide.querySelector('button').focus(); }
function closeGuide() { guide.hidden = true; try { localStorage.setItem('dtw:guide', '1'); } catch { /* private mode */ } }
$('help').addEventListener('click', openGuide);
guide.addEventListener('click', (e) => {
  if (e.target === guide) closeGuide();
  const b = e.target.closest('[data-go]');
  if (!b) return;
  closeGuide();
  const go = b.dataset.go;
  if (go === 'reel') { state.scale = 'day'; state.from = END; state.cumulative = false; render(); setTimeout(startReel, 400); }
  else if (go === '2011') { goEra(ERAS.find((e) => e.label === 'Since 2011')); setTimeout(togglePlay, 600); }
  else if (go === '1939') goEra(ERAS.find((e) => e.label === '1939'));
});
let seen = false;
try { seen = localStorage.getItem('dtw:guide') === '1'; } catch { seen = true; }
if (!seen && !wantReel && !location.hash) setTimeout(openGuide, 500);

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'Escape') { if (!helpdlg.hidden) closeHelp(); else if (!guide.hidden) closeGuide(); else if (reel) stopReel(); else if (state.playing) { stopPlay(); render(); } return; }
  if (!guide.hidden) return;
  if (e.key === ' ') { e.preventDefault(); if (reel) stopReel(); else togglePlay(); }
  else if (e.key === 'ArrowRight') jump(1);
  else if (e.key === 'ArrowLeft') jump(-1);
  else if (e.key === 'r' || e.key === 'R') (reel ? stopReel() : startReel());
  else if (e.key === '?') openGuide();
});

// ---------- render ----------
function render() {
  history.replaceState(null, '', toHash(state));
  const { unit, end } = windowBounds(state);
  const win = windowEvents(events, state);

  for (const b of scaleBar.children) b.setAttribute('aria-pressed', b.dataset.scale === state.scale);
  const thLabel = state.theater ? ` · ${theater(state.theater).label}` : '';
  $('mode-label').textContent = (state.cumulative ? `Cumulative since ${Y0}` : `${state.scale} window`) + thLabel;
  $('window-label').textContent = state.cumulative ? `→ ${fmt(end, 'day')}` : fmt(unit, state.scale);
  const sev = state.layer === 'sev' && H;
  $('window-count').textContent = sev ? `${H.rows.length} assessed countries` : `${win.length} events · ${win.filter((e) => e.arc).length} links`;
  $('layer-events').setAttribute('aria-pressed', !sev);
  $('layer-sev').setAttribute('aria-pressed', !!sev);
  $('layer-sev').hidden = !H;
  $('sev-legend').hidden = !sev;
  $('ev-legend').hidden = !!sev;
  $('play').textContent = state.playing ? '❚❚ Pause' : '▶ Play';
  $('reel').textContent = reel ? '■ Stop reel' : '▶ Reel';
  $('reel').setAttribute('aria-pressed', !!reel);
  $('view-globe').setAttribute('aria-pressed', !isFlat());
  $('view-flat').setAttribute('aria-pressed', isFlat());
  $('rotate').textContent = state.rotate ? '❚❚ Pause globe' : '↻ Spin globe';
  $('rotate').setAttribute('aria-pressed', !state.rotate);
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
  renderBrief();
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
            ev.auto && h('span', { class: 'auto', title: 'Drafted by the daily job from the linked source; not yet reviewed' }, 'auto'),
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
          H && eventCountries(H, ev).length > 0 && h('div', { class: 'sevchips' },
            ...eventCountries(H, ev).map((c) => h('button', { type: 'button', class: 'sevchip', title: `INFORM Severity ${hum.source.edition}`, onclick: () => openHelp(c) },
              h('i', { class: `sv s${c.category}` }), `${c.country}: crisis severity ${c.category} of 5 · how to help`))),
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
  if (state.hover && state.hover.startsWith('h:') && state.hoverPos && H) {
    const c = H.byIso3[state.hover.slice(2)];
    tip.hidden = false;
    tip.style.left = `${state.hoverPos[0] + 20}px`;
    tip.style.top = `${state.hoverPos[1] + 8}px`;
    $('tip-title').textContent = `${c.country}: severity ${c.category} of 5, ${SEV_WORDS[c.category]}`;
    $('tip-meta').textContent = `${c.pin ? `${people(c.pin)} people in need · ` : ''}trend ${c.trend.toLowerCase()} · tap for how to help`;
    return;
  }
  const ev = state.hover && state.hoverPos ? events.find((e) => e.id === state.hover) : null;
  tip.hidden = !ev;
  if (!ev) return;
  tip.style.left = `${state.hoverPos[0] + 20}px`;
  tip.style.top = `${state.hoverPos[1] + 8}px`;
  $('tip-title').textContent = ev.title;
  $('tip-meta').textContent = `${fmt(ev.date, 'day')} · ${ev.dir} · impact ${ev.mag}`;
}

applyLayer();
applyView();
const startAt = state.theater ? theater(state.theater).centre : [48, 30];
flyTo(startAt[0], startAt[1], 0);
render();
requestAnimationFrame(frame);
if (wantReel) setTimeout(startReel, 600);
