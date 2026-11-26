// Hills, marsh, bridges, the garrison, churchyards, wild camps and the dungeon mouth.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, place, canPlace, legalSpots, fits, groups, key, isTileKind, charterText, charterProgress, dungeonLink, dist,
} from '../js/rules.js';
import { BASES, BAG, PALETTE, BUILDINGS, WORKSHOPS, COMBOS, CAMPS, workshopsFor, tileName } from '../js/tiles.js';
import { toGeoJSON } from '../js/geojson.js';

// A game laid by hand: `lay` puts each tile through `place` (any base, rotation and feature),
// so buildings, camps and charters follow the normal rules.
function handGame(seed) {
  const s = newGame(seed);
  s.charters = [];
  const lay = (q, r, feature, base = 'grass', rot = 0) => {
    s.queue = [{ base, feature, v: 1 }];
    if (!feature) delete s.queue[0].feature;
    s.supply = 99;
    const ev = place(s, q, r, rot);
    assert.ok(ev, `lay ${feature || base} at ${q},${r}`);
    return ev;
  };
  // Put a tile down directly, skipping the rules (to set up a scene).
  const put = (q, r, feature, extra = {}) => {
    const t = { id: s.nextId++, q, r, rot: 0, base: 'grass', v: 1, ...extra };
    if (feature) t.feature = feature;
    s.tiles[key(q, r)] = t;
    return t;
  };
  const built = (b) => Object.values(s.tiles).filter((t) => t.building === b).length;
  return { s, lay, put, built };
}
const builds = (ev) => ev.filter((e) => e.type === 'build').map((e) => e.building);

// ---------- the new kinds of tile ----------

test('hills, marsh and the bridge are in the bag, the palette and the names', () => {
  for (const f of ['hills', 'marsh']) {
    assert.ok(BAG.some((b) => b.feature === f && b.base === 'grass' && b.w > 0), f);
    assert.ok(PALETTE.some((p) => p.feature === f && p.group === 'land'), f);
    assert.ok(isTileKind({ base: 'grass', feature: f }));
    assert.equal(isTileKind({ base: 'road_A', feature: f }), false);
  }
  assert.equal(tileName({ base: 'grass', feature: 'hills' }), 'Hills');
  assert.equal(tileName({ base: 'grass', feature: 'marsh' }), 'Marsh');
  assert.equal(tileName({ base: 'bridge' }), 'Bridge');
  assert.ok(PALETTE.some((p) => p.base === 'bridge' && p.group === 'river'));
  // Bridges are rare: rarer than either ford.
  const w = (base) => BAG.find((b) => b.base === base).w;
  assert.ok(w('bridge') > 0 && w('bridge') < w('ford_A') && w('bridge') < w('ford_B'));
});

// ---------- bridges ----------

const turns = (e) => [0, 1, 2, 3, 4, 5].map((r) => e.slice(6 - r) + e.slice(0, 6 - r));

test('a bridge crosses a straight river square, which no ford can do', () => {
  const e = BASES.bridge.edges;
  assert.equal(e, 'WRLWLR');
  // River straight across (0-3), the road from edge 1 to edge 5 on one side of the centre.
  assert.deepEqual([...e].map((x, i) => (x === 'W' ? i : -1)).filter((i) => i >= 0), [0, 3]);
  assert.deepEqual([...e].map((x, i) => (x === 'R' ? i : -1)).filter((i) => i >= 0), [1, 5]);
  // No turn of either ford gives these edges, and turned by 3 it is the 2-4 crossing.
  for (const f of ['ford_A', 'ford_B']) assert.ok(!turns(BASES[f].edges).includes(e), f);
  assert.ok(turns(e).includes('WLRWRL'));
});

test('a bridge carries the road and the river on to its neighbours', () => {
  const { s, lay } = handGame('bridge');
  // A straight river east of the hearth, running north-south (edges 1 and 4).
  lay(1, 0, null, 'river_A', 1);
  // The bridge north of it carries the river on (turned by 1: river on 1 and 4, road on 0 and 2).
  assert.equal(canPlace(s, { base: 'bridge' }, 1, 1, 1), true);
  // Turned so the river meets grass, it does not fit.
  assert.equal(canPlace(s, { base: 'bridge' }, 1, 1, 0), false);
  lay(1, 1, null, 'bridge', 1);
  // Straight roads carry the bridge's road on, east and north-west.
  assert.equal(canPlace(s, { base: 'road_A' }, 2, 1, 1), false);
  lay(2, 1, null, 'road_A', 0);
  lay(0, 2, null, 'road_A', 2);
  assert.equal(groups(s, 'road').find((g) => g.includes(key(1, 1))).length, 3);
  assert.equal(groups(s, 'river').find((g) => g.includes(key(1, 1))).length, 2);
  for (const t of Object.values(s.tiles)) {
    for (let k = 0; k < 6; k++) {
      const [dq, dr] = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]][k];
      const o = s.tiles[key(t.q + dq, t.r + dr)];
      if (o) assert.ok(fits(t, o, k));
    }
  }
});

