// Orthographic globe renderer: equirectangular texture + per-pixel inverse lookup.
const TW = 2048, TH = 1024;
const D2R = Math.PI / 180;

function decodeArcs(topo) {
  const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
  return topo.arcs.map(arc => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
}
function rings(topo, arcs, obj) {
  const out = [];
  for (const g of topo.objects[obj].geometries) {
    const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    for (const poly of polys) for (const ring of poly) {
      const pts = [];
      for (const a of ring) { const seg = a < 0 ? arcs[~a].slice().reverse() : arcs[a]; for (const p of seg) pts.push(p); }
      out.push(pts);
    }
  }
  return out;
}

export function buildTexture(topo, { ocean, land, border, grid }) {
  const arcs = decodeArcs(topo);
  const c = document.createElement('canvas'); c.width = TW; c.height = TH;
  const ctx = c.getContext('2d');
  ctx.fillStyle = ocean; ctx.fillRect(0, 0, TW, TH);
  const px = (lon, lat) => [((lon + 180) / 360) * TW, ((90 - lat) / 180) * TH];
  if (grid) {
    ctx.strokeStyle = grid; ctx.lineWidth = 1.2;
    for (let lon = -180; lon < 180; lon += 30) { const [x] = px(lon, 0); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, TH); ctx.stroke(); }
    for (let lat = -60; lat <= 60; lat += 30) { const [, y] = px(0, lat); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TW, y); ctx.stroke(); }
  }
  // Rings that cross the antimeridian are unwrapped (longitudes kept
  // continuous past +-180) and drawn three times, shifted by one texture
  // width each way, so the fill never sweeps across the whole map.
  const unwrap = (r) => {
    const out = [];
    let prev = null;
    let off = 0;
    for (const [lon, lat] of r) {
      if (prev !== null) { const d = lon - prev; if (d > 180) off -= 360; else if (d < -180) off += 360; }
      out.push([lon + off, lat]);
      prev = lon;
    }
    return out;
  };
  const draw = (rs, fill, stroke) => {
    ctx.beginPath();
    for (const r0 of rs) {
      const r = unwrap(r0);
      for (const shift of [-TW, 0, TW]) {
        r.forEach(([lon, lat], i) => { const [x, y] = px(lon, lat); i ? ctx.lineTo(x + shift, y) : ctx.moveTo(x + shift, y); });
        ctx.closePath();
      }
    }
    if (fill) { ctx.fillStyle = fill; ctx.fill('evenodd'); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.4; ctx.stroke(); }
  };
  draw(rings(topo, arcs, 'land'), land, null);
  draw(rings(topo, arcs, 'countries'), null, border);
  const img = ctx.getImageData(0, 0, TW, TH);
  return new Uint32Array(img.data.buffer);
}

export class Globe {
  constructor(canvas, size) {
    this.canvas = canvas; this.size = size; canvas.width = size; canvas.height = size;
    this.ctx = canvas.getContext('2d');
    this.R = size * 0.46; this.cx = size / 2; this.cy = size / 2;
    this.lon0 = 40; this.lat0 = 22; this.tex = null;
    this.img = this.ctx.createImageData(size, size);
    this.out = new Uint32Array(this.img.data.buffer);
    this.n = 0; this.idx = new Int32Array(size * size); this.rowOff = new Int32Array(size * size); this.baseU = new Float32Array(size * size);
    this.cachedLat = null;
    this.ux = new Float32Array(size * size); this.uy = new Float32Array(size * size); this.uz = new Float32Array(size * size);
    let n = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - this.cx) / this.R, dy = (this.cy - y - 0.5) / this.R, d2 = dx * dx + dy * dy;
      if (d2 <= 1) { this.idx[n] = y * size + x; this.ux[n] = dx; this.uy[n] = dy; this.uz[n] = Math.sqrt(1 - d2); n++; }
    }
    this.n = n;
  }
  setTexture(tex) { this.tex = tex; }
  precompute() {
    const a = -this.lat0 * D2R, ca = Math.cos(a), sa = Math.sin(a);
    for (let i = 0; i < this.n; i++) {
      const x1 = -this.ux[i], y1 = this.uy[i] * ca - this.uz[i] * sa, z1 = this.uy[i] * sa + this.uz[i] * ca;
      const lat = Math.asin(Math.max(-1, Math.min(1, y1)));
      const th1 = Math.atan2(z1, x1);
      this.rowOff[i] = Math.min(TH - 1, Math.max(0, Math.floor(((Math.PI / 2 - lat) / Math.PI) * TH))) * TW;
      this.baseU[i] = ((th1 - Math.PI / 2 + Math.PI) / (2 * Math.PI)) * TW;
    }
    this.cachedLat = this.lat0;
  }
  // forward projection of lon/lat → [x, y, visible, depth]
  project(lon, lat) {
    const la = lat * D2R, lo = lon * D2R;
    const gx = Math.cos(la) * Math.cos(lo), gy = Math.sin(la), gz = Math.cos(la) * Math.sin(lo);
    const b = Math.PI / 2 - this.lon0 * D2R, cb = Math.cos(b), sb = Math.sin(b);
    // inverse of Ry(b): Ry(-b)
    const x1 = gx * cb - gz * sb, z1 = gx * sb + gz * cb, y1 = gy;
    const a = this.lat0 * D2R, ca = Math.cos(a), sa = Math.sin(a); // inverse of Rx(-lat0) = Rx(lat0)
    const y2 = y1 * ca - z1 * sa, z2 = y1 * sa + z1 * ca;
    return [this.cx - x1 * this.R, this.cy - y2 * this.R, z2 > 0, z2];
  }
  drawBase(oceanCss) {
    if (!this.tex) return;
    if (this.cachedLat !== this.lat0) this.precompute();
    const shift = (this.lon0 / 360) * TW;
    const out = this.out, tex = this.tex, idx = this.idx, rowOff = this.rowOff, baseU = this.baseU;
    out.fill(0);
    for (let i = 0; i < this.n; i++) {
      let u = baseU[i] + shift; u = u - TW * Math.floor(u / TW);
      out[idx[i]] = tex[rowOff[i] + (u | 0)];
    }
    this.ctx.clearRect(0, 0, this.size, this.size);
    this.ctx.putImageData(this.img, 0, 0);
  }
}

// great-circle sample points between two lon/lat pairs
export function greatCircle(a, b, n = 48) {
  const [lo1, la1] = [a[0] * D2R, a[1] * D2R], [lo2, la2] = [b[0] * D2R, b[1] * D2R];
  const p = v => [Math.cos(v[1]) * Math.cos(v[0]), Math.sin(v[1]), Math.cos(v[1]) * Math.sin(v[0])];
  const A = p([lo1, la1]), B = p([lo2, la2]);
  const d = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s1 = Math.sin((1 - t) * d) / Math.sin(d || 1e-9), s2 = Math.sin(t * d) / Math.sin(d || 1e-9);
    const x = A[0] * s1 + B[0] * s2, y = A[1] * s1 + B[1] * s2, z = A[2] * s1 + B[2] * s2;
    const lift = 1 + 0.08 * Math.sin(Math.PI * t); // bow slightly above the surface
    pts.push([Math.atan2(z, x) / D2R, Math.asin(Math.max(-1, Math.min(1, y))) / D2R, lift]);
  }
  return pts;
}
