// Decode world-atlas countries-110m.json (TopoJSON, public domain Natural
// Earth data) into equirectangular SVG path strings. No dependencies.
// Output: data/world-paths.json, an array of { id, name, d }.
// Coordinate space matches src/geo.js: x = (lon + 180) / 360 * 1000,
// y = (90 - lat) / 180 * 500.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { project } from '../src/geo.js';

const here = dirname(fileURLToPath(import.meta.url));
const topo = JSON.parse(readFileSync(join(here, 'countries-110m.json'), 'utf8'));
const { scale, translate } = topo.transform;

// Delta-decode every arc once.
const arcs = topo.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
});

function ring(arcRefs) {
  const pts = [];
  for (const ref of arcRefs) {
    let a = ref < 0 ? arcs[~ref].slice().reverse() : arcs[ref];
    if (pts.length) a = a.slice(1);
    pts.push(...a);
  }
  return pts;
}

// Break a ring wherever it jumps across the antimeridian, so Russia and
// Antarctica do not draw a line across the whole map.
function ringToPath(pts) {
  let d = '';
  let open = false;
  for (let i = 0; i < pts.length; i++) {
    const [lon, lat] = pts[i];
    const jump = i > 0 && Math.abs(lon - pts[i - 1][0]) > 180;
    const [x, y] = project(lon, lat);
    if (!open || jump) {
      if (open) d += 'Z';
      d += `M${x.toFixed(1)} ${y.toFixed(1)}`;
      open = true;
    } else {
      d += `L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  }
  return d + 'Z';
}

const out = [];
for (const g of topo.objects.countries.geometries) {
  const polys = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
  const d = polys.map((poly) => poly.map((r) => ringToPath(ring(r))).join('')).join('');
  if (d) out.push({ id: g.id, name: g.properties?.name ?? '', d });
}
writeFileSync(join(here, '..', 'data', 'world-paths.json'), JSON.stringify(out));
console.log(`wrote ${out.length} countries`);