// ---------- hills ----------

test('a house next to hills becomes a quarry, one per three hills', () => {
  const quarry = WORKSHOPS.find((w) => w.building === 'quarry');
  assert.deepEqual([1, 2, 3, 5, 6].map((n) => workshopsFor(quarry, n)), [0, 0, 1, 1, 2]);
  const { s, lay, built } = handGame('quarry');
  lay(1, 0, 'hills');
  const second = lay(2, 0, 'hills');
  assert.equal(second[0].pts, 1 + 2, 'hills earn the same-land bonus');
  assert.equal(built('quarry'), 0);
  const ev = lay(1, 1, 'hills');
  assert.deepEqual(builds(ev), ['quarry']);
  assert.equal(s.tiles[key(0, 0)].building, 'quarry');
  assert.equal(ev.find((e) => e.type === 'build').pts, BUILDINGS.quarry.pts);
});

// ---------- marsh ----------

test('marsh only lies where it touches a river or the sea', () => {
  const { s, lay } = handGame('marsh-water');
  const marsh = { base: 'grass', feature: 'marsh' };
  // Next to the hearth alone: dry land, no.
  assert.equal(canPlace(s, marsh, 1, 0, 0), false);
  assert.equal(legalSpots(s, marsh).length, 0);
  // Other land is not fussy.
  assert.equal(canPlace(s, { base: 'grass', feature: 'hills' }, 1, 0, 0), true);
  // Beside a river tile it may, even though the river runs past and not into it.
  lay(-1, 0, null, 'river_A', 1); // river on edges 1 and 4: it does not face the hearth
  assert.equal(canPlace(s, marsh, -2, 0, 0), true);
  assert.equal(canPlace(s, marsh, 0, -1, 0), true);
  // Where the river would run into it, it does not fit: the river must carry on.
  assert.equal(canPlace(s, marsh, -1, 1, 0), false);
  assert.equal(canPlace(s, marsh, 1, 0, 0), false);
  // Beside open water or a coast it may too.
  lay(1, 0, null, 'water');
  assert.equal(canPlace(s, marsh, 2, -1, 0), true);
  assert.equal(canPlace(s, marsh, 1, -1, 0), true);
  assert.ok(legalSpots(s, marsh).length >= 3);
  // And a marsh next to a marsh still needs water of its own.
  lay(1, -1, 'marsh');
  assert.equal(canPlace(s, marsh, 1, -2, 0), false);
});

// Water east of the hearth, and marsh around it: (1,-1), (2,-1) and (2,0) touch the water.
function marshGame(seed) {
  const h = handGame(seed);
  h.lay(1, 0, null, 'water');
  return h;
}

test('a house next to marsh becomes an herb garden, one per three marsh', () => {
  const { s, lay, built } = marshGame('herbs');
  lay(1, -1, 'marsh');
  const second = lay(2, -1, 'marsh');
  assert.equal(second[0].pts, 1 + 2 + 1, 'marsh earns the same-land bonus');
  assert.equal(built('herbgarden'), 0);
  assert.deepEqual(builds(lay(2, 0, 'marsh')), ['herbgarden']);
  assert.equal(s.tiles[key(0, 0)].building, 'herbgarden');
});

test("a marsh of six draws a witch's hut, once, in the heart of the marsh", () => {
  const { s, lay, built } = marshGame('witch');
  for (const [q, r] of [[1, -1], [2, -1], [2, 0], [1, 1], [0, 1]]) lay(q, r, 'marsh');
  assert.equal(built('witchhut'), 0);
  lay(1, 2, null, 'water');
  const ev = lay(0, 2, 'marsh');
  assert.ok(builds(ev).includes('witchhut'));
  // It stands on the marsh tile with the most marsh around it, and that stays marsh.
  const hut = s.tiles[key(1, 1)];
  assert.equal(hut.building, 'witchhut');
  assert.equal(hut.feature, 'marsh');
  assert.equal(groups(s, 'marsh')[0].length, 6);
  assert.equal(ev.find((e) => e.building === 'witchhut').pts, BUILDINGS.witchhut.pts);
  // One per marsh, however big it grows.
  lay(0, 3, 'marsh');
  assert.equal(built('witchhut'), 1);
});

