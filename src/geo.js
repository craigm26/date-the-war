// Equirectangular projection into a 1000 x 500 box. Pure, shared by the
// build script, the tests, and the page.
export const W = 1000;
export const H = 500;

export function project(lon, lat) {
  return [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];
}

// The visible window of the map: latitudes 84 north to 58 south, which
// drops most of Antarctica and the empty Arctic.
export const VIEWBOX = (() => {
  const [, top] = project(0, 84);
  const [, bottom] = project(0, -58);
  return `0 ${top.toFixed(1)} ${W} ${(bottom - top).toFixed(1)}`;
})();

// A gentle arc between two projected points, bowing toward the north so
// links do not lie flat across the equator.
export function arcPath(a, b) {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - Math.min(80, Math.hypot(x2 - x1, y2 - y1) * 0.25);
  return `M${x1.toFixed(1)} ${y1.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}
