import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, place, discard, preview, legalSpots, canPlace, edgeAt, fits, groups, key, START_SUPPLY,
  choose, isSandbox, isTileKind, charterText, charterProgress,
} from '../js/rules.js';
import { BASES, BAG, PALETTE, FEATURES, BUILDINGS, WORKSHOPS, workshopsFor, tileName } from '../js/tiles.js';

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

// ---------- ruins ----------

// A game with hand-laid tiles: `lay` puts each tile through `place`, so buildings and charters
// follow the normal rules.
function handGame(seed) {
  const s = newGame(seed);
  s.charters = [];
  const lay = (q, r, feature, extra = {}) => {
    s.queue = [{ base: 'grass', feature, v: 1, ...extra }];
    s.supply = 99;
    const ev = place(s, q, r, 0);
    assert.ok(ev, `lay ${feature} at ${q},${r}`);
    return ev;
  };
  const built = (b) => Object.values(s.tiles).filter((t) => t.building === b).length;
  return { s, lay, built };
}
const builds = (ev) => ev.filter((e) => e.type === 'build').map((e) => e.building);

test('ruins are a land feature in the bag, the palette and the names', () => {
  assert.ok(FEATURES.includes('ruins'));
  const w = BAG.find((b) => b.feature === 'ruins');
  assert.ok(w && w.base === 'grass' && w.w > 0 && w.w < BAG.find((b) => b.feature === 'mountain').w + 1);
  assert.ok(PALETTE.some((p) => p.feature === 'ruins' && p.group === 'land'));
  assert.equal(tileName({ base: 'grass', feature: 'ruins' }), 'Ruins');
  assert.ok(isTileKind({ base: 'grass', feature: 'ruins' }));
  assert.equal(isTileKind({ base: 'road_A', feature: 'ruins' }), false);
});

test('ruins join into groups and earn the same-land bonus', () => {
  const { s, lay } = handGame('ruins-group');
  lay(1, 0, 'meadow');
  lay(2, 0, 'ruins');
  const ev = lay(3, 0, 'ruins');
  assert.equal(ev[0].pts, 1 + 2);
  assert.equal(groups(s, 'ruins').length, 1);
  assert.equal(groups(s, 'ruins')[0].length, 2);
});

test('a house next to ruins becomes a dig site: one for the first ruin, then one per two', () => {
  const dig = WORKSHOPS.find((w) => w.building === 'digsite');
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((n) => workshopsFor(dig, n)), [0, 1, 1, 2, 2, 3]);
  // The old workshops keep their old counts.
  const wood = WORKSHOPS.find((w) => w.building === 'lumbermill');
  assert.deepEqual([2, 3, 5, 6].map((n) => workshopsFor(wood, n)), [0, 1, 1, 2]);

  const { s, lay, built } = handGame('dig');
  const ev = lay(1, 0, 'ruins');
  assert.deepEqual(builds(ev), ['digsite']);
  assert.equal(s.tiles[key(0, 0)].building, 'digsite');
  const b = ev.find((e) => e.type === 'build');
  assert.equal(b.pts, BUILDINGS.digsite.pts);
  // A free house by the same ruins gets nothing more, nor does a second ruin tile; a third does.
  lay(2, -1, 'village');
  assert.equal(built('digsite'), 1);
  lay(2, 0, 'ruins');
  assert.equal(built('digsite'), 1, 'two ruins tiles feed one dig site');
  lay(3, -1, 'ruins');
  assert.equal(built('digsite'), 2, 'three feed two');
  assert.equal(s.tiles[key(2, -1)].building, 'digsite');
});

test('a dig site and a tavern found an Archaeological Society; with a church, an Academy', () => {
  const { s, lay, built } = handGame('society');
  // Ruins east of the hearth: the hearth becomes a dig site.
  assert.deepEqual(builds(lay(1, 0, 'ruins')), ['digsite']);
  // Grow the village westwards to five houses: a well, then a tavern, then the Society.
  lay(-1, 0, 'village');
  const atThree = builds(lay(-2, 0, 'village'));
  assert.deepEqual(atThree, ['well']);
  lay(-1, 1, 'village');
  const atFive = builds(lay(-2, 1, 'village'));
  assert.deepEqual(atFive, ['tavern', 'society']);
  assert.equal(built('society'), 1);
  assert.equal(built('academy'), 0);
  // Without a church there is no Academy, however big the village...
  for (const [q, r] of [[-3, 0], [-3, 1]]) lay(q, r, 'village');
  assert.equal(built('market'), 1);
  assert.equal(built('academy'), 0);
  // ...and at ten tiles the church comes, and the Academy with it (given a free house).
  for (const [q, r] of [[-3, 2], [-2, 2], [-1, 2]]) lay(q, r, 'village');
  assert.equal(built('church'), 1);
  assert.equal(built('academy'), 1);
  // One of each per village.
  for (const [q, r] of [[-4, 1], [-4, 2], [0, 2]]) lay(q, r, 'village');
  assert.equal(built('society'), 1);
  assert.equal(built('academy'), 1);
  const pts = BUILDINGS.society.pts + BUILDINGS.academy.pts;
  assert.ok(s.score >= pts);
});