// ---------- the churchyard ----------

const TEN = [[-1, 0], [-2, 0], [-1, 1], [-2, 1], [-3, 0], [-3, 1], [-3, 2], [-2, 2], [-1, 2]];

test('a meadow beside a village with a church becomes its churchyard, once', () => {
  const { s, lay, built } = handGame('yard');
  lay(1, 0, 'meadow');
  lay(0, -1, 'meadow');
  assert.equal(built('churchyard'), 0, 'no church, no churchyard');
  let ev = [];
  for (const [q, r] of TEN) ev = lay(q, r, 'village');
  assert.ok(builds(ev).includes('church'));
  assert.ok(builds(ev).includes('churchyard'));
  const yard = Object.values(s.tiles).find((t) => t.building === 'churchyard');
  assert.equal(yard.feature, 'meadow');
  assert.ok([key(1, 0), key(0, -1)].includes(key(yard.q, yard.r)));
  assert.equal(ev.find((e) => e.building === 'churchyard').pts, BUILDINGS.churchyard.pts);
  // One per church: more meadows beside the village stay meadows.
  lay(-4, 1, 'meadow');
  assert.equal(built('churchyard'), 1);
});

test('a church raised before any meadow gets its churchyard when one is laid', () => {
  const { lay, built } = handGame('yard-late');
  for (const [q, r] of TEN) lay(q, r, 'village');
  assert.equal(built('church'), 1);
  assert.equal(built('churchyard'), 0);
  lay(1, 0, 'hills');
  lay(2, 0, 'meadow'); // not beside the village
  assert.equal(built('churchyard'), 0);
  assert.deepEqual(builds(lay(0, -1, 'meadow')), ['churchyard']);
});

// ---------- the garrison ----------

test('a village with a blacksmith and a watchtower within reach raises Barracks', () => {
  const combo = COMBOS.find((c) => c.building === 'barracks');
  assert.deepEqual(combo.needs, [['blacksmith']]);
  assert.deepEqual(combo.near, [['watchtower']]);
  const run = (towerAt) => {
    const { s, lay, put } = handGame('garrison');
    s.tiles[key(0, 0)].building = 'blacksmith';
    put(-1, 0, 'village');
    put(-1, 1, 'village');
    put(...towerAt, 'village', { building: 'watchtower' });
    return { s, ev: lay(0, -1, 'meadow') };
  };
  // Two tiles from the village: within reach.
  const near = run([2, 0]);
  assert.ok(builds(near.ev).includes('barracks'));
  assert.equal(Object.values(near.s.tiles).find((t) => t.building === 'barracks').feature, 'village');
  // Three tiles away: out of reach.
  assert.ok(!builds(run([3, 0]).ev).includes('barracks'));
});

test('a village with Barracks and a market raises an Archery range', () => {
  const run = (market) => {
    const { s, lay, put } = handGame('archers');
    s.tiles[key(0, 0)].building = 'barracks';
    put(-1, 0, 'village', market ? { building: 'market' } : {});
    put(-1, 1, 'village');
    put(-2, 1, 'village', { building: 'well' });
    return builds(lay(0, -1, 'meadow'));
  };
  assert.ok(run(true).includes('archery'));
  assert.ok(!run(false).includes('archery'));
});

// ---------- wild camps ----------

// Meadows lead east from the hearth to a forest four tiles away, out of reach of the village.
function wildGame(seed, land = 'forest', n = 5) {
  const h = handGame(seed);
  for (const q of [1, 2, 3]) h.lay(q, 0, 'meadow');
  const spots = [[4, 0], [5, 0], [4, 1], [5, -1], [5, 1], [6, 0]].slice(0, n - 1);
  for (const [q, r] of spots) h.put(q, r, land);
  return h;
}
// Lays the last tile of the wild group with each of many random states; what happens?
function outcomes(make, at, land) {
  const out = [];
  for (let rng = 1; rng <= 60; rng++) {
    const h = make();
    h.s.rng = rng * 7919;
    const ev = h.lay(...at, land);
    out.push({ h, camp: ev.find((e) => e.type === 'camp') });
  }
  return out;
}

