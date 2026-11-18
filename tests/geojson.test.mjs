import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, place, legalSpots, discard } from '../js/rules.js';
import { toGeoJSON } from '../js/geojson.js';
import { dissolve } from '../js/geo.js';

function play(seed, n) {
  const s = newGame(seed);
  for (let i = 0; i < n && !s.over; i++) {
    const spot = legalSpots(s, s.queue[0])[0];
    if (!spot) { discard(s); continue; }
    place(s, spot.q, spot.r, spot.rots[0]);
  }
  return s;
}

const area = (ring) => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
};

test('dissolve merges two touching squares into one outline', () => {
  const sq = (x) => [[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]];
  const out = dissolve([sq(0), sq(1)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 1);
  assert.equal(out[0][0].length, 5); // a 2x1 rectangle: 4 corners + closing point
  assert.equal(Math.abs(area(out[0][0])), 2);
});

test('dissolve keeps holes', () => {
  const rings = [];
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (x !== 1 || y !== 1) rings.push([[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]);
  const out = dissolve(rings);
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 2);
});

test('the realm exports as valid GeoJSON', () => {
  const s = play('geo', 40);
  const g = toGeoJSON(s, { origin: [11.34, 44.49] });
  assert.equal(g.type, 'FeatureCollection');
  const tiles = g.features.filter((f) => f.properties.layer === 'tile');
  assert.equal(tiles.length, Object.keys(s.tiles).length);
  for (const f of g.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const rings of polys) {
      rings.forEach((r, i) => {
        assert.deepEqual(r[0], r[r.length - 1], 'ring closed');
        assert.ok(i === 0 ? area(r) > 0 : area(r) < 0, 'outer ccw, holes cw');
      });
    }
  }
  // The realm outline covers exactly the tiles.
  const realm = g.features.find((f) => f.properties.layer === 'realm');
  const polys = realm.geometry.type === 'Polygon' ? [realm.geometry.coordinates] : realm.geometry.coordinates;
  const realmArea = polys.reduce((s1, rings) => s1 + rings.reduce((s2, r) => s2 + area(r), 0), 0);
  const tileArea = tiles.reduce((s1, f) => s1 + area(f.geometry.coordinates[0]), 0);
  assert.ok(Math.abs(realmArea - tileArea) / tileArea < 1e-6);
  // Placed near the origin we asked for.
  assert.ok(Math.abs(tiles[0].geometry.coordinates[0][0][0] - 11.34) < 0.05);
});
