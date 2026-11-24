import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, place, discard, preview, legalSpots, canPlace, edgeAt, fits, groups, key, START_SUPPLY,
  choose, isSandbox, isTileKind,
} from '../js/rules.js';
import { BASES, BAG, PALETTE, FEATURES } from '../js/tiles.js';

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
  // Open water may sit next to grass, as a low cliff.
  assert.equal(canPlace(s, { base: 'water' }, 1, 0, 0), true);
  // A river may run into the sea.
  s.tiles[key(1, 0)] = { id: 99, q: 1, r: 0, rot: 0, base: 'water' };
  assert.equal(canPlace(s, { base: 'river_A' }, 2, 0, 0), true);
});

test('beaches must run on into beach or open water', () => {
  const s = newGame('beach');
  // coast_A at rot 0: sea on edge 1, beach corners 0 and 1. East of the hearth (1,0) its
  // edge 3 faces the hearth, and corners 2 and 3 (both dry) meet it: fine.
  assert.equal(canPlace(s, { base: 'coast_A' }, 1, 0, 0), true);
  // Turned so the beach corner 2 touches the hearth's grass corner: not allowed.
  assert.equal(canPlace(s, { base: 'coast_A' }, 1, 0, 1), false);
  // Turned so the sea edge faces the hearth: sea against grass is a cliff, but its two beach
  // corners would end in the grass.
  assert.equal(canPlace(s, { base: 'coast_A' }, 1, 0, 2), false);
  // Next to open water, the beach is fine on either side.
  s.tiles[key(1, 0)] = { id: 99, q: 1, r: 0, rot: 0, base: 'water' };
  assert.equal(canPlace(s, { base: 'coast_A' }, 2, 0, 2), true);
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
        assert.ok(fits(t, o, k), `${t.base}/${o.base} edge ${k}`);
      }
    }
  }
});

// ---------- sandbox ----------

test('normal games are not sandboxes and cannot choose tiles', () => {
  const s = newGame('plain');
  assert.equal(s.mode, 'normal');
  assert.equal(isSandbox(s), false);
  const before = JSON.stringify(s);
  assert.equal(choose(s, { base: 'grass', feature: 'forest' }), null);
  assert.equal(JSON.stringify(s), before);
  // The mode option does not change how a normal game is dealt.
  assert.deepEqual(newGame('plain', { mode: 'normal' }), s);
  assert.throws(() => newGame('x', { mode: 'chaos' }));
});

test('the palette holds every base and every feature, and nothing else', () => {
  for (const base of Object.keys(BASES)) assert.ok(PALETTE.some((p) => p.base === base), base);
  for (const f of FEATURES) assert.ok(PALETTE.some((p) => p.feature === f), f);
  for (const p of PALETTE) assert.ok(isTileKind(p), JSON.stringify(p));
});

test('a sandbox lets the player choose the tile, and checks the choice', () => {
  const s = newGame('sb', { mode: 'sandbox' });
  assert.equal(isSandbox(s), true);
  assert.equal(s.queue.length, 1);
  const piece = choose(s, { base: 'road_M' });
  assert.equal(piece.base, 'road_M');
  assert.equal(s.queue.length, 1);
  assert.equal(s.queue[0], piece);
  assert.deepEqual(s.choice, { base: 'road_M' });
  // Not allowed: unknown bases, unknown features, features off plain grass.
  const before = JSON.stringify(s);
  assert.equal(choose(s, { base: 'castle' }), null);
  assert.equal(choose(s, { base: 'grass', feature: 'volcano' }), null);
  assert.equal(choose(s, { base: 'road_A', feature: 'forest' }), null);
  assert.equal(choose(s, { base: 'toString' }), null);
  assert.equal(choose(s, null), null);
  assert.equal(JSON.stringify(s), before);
  // Choosing what is already in hand keeps the same tile.
  assert.equal(choose(s, { base: 'road_M' }), piece);
  // Every tile in the palette can be chosen.
  for (const p of PALETTE) {
    const t = choose(s, p);
    assert.equal(t.base, p.base);
    assert.equal(t.feature, p.feature);
  }
});

test('a chosen tile is laid with the normal rules and renown', () => {
  const s = newGame('sb-rules', { mode: 'sandbox' });
  choose(s, { base: 'road_M' });
  // The road may not run into the hearth's grass...
  assert.equal(place(s, 1, 0, 0), null);
  // ...but pointing away it fits: 1 for the neighbour, no road joined.
  const ev = place(s, 1, 0, 3);
  assert.ok(ev);
  assert.equal(ev[0].pts, 1);
  assert.equal(s.tiles[key(1, 0)].base, 'road_M');
  // The choice stays: the next tile is another dead end.
  assert.equal(s.queue[0].base, 'road_M');
  // Three forests next to the hearth raise a lumbermill, as in a normal game.
  const s2 = newGame('sb-wood', { mode: 'sandbox' });
  choose(s2, { base: 'grass', feature: 'forest' });
  place(s2, 1, 0, 0);
  const second = place(s2, 2, 0, 0);
  assert.equal(second[0].pts, 1 + 2); // one neighbour, and it is forest too
  const third = place(s2, 1, 1, 0);
  assert.ok(third.some((e) => e.type === 'build' && e.building === 'lumbermill'));
  assert.equal(s2.tiles[key(0, 0)].building, 'lumbermill');
  // Preview agrees with place and changes nothing.
  choose(s2, { base: 'grass', feature: 'village' });
  const before = JSON.stringify(s2);
  const pv = preview(s2, -1, 0, 0);
  assert.equal(JSON.stringify(s2), before);
  const score0 = s2.score;
  place(s2, -1, 0, 0);
  assert.equal(s2.score - score0, pv.pts);
});

test('the sandbox never runs out, never ends and cannot discard', () => {
  const s = newGame('sb-long', { mode: 'sandbox' });
  const supply = s.supply;
  assert.equal(discard(s), null);
  const kinds = PALETTE;
  let placed = 0;
  for (let i = 0; placed < START_SUPPLY * 3 && i < 2000; i++) {
    choose(s, kinds[i % kinds.length]);
    const spot = legalSpots(s, s.queue[0])[0];
    if (!spot) continue;
    assert.ok(place(s, spot.q, spot.r, spot.rots[0]));
    placed++;
    assert.equal(s.over, false);
    assert.equal(s.queue.length, 1);
  }
  assert.equal(placed, START_SUPPLY * 3);
  assert.equal(s.stats.placed, placed);
  assert.ok(s.supply >= supply, 'laying tiles takes nothing from the supply');
  assert.ok(s.score > 0);
  assert.equal(s.charters.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test('a sandbox plays out the same way from the same seed and choices', () => {
  const run = () => {
    const s = newGame('sb-same', { mode: 'sandbox' });
    for (let i = 0; i < 30; i++) {
      choose(s, PALETTE[(i * 7) % PALETTE.length]);
      const spot = legalSpots(s, s.queue[0])[0];
      if (spot) place(s, spot.q, spot.r, spot.rots[0]);
    }
    return s;
  };
  assert.deepEqual(run(), run());
});
