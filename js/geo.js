// GeoJSON helpers shared by the map exports: a local projection from game units to
// longitude/latitude, and a dissolve that merges touching cells into outlines.
// Pure: no DOM, no three.js.

const M_PER_DEG_LAT = 110574;
const M_PER_DEG_LON = 111320;

// Game plane (x east, z south) to [lon, lat], placing game (0, 0) at `origin`.
export function projector(origin = [0, 0], metersPerUnit = 1) {
  const [lon0, lat0] = origin;
  const kx = metersPerUnit / (M_PER_DEG_LON * Math.cos((lat0 * Math.PI) / 180));
  const kz = metersPerUnit / M_PER_DEG_LAT;
  const r = (v) => Math.round(v * 1e8) / 1e8;
  return ([x, z]) => [r(lon0 + x * kx), r(lat0 - z * kz)];
}

const pkey = ([x, z]) => `${Math.round(x * 1e4)},${Math.round(z * 1e4)}`;

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
}

function inside(pt, ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// Drops points that sit on a straight line between their neighbours.
function simplify(ring) {
  const out = [];
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n];
    const b = ring[i];
    const c = ring[(i + 1) % n];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-9) out.push(b);
  }
  out.push(out[0]);
  return out;
}

// Merges polygons that share edges. Each input is one closed ring of [x, z] points, all wound
// the same way, with shared corners at exactly the same coordinates. Returns polygons as
// [outer, ...holes] rings, still in game units.
export function dissolve(rings) {
  const edges = new Map(); // "a>b" -> [a, b]
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      const back = pkey(b) + '>' + pkey(a);
      if (edges.has(back)) edges.delete(back);
      else edges.set(pkey(a) + '>' + pkey(b), [a, b]);
    }
  }
  const from = new Map();
  for (const [k, e] of edges) {
    const s = k.split('>')[0];
    if (!from.has(s)) from.set(s, []);
    from.get(s).push(e);
  }
  const loops = [];
  for (const list of from.values()) {
    while (list.length) {
      const start = list.pop();
      const ring = [start[0]];
      let cur = start;
      for (let guard = 0; guard < 100000; guard++) {
        ring.push(cur[1]);
        if (pkey(cur[1]) === pkey(ring[0])) break;
        const next = from.get(pkey(cur[1]));
        if (!next || !next.length) break;
        cur = next.pop();
      }
      if (ring.length >= 4) loops.push(simplify(ring));
    }
  }
  const sign = Math.sign(signedArea(rings[0] || [[0, 0]]));
  const outers = loops.filter((l) => Math.sign(signedArea(l)) === sign).map((l) => [l]);
  for (const hole of loops.filter((l) => Math.sign(signedArea(l)) !== sign)) {
    const home = outers.find((o) => inside(hole[0], o[0]));
    if (home) home.push(hole);
  }
  return outers;
}

// GeoJSON wants outer rings counter-clockwise and holes clockwise (RFC 7946).
function wind(ring, ccw) {
  return signedArea(ring) > 0 === ccw ? ring : [...ring].reverse();
}

export function polygonGeometry(polys, project) {
  const coords = polys.map((rings) => rings.map((r, i) => wind(r.map(project), i === 0)));
  return coords.length === 1 ? { type: 'Polygon', coordinates: coords[0] } : { type: 'MultiPolygon', coordinates: coords };
}

export function feature(geometry, properties) {
  return { type: 'Feature', geometry, properties };
}