test('a bandit camp may turn up in a forest of five far from any village', () => {
  const runs = outcomes(() => wildGame('bandits'), [6, -1], 'forest');
  const camps = runs.filter((x) => x.camp);
  assert.ok(camps.length > 5 && camps.length < 40, `${camps.length} of 60`);
  for (const { h, camp } of camps) {
    assert.equal(camp.camp, 'bandits');
    const t = h.s.tiles[key(camp.q, camp.r)];
    assert.equal(t.camp, 'bandits');
    assert.equal(t.feature, 'forest');
    // Only one per forest.
    assert.equal(Object.values(h.s.tiles).filter((x) => x.camp).length, 1);
  }
  // Same seed, same camp: decided by the game's own random numbers.
  const a = wildGame('same'); a.s.rng = 1234;
  const b = wildGame('same'); b.s.rng = 1234;
  assert.deepEqual(a.lay(6, -1, 'forest'), b.lay(6, -1, 'forest'));
  assert.deepEqual(a.s, b.s);
});

test('no camp in a small forest, nor in one with a village within two tiles', () => {
  // Four forest tiles: never.
  assert.ok(outcomes(() => wildGame('small', 'forest', 4), [5, -1], 'forest').every((x) => !x.camp));
  // A village two tiles from the forest: never.
  const near = () => {
    const h = wildGame('near');
    h.put(4, 2, 'village');
    return h;
  };
  assert.ok(outcomes(near, [6, -1], 'forest').every((x) => !x.camp));
});

test('a wolf den may turn up on a mountain range of three far from any village', () => {
  const runs = outcomes(() => wildGame('wolves', 'mountain', 3), [5, -1], 'mountain');
  const dens = runs.filter((x) => x.camp);
  assert.ok(dens.length > 5 && dens.length < 40, `${dens.length} of 60`);
  for (const { h, camp } of dens) {
    assert.equal(camp.camp, 'wolves');
    const t = h.s.tiles[key(camp.q, camp.r)];
    assert.equal(t.feature, 'mountain');
    assert.ok(!t.dungeon, 'the den keeps clear of the dungeon mouth');
  }
  assert.ok(outcomes(() => wildGame('wolves2', 'mountain', 2), [4, 1], 'mountain').every((x) => !x.camp));
});

test('a camp blocks its land from feeding a workshop until a watchtower clears it', () => {
  const { s, lay, put, built } = handGame('blocked');
  // A forest of three by the hearth, with a bandit camp in it, and a second house beside it.
  put(1, 0, 'forest');
  put(2, 0, 'forest', { camp: 'bandits' });
  put(1, 1, 'forest');
  put(2, 1, 'village');
  lay(-1, 0, 'meadow');
  assert.equal(built('lumbermill'), 0, 'the bandits keep the woodcutters away');
  // Fields still feed their windmill: only the camp's own land is blocked.
  lay(0, -1, 'field');
  lay(-1, -1, 'field');
  lay(1, -1, 'field');
  assert.equal(built('windmill'), 1);
  // A watchtower two tiles from the forest clears the camp, then the lumbermill comes.
  put(2, 2, 'village', { building: 'watchtower' });
  const score = s.score;
  const ev = lay(-2, 0, 'meadow');
  const clear = ev.find((e) => e.type === 'clear');
  assert.ok(clear);
  assert.equal(clear.camp, 'bandits');
  assert.equal(clear.pts, CAMPS.bandits.pts);
  assert.equal(clear.tiles, CAMPS.bandits.tiles);
  assert.equal(s.tiles[key(2, 0)].camp, undefined);
  assert.equal(s.stats.cleared, 1);
  assert.ok(builds(ev).includes('lumbermill'));
  assert.ok(ev.indexOf(clear) < ev.findIndex((e) => e.building === 'lumbermill'), 'cleared first, then built');
  assert.ok(s.score - score >= CAMPS.bandits.pts + BUILDINGS.lumbermill.pts);
});

test('Barracks clear a wolf den, and then the mountain feeds its mine', () => {
  const { s, lay, put, built } = handGame('den');
  put(1, 0, 'mountain', { camp: 'wolves' });
  lay(-1, 0, 'meadow');
  assert.equal(built('mine'), 0);
  put(-2, 1, 'village', { building: 'barracks' }); // two tiles from the mountain? no: three
  lay(-2, 0, 'meadow');
  assert.equal(built('mine'), 0, 'three tiles is out of reach');
  put(-1, 1, 'village', { building: 'barracks' }); // two tiles from (1,0)
  const ev = lay(0, -1, 'meadow');
  assert.ok(ev.some((e) => e.type === 'clear' && e.camp === 'wolves'));
  assert.equal(built('mine'), 1);
});

