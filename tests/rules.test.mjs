import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, place, discard, preview, legalSpots, canPlace, edgeAt, groups, key, START_SUPPLY,
} from '../js/rules.js';
import { BASES, BAG } from '../js/tiles.js';

// Plays a whole game with a simple greedy player: take the spot the preview scores best.
function autoplay(seed, limit = 400) {
  const s = newGame(seed);
  for (let i = 0; i < limit && !s.over; i++) {
    const spots = legalSpots(s, s.queue[0]);
    if (!spots.length) {
      discard(s);
      continue;
    }
    let best = null;
    for (const c of spots.slice(0, 12)) {
      for (const rot of c.rots) {
        const p = preview(s, c.q, c.r, rot);
        if (!best || p.pts > best.pts) best = { ...c, rot, pts: p.pts };
      }
    }
    assert.ok(place(s, best.q, best.r, best.rot));
  }
  return s;
}

test('every bag entry names a known base with six edges', () => {
  for (const b of BAG) {
    assert.ok(BASES[b.base], b.base);
    assert.equal(BASES[b.base].edges.length, 6);
  }
});

test('rotation moves edges counter-clockwise', () => {
  const t = { base: 'road_M', rot: 0 }; // dead end, road on edge 3
  assert.equal(edgeAt(t, 3), 'R');
  t.rot = 1;
  assert.equal(edgeAt(t, 4), 'R');
  assert.equal(edgeAt(t, 3), 'L');
  t.rot = 5;
  assert.equal(edgeAt(t, 2), 'R');
});

test('a new game starts with the hearth, a hand and three charters', () => {
  const s = newGame('abc');
  assert.equal(Object.keys(s.tiles).length, 1);
  assert.equal(s.queue.length, 3);
  assert.equal(s.supply, START_SUPPLY);
  assert.equal(s.charters.length, 3);
});

test('the same seed plays out the same way', () => {
  const a = autoplay('same-seed');
  const b = autoplay('same-seed');
  assert.deepEqual(a, b);
  assert.notDeepEqual(autoplay('other-seed').tiles, a.tiles);
});

test('roads cannot be cut and must touch the realm', () => {
  const s = newGame('x');
  const road = { base: 'road_M', v: 1 }; // road on edge 3 at rot 0
  // Far away: not touching anything.
  assert.equal(canPlace(s, road, 5, 5, 0), false);
  // East of the hearth (1,0): edge 3 faces the hearth's grass, so rot 0 is illegal.
  assert.equal(canPlace(s, road, 1, 0, 0), false);
  // Rotated so the road points away, it fits.
  assert.equal(canPlace(s, road, 1, 0, 3), true);
  // Water next to grass is never legal.
  assert.equal(canPlace(s, { base: 'water' }, 1, 0, 0), false);
  // A river may run into the sea.
  s.tiles[key(1, 0)] = { id: 99, q: 1, r: 0, rot: 0, base: 'water' };
  assert.equal(canPlace(s, { base: 'river_A' }, 2, 0, 0), true);
});

test('a forest next to a house raises a lumbermill', () => {
  const s = newGame('wood');
  s.queue = [
    { base: 'grass', feature: 'forest', v: 1 },
    { base: 'grass', feature: 'forest', v: 2 },
    { base: 'grass', feature: 'forest', v: 3 },
  ];
  place(s, 1, 0, 0);
  place(s, 2, 0, 0);
  const ev = place(s, 1, 1, 0);
  const built = ev.filter((e) => e.type === 'build');
  assert.equal(built.length, 1);
  assert.equal(built[0].building, 'lumbermill');
  assert.equal(s.tiles[key(0, 0)].building, 'lumbermill');
  assert.equal(groups(s, 'forest')[0].length, 3);
});

test('a village of three gets a well', () => {
  const s = newGame('well');
  s.queue = [
    { base: 'grass', feature: 'village', v: 1 },
    { base: 'grass', feature: 'village', v: 2 },
    { base: 'grass', feature: 'meadow', v: 3 },
  ];
  place(s, 1, 0, 0);
  const ev = place(s, -1, 0, 0);
  assert.ok(ev.some((e) => e.type === 'build' && e.building === 'well'));
});

test('builds and charters add tiles to the supply', () => {
  const s = autoplay('supply', 30);
  const expected = START_SUPPLY - s.stats.placed - s.stats.discarded;
  assert.ok(s.supply + s.queue.length >= 0);
  assert.ok(s.supply >= expected, 'rewards only ever add tiles');
});

test('preview does not change the game', () => {
  const s = newGame('pv');
  const before = JSON.stringify(s);
  const spot = legalSpots(s, s.queue[0])[0];
  assert.ok(preview(s, spot.q, spot.r, spot.rots[0]));
  assert.equal(JSON.stringify(s), before);
});

test('games end, and the state survives JSON', () => {
  for (const seed of ['a', 'b', 'c', 'd']) {
    const s = autoplay(seed);
    assert.equal(s.over, true, `seed ${seed} should finish`);
    assert.ok(s.score > 0);
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    // Every placed neighbour pair agrees on its shared edge.
    for (const t of Object.values(s.tiles)) {
      for (let k = 0; k < 6; k++) {
        const [dq, dr] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]][k];
        const o = s.tiles[key(t.q + dq, t.r + dr)];
        if (!o) continue;
        const a = edgeAt(t, k);
        const b = edgeAt(o, (k + 3) % 6);
        assert.ok(a === b || (a + b === 'WS') || (a + b === 'SW'), `${a}/${b}`);
      }
    }
  }
});