test('a market will do instead of a tavern, but a village without a dig site founds nothing', () => {
  // No ruins at all: a village of seven has a tavern and a market but no Society.
  const plain = handGame('no-ruins');
  for (const [q, r] of [[-1, 0], [-2, 0], [-1, 1], [-2, 1], [-3, 0], [-3, 1]]) plain.lay(q, r, 'village');
  assert.equal(plain.built('market'), 1);
  assert.equal(plain.built('society'), 0);
  // The tavern taken out of the picture: the market alone founds the Society.
  const m = handGame('market');
  for (const [q, r] of [[-1, 0], [-2, 0], [-1, 1], [-2, 1], [-3, 0], [-3, 1]]) m.lay(q, r, 'village');
  for (const t of Object.values(m.s.tiles)) if (t.building === 'tavern') delete t.building;
  assert.equal(m.built('market'), 1);
  m.lay(1, 0, 'ruins'); // the dig site goes on a house next to the ruins, then the Society
  assert.equal(m.built('digsite'), 1);
  assert.equal(m.built('society'), 1);
});

test('a ruins charter counts ruins anywhere in the realm', () => {
  const { s, lay } = handGame('ruins-charter');
  s.charters = [{ id: 99, kind: 'ruins', n: 2, pts: 18, tiles: 3 }];
  assert.equal(charterText(s.charters[0]), 'Uncover ruins across 2 tiles');
  lay(1, 0, 'ruins');
  assert.equal(charterProgress(s, s.charters[0]), 1);
  const score = s.score;
  const ev = lay(-1, 0, 'ruins'); // not touching the first ruin
  assert.ok(ev.some((e) => e.type === 'charter' && e.text === 'Uncover ruins across 2 tiles'));
  assert.ok(s.score - score >= 18);
  assert.notEqual(s.charters[0].id, 99);
});

test('new ruins charters ask for one or two more ruins', () => {
  let seen = 0;
  for (let i = 0; i < 60 && seen < 5; i++) {
    const s = newGame('rc' + i);
    s.charters = [{ id: 1, kind: 'forest', n: 1, pts: 1, tiles: 0 }];
    s.queue = [{ base: 'grass', feature: 'forest', v: 1 }];
    place(s, 1, 0, 0);
    const c = s.charters[0];
    if (c.kind !== 'ruins') continue;
    seen++;
    assert.ok(c.n >= 1 && c.n <= 2, `n ${c.n}`);
    assert.equal(c.pts, 10 + 4 * c.n);
  }
  assert.ok(seen > 0, 'some new charter is a ruins charter');
});

test('an old save without ruins keeps playing', () => {
  // A game saved before ruins existed: no ruins tiles, charters or buildings anywhere.
  const s = autoplay('old-save', 20);
  const old = JSON.parse(JSON.stringify(s), (k, v) => (v === 'ruins' && k === 'feature' ? 'meadow' : v));
  old.charters = old.charters.map((c) => (c.kind === 'ruins' ? { id: c.id, kind: 'forest', n: 99, pts: 10, tiles: 3 } : c));
  for (const t of Object.values(old.tiles)) if (['digsite', 'society', 'academy'].includes(t.building)) delete t.building;
  // It plays on to the end, and ruins can turn up in it from now on.
  for (let i = 0; i < 400 && !old.over; i++) {
    const spot = legalSpots(old, old.queue[0])[0];
    if (!spot) discard(old);
    else assert.ok(place(old, spot.q, spot.r, spot.rots[0]));
  }
  assert.equal(old.over, true);
  assert.deepEqual(JSON.parse(JSON.stringify(old)), old);
});