test('a charter may ask to clear a camp, but only while there is one', () => {
  const { s, lay, put } = handGame('camp-charter');
  const c = { id: 50, kind: 'camp', n: 1, pts: 20, tiles: 3 };
  assert.equal(charterText(c), 'Clear a bandit camp or a wolf den');
  assert.equal(charterProgress(s, c), 0);
  s.charters = [c];
  put(1, 0, 'forest', { camp: 'bandits' });
  put(-1, 2, 'village', { building: 'watchtower' });
  const ev = lay(0, -1, 'meadow');
  assert.ok(ev.some((e) => e.type === 'charter' && e.text === 'Clear a bandit camp or a wolf den'));
  // With no camp left, the next charter is something else.
  assert.notEqual(s.charters[0].kind, 'camp');
  // A quarry is among the buildings a charter may ask for.
  assert.equal(charterText({ kind: 'build', building: 'quarry', n: 1 }), 'Raise a Quarry');
  assert.equal(charterText({ kind: 'build', building: 'quarry', n: 2 }), 'Raise 2 Quarries');
  assert.equal(charterText({ kind: 'build', building: 'mine', n: 2 }), 'Raise 2 Mines');
});

// ---------- the dungeon mouth ----------

test('the first mountain range of three opens a dungeon mouth, and only one', () => {
  const { s, lay, put } = handGame('delve');
  lay(1, 0, 'mountain');
  lay(2, 0, 'mountain');
  assert.ok(!Object.values(s.tiles).some((t) => t.dungeon));
  const ev = lay(3, 0, 'mountain');
  const d = ev.find((e) => e.type === 'dungeon');
  assert.ok(d);
  // On the flank of the range: an end tile, the older one.
  assert.deepEqual([d.q, d.r], [1, 0]);
  assert.equal(s.tiles[key(1, 0)].dungeon, true);
  // A second range of three gets none.
  put(-2, 0, 'mountain');
  put(-3, 0, 'mountain');
  lay(-1, 0, 'mountain');
  assert.equal(Object.values(s.tiles).filter((t) => t.dungeon).length, 1);
});

test('the dungeon mouth links to OpenDelve, seeded by the realm and the tile', () => {
  const s = newGame('abc');
  assert.equal(dungeonLink(s, { q: 3, r: -2 }), 'https://ingmmo.com/opendelve/?seed=abc-3--2');
  const t = newGame('day 1/2');
  assert.equal(dungeonLink(t, { q: 0, r: 1 }), 'https://ingmmo.com/opendelve/?seed=day%201%2F2-0-1');
});

// ---------- the map ----------

test('the map exports hills, wetland, the new buildings, camps and the dungeon', () => {
  const { s, lay, put } = marshGame('geo-lands');
  for (const [q, r] of [[1, -1], [2, -1], [2, 0]]) lay(q, r, 'marsh');
  put(-1, 0, 'hills');
  put(-2, 0, 'forest', { camp: 'bandits' });
  put(0, 1, 'mountain', { dungeon: true });
  const g = toGeoJSON(s);
  const kinds = g.features.filter((f) => f.properties.layer === 'area').map((f) => f.properties.kind);
  assert.ok(kinds.includes('hills'));
  assert.ok(kinds.includes('wetland'));
  const b = g.features.find((f) => f.properties.layer === 'building' && f.properties.building === 'herbgarden');
  assert.equal(b.properties.name, 'Herb garden');
  const sites = g.features.filter((f) => f.properties.layer === 'site').map((f) => f.properties);
  assert.deepEqual(sites.map((p) => p.site).sort(), ['bandit_camp', 'dungeon']);
  assert.equal(sites.find((p) => p.site === 'dungeon').url, dungeonLink(s, { q: 0, r: 1 }));
  const tile = g.features.find((f) => f.properties.layer === 'tile' && f.properties.q === -2 && f.properties.r === 0);
  assert.equal(tile.properties.camp, 'bandits');
});

test('distances count hex steps', () => {
  assert.equal(dist({ q: 0, r: 0 }, { q: 2, r: -1 }), 2);
  assert.equal(dist({ q: 0, r: 0 }, { q: 3, r: 0 }), 3);
});
