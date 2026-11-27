// Playing together: turns, banners and the rival renown, private charters, the turn that runs
// out, replaying an online move list, and saves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  newGame, place, discard, endTurn, command, fingerprint, canonical, standings, holders, preview,
  privateProgress, privateText, legalSpots, key, isMulti, isRival, HAND,
} from '../js/rules.js';
import { SLOTS, loadSaved, saveGame, slotOf } from '../js/saves.js';
import { greedyMove, firstMove } from './play.mjs';

const PEOPLE = [
  { name: 'Anna', color: 'blue' },
  { name: 'Bruno', color: 'red' },
  { name: 'Carla', color: 'yellow' },
  { name: 'Dario', color: 'green' },
];
const together = (seed, play, n = 2, seats = null) =>
  newGame(seed, { play, players: PEOPLE.slice(0, n).map((p, i) => (seats ? { ...p, seat: seats[i] } : p)) });

const sum = (s) => s.players.reduce((t, p) => t + p.score, 0);
const handTotal = (s) => s.queue.length + s.players.reduce((t, p, i) => t + (i === s.current ? 0 : p.hand.length), 0);

// A realm laid by hand, as in lands.test.mjs: `lay` puts a tile through `place` as player `by`;
// `put` sets a tile down directly (to set up a scene).
function handGame(play, n = 2) {
  const s = together('hand', play, n);
  s.charters = [];
  if (play === 'shared') s.players.forEach((p) => { p.charter = null; });
  const lay = (by, q, r, feature, base = 'grass', rot = 0) => {
    s.current = by;
    s.moved = false;
    s.queue = [{ base, feature, v: 1 }];
    if (!feature) delete s.queue[0].feature;
    for (const p of s.players) p.hand = [];
    s.supply = 99;
    const ev = place(s, q, r, rot);
    assert.ok(ev, `lay ${feature || base} at ${q},${r}`);
    return ev;
  };
  const put = (q, r, feature, extra = {}) => {
    const t = { id: s.nextId++, q, r, rot: 0, base: 'grass', v: 1, ...extra };
    if (feature) t.feature = feature;
    s.tiles[key(q, r)] = t;
    return t;
  };
  return { s, lay, put };
}

// Plays a game the way the game server would carry it: a list of moves, each from a seat, and
// a 'step' at the end of every turn. Now and then someone moves out of turn, a move is illegal,
// or the turn runs out with no move. Returns the moves.
function playOnline(s, seats, limit = 500) {
  const log = [];
  let k = 0;
  const send = (c) => { log.push(c); return command(s, c); };
  while (!s.over && log.length < limit) {
    k++;
    const me = seats[s.current];
    const other = seats[(s.current + 1) % seats.length];
    if (k % 7 === 0) assert.equal(send({ op: 'discard', faction: other }), null, 'out of turn');
    if (k % 11 === 0) assert.equal(send({ op: 'lay', q: 40, r: 40, rot: 0, faction: me }), null, 'nowhere near the realm');
    if (k % 13 !== 0) {
      // (every 13th turn runs out of time instead)
      const m = (k % 2 ? greedyMove : firstMove)(s);
      assert.ok(send(m.op === 'lay' ? { ...m, faction: me } : { op: 'discard', faction: me }));
      if (k % 5 === 0) assert.equal(send({ op: 'discard', faction: me }), null, 'one move a turn');
    }
    send({ op: 'step' });
  }
  return log;
}

// ---------- turns ----------

test('a game together deals every player a hand from the one supply', () => {
  const s = together('deal', 'shared', 3);
  assert.ok(isMulti(s));
  assert.equal(s.current, 0);
  assert.equal(s.queue.length, HAND);
  assert.deepEqual(s.players.map((p) => p.hand.length), [0, HAND, HAND]);
  assert.ok(handTotal(s) <= s.supply);
  assert.throws(() => together('one', 'shared', 1));
  assert.throws(() => newGame('x', { mode: 'sandbox', play: 'shared', players: PEOPLE.slice(0, 2) }));
});

test('a turn is one move, then the turn passes in order', () => {
  const s = together('turns', 'rival', 3);
  const theirs = structuredClone(s.players[1].hand);
  const m = firstMove(s);
  assert.ok(place(s, m.q, m.r, m.rot));
  assert.equal(s.moved, true);
  const again = legalSpots(s, s.queue[0])[0];
  assert.equal(place(s, again.q, again.r, again.rots[0]), null, 'no second tile');
  assert.equal(discard(s), null, 'no discard after laying');
  assert.equal(s.queue.length, HAND, 'the hand is topped up');
  const ev = endTurn(s);
  assert.deepEqual(ev.at(-1), { type: 'turn', player: 1 });
  assert.equal(s.current, 1);
  assert.equal(s.moved, false);
  assert.deepEqual(s.queue, theirs, "now the hand in play is Bruno's");
  assert.equal(s.players[0].hand.length, HAND);
  endTurn(s);
  endTurn(s);
  assert.equal(s.current, 0, 'round again');
});

test('a player with nothing in hand is passed over, and the realm ends when the supply does', () => {
  const s = together('short', 'shared', 3);
  const [a, b] = s.queue;
  s.queue = [a];
  s.players[1].hand = [];
  s.players[2].hand = [b];
  s.supply = 2;
  assert.ok(discard(s));
  endTurn(s);
  assert.equal(s.current, 2, 'Bruno has no tile and none to draw');
  assert.equal(s.over, false);
  const m = firstMove(s);
  if (m.op === 'lay') place(s, m.q, m.r, m.rot); else discard(s);
  assert.equal(s.supply, 0);
  assert.equal(s.over, true);
  assert.equal(endTurn(s), null);
});

test('whole games together end, and the hands never hold more than the supply', () => {
  for (const play of ['shared', 'rival']) {
    for (const n of [2, 4]) {
      const s = together(`whole-${play}-${n}`, play, n);
      for (let i = 0; i < 600 && !s.over; i++) {
        assert.ok(handTotal(s) <= s.supply);
        const m = greedyMove(s, 4);
        if (m.op === 'lay') assert.ok(place(s, m.q, m.r, m.rot)); else assert.ok(discard(s));
        endTurn(s);
      }
      assert.equal(s.over, true, `${play} with ${n} ends`);
      const laid = Object.values(s.tiles).filter((t) => t.by !== undefined);
      assert.equal(laid.length, s.stats.placed);
      assert.ok(laid.every((t) => t.by >= 0 && t.by < n));
      assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
    }
  }
});

// ---------- rival lords ----------

test("rival: a tile's own renown goes to whoever laid it", () => {
  const { s, lay } = handGame('rival');
  const ev = lay(1, 1, 0, 'village'); // beside the hearth's village: +1, +2 the same land
  assert.equal(ev[0].pts, 3);
  assert.equal(ev[0].by, 1);
  assert.deepEqual(s.players.map((p) => p.score), [0, 3]);
  assert.equal(s.tiles[key(1, 0)].by, 1);
  assert.ok(!('by' in s.tiles[key(0, 0)]), 'the hearth is no one\'s');
});

test('rival: a workshop earns for the owner of the house it stands on', () => {
  const { s, lay } = handGame('rival');
  lay(0, 1, 0, 'village');
  // Bruno lays the forest; only Anna's house is beside it.
  lay(1, 2, 0, 'forest');
  lay(1, 3, 0, 'forest');
  const a0 = s.players[0].score;
  const b0 = s.players[1].score;
  const ev = lay(1, 2, -1, 'forest');
  const mill = ev.find((e) => e.type === 'build');
  assert.equal(mill.building, 'lumbermill');
  assert.deepEqual([mill.q, mill.r], [1, 0]);
  assert.deepEqual(mill.to, [0]);
  assert.equal(s.players[0].score, a0 + 10);
  assert.equal(s.players[1].score - b0, ev[0].pts, 'Bruno only gets his tile');
  assert.equal(sum(s), s.score);
});

test("rival: a group's next building follows its majority", () => {
  const { s, lay, put } = handGame('rival');
  put(5, -1, 'village', { by: 0 }); // Anna's house
  put(7, 1, 'village', { by: 1 }); // Bruno's house, nearer the last tile
  lay(0, 5, 0, 'forest');
  lay(0, 6, 0, 'forest');
  assert.deepEqual(holders(s, [key(5, 0), key(6, 0)]), [0]);
  let ev = lay(1, 7, 0, 'forest');
  let mill = ev.find((e) => e.type === 'build');
  assert.deepEqual([mill.q, mill.r, mill.to], [5, -1, [0]], "Anna holds the forest: her house");
  // Bruno grows the forest to six, four of them his: the second lumbermill is his.
  lay(1, 8, 0, 'forest');
  lay(1, 8, -1, 'forest');
  ev = lay(1, 9, -1, 'forest');
  mill = ev.find((e) => e.type === 'build');
  assert.deepEqual([mill.building, mill.q, mill.r, mill.to], ['lumbermill', 7, 1, [1]]);
  assert.equal(sum(s), s.score);
});

test('rival: a building on the hearth is shared equally by the tied holders', () => {
  const { s, lay, put } = handGame('rival');
  put(1, 0, 'village', { by: 0, building: 'windmill' });
  put(0, 1, 'village', { by: 1, building: 'windmill' });
  const a0 = s.players[0].score;
  const ev = lay(1, -1, 0, 'meadow');
  const well = ev.find((e) => e.type === 'build');
  assert.deepEqual([well.building, well.q, well.r], ['well', 0, 0]);
  assert.deepEqual(well.to, [1, 0], 'both hold the village, the player to move first');
  assert.equal(s.players[0].score - a0, 2, '5 shared: 2 to Anna');
  assert.equal(s.players[1].score, ev[0].pts + 3, '... and 3 to Bruno, whose move it was');
  assert.equal(sum(s), s.score);
});

test('rival: clearing a camp earns for the owner of the watchtower', () => {
  const { s, lay, put } = handGame('rival');
  for (const [q, r] of [[6, 0], [7, 0], [8, 0], [6, 1], [7, 1]]) put(q, r, 'forest', { by: 1 });
  s.tiles[key(7, 0)].camp = 'bandits';
  put(9, 1, 'grass', { by: 0, building: 'watchtower' });
  const a0 = s.players[0].score;
  const ev = lay(1, 1, 0, 'meadow');
  const clear = ev.find((e) => e.type === 'clear');
  assert.ok(clear);
  assert.deepEqual(clear.to, [0]);
  assert.equal(s.players[0].score, a0 + clear.pts);
});

test('rival: a royal charter rewards the player whose move fulfilled it', () => {
  const { s, lay } = handGame('rival');
  s.charters = [{ id: 90, kind: 'forest', n: 1, pts: 12, tiles: 3 }];
  const ev = lay(1, 1, 0, 'forest');
  const c = ev.find((e) => e.type === 'charter');
  assert.deepEqual(c.to, [1]);
  assert.equal(s.players[1].score, ev[0].pts + 12);
  assert.equal(s.players[0].score, 0);
});

test("rival: the players' renown always adds up to the realm's, and the end ranks them", () => {
  const s = together('rank', 'rival', 3);
  while (!s.over) {
    const m = greedyMove(s, 4);
    if (m.op === 'lay') {
      const p = preview(s, m.q, m.r, m.rot);
      const before = s.players[s.current].score;
      place(s, m.q, m.r, m.rot);
      assert.equal(s.players[s.current].score - before, p.mine, 'the preview says what the player earns');
    } else {
      discard(s);
    }
    assert.equal(sum(s), s.score);
    endTurn(s);
  }
  const ranks = standings(s);
  assert.equal(ranks.length, 3);
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(ranks[i - 1].score >= ranks[i].score);
    assert.equal(ranks[i].place, ranks[i - 1].score === ranks[i].score ? ranks[i - 1].place : i + 1);
  }
  assert.equal(ranks.reduce((t, r) => t + r.laid, 0), s.stats.placed);
});

// ---------- shared realm ----------

test('shared: renown is the realm\'s, and each player has a private charter', () => {
  const s = together('priv', 'shared', 3);
  assert.ok(!isRival(s));
  assert.ok(s.players.every((p) => !('score' in p)));
  for (const p of s.players) {
    assert.ok(p.charter && p.charter.n > 0 && p.charter.pts > 0);
    assert.ok(privateText(p.charter).length > 0);
  }
  const ids = new Set([...s.charters, ...s.players.map((p) => p.charter)].map((c) => c.id));
  assert.equal(ids.size, 6, 'every charter has its own id');
});

test("shared: a private charter counts only its player's tiles and rewards the realm", () => {
  const { s, lay } = handGame('shared');
  s.players[0].charter = { id: 90, kind: 'forest', n: 2, pts: 14, tiles: 2 };
  lay(1, 1, 0, 'forest');
  assert.equal(privateProgress(s, 0, s.players[0].charter), 0, "Bruno's forest is not Anna's");
  lay(0, -1, 0, 'forest');
  const score = s.score;
  const ev = lay(0, -2, 0, 'forest');
  const c = ev.find((e) => e.type === 'charter');
  assert.equal(c.private, 0);
  assert.equal(c.text, 'Lay 2 forest tiles');
  assert.equal(s.score, score + ev[0].pts + 14);
  assert.equal(s.supply, 99 - 1 + 2);
  const next = s.players[0].charter;
  assert.notEqual(next.kind, 'forest', 'a new one, of another kind');
  assert.ok(next.n > privateProgress(s, 0, next));
});

test('shared: private charters count lands, roads, rivers and workshops of your own', () => {
  const { s, put } = handGame('shared');
  put(3, 0, 'field', { by: 0 });
  put(4, 0, null, { by: 0, base: 'road_A' });
  put(5, 0, null, { by: 0, base: 'ford_A' });
  put(6, 0, 'village', { by: 0, building: 'mine' });
  put(7, 0, 'village', { by: 1, building: 'mine' });
  put(8, 0, 'village', { by: 0, building: 'well' });
  const n = (kind) => privateProgress(s, 0, { kind });
  assert.deepEqual([n('field'), n('road'), n('river'), n('workshop'), n('village')], [1, 2, 1, 1, 2]);
});

// ---------- the turn that runs out ----------

test('a turn that ends with no move throws the tile away', () => {
  const s = together('late', 'rival', 2, [3, 5]);
  const tile = s.queue[0];
  const supply = s.supply;
  const ev = command(s, { op: 'step' });
  assert.deepEqual(ev[0], { type: 'discard', by: 0, timeout: true });
  assert.equal(s.supply, supply - 1);
  assert.equal(s.stats.discarded, 1);
  assert.equal(s.current, 1);
  assert.ok(!s.players[0].hand.includes(tile));
  assert.equal(s.players[0].hand.length, HAND, 'and Anna draws again');
  // A turn with a move is not touched.
  const m = firstMove(s);
  command(s, { ...m, faction: 5 });
  const before = s.stats.discarded;
  command(s, { op: 'step' });
  assert.equal(s.stats.discarded, before);
});

// ---------- one game on every machine ----------

test('replaying the move list gives the same game, to the fingerprint', () => {
  for (const play of ['shared', 'rival']) {
    const seats = [0, 2, 3];
    const a = together('online-' + play, play, 3, seats);
    const log = playOnline(a, seats);
    assert.equal(a.over, true);
    const b = together('online-' + play, play, 3, seats);
    for (const c of log) command(b, c);
    assert.equal(canonical(b), canonical(a));
    assert.equal(fingerprint(b), fingerprint(a));
    // A browser that came in halfway, from a copy of the game, ends the same way.
    const c = together('online-' + play, play, 3, seats);
    const half = Math.floor(log.length / 2);
    for (const m of log.slice(0, half)) command(c, m);
    const d = JSON.parse(JSON.stringify(c));
    for (const m of log.slice(half)) command(d, m);
    assert.equal(fingerprint(d), fingerprint(a));
  }
});

test('the fingerprint changes with the game and not with the order of its keys', () => {
  const s = together('fp', 'shared', 2);
  const fp = fingerprint(s);
  assert.match(fp, /^[0-9a-f]{16}$/);
  const reversed = (v) => (Array.isArray(v) ? v.map(reversed)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v);
  const flipped = reversed(s);
  assert.notEqual(JSON.stringify(flipped), JSON.stringify(s));
  assert.equal(fingerprint(flipped), fp);
  const m = firstMove(s);
  command(s, { ...m, faction: undefined });
  assert.equal(fingerprint(s), fp, 'a move from no seat is refused');
  s.players[0].seat = 7;
  const fp2 = fingerprint(s);
  assert.notEqual(fp2, fp);
  command(s, { ...m, faction: 7 });
  assert.notEqual(fingerprint(s), fp2);
});

// ---------- saves ----------

function memoryStore(init = {}) {
  const m = new Map(Object.entries(init));
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), m };
}

test('a game together saves in its own slot, and goes on the same from the save', () => {
  const store = memoryStore();
  const solo = newGame('mine');
  saveGame(store, solo, null);
  const s = together('saved', 'shared', 3);
  for (let i = 0; i < 12; i++) {
    const m = firstMove(s);
    if (m.op === 'lay') place(s, m.q, m.r, m.rot); else discard(s);
    endTurn(s);
  }
  saveGame(store, s, null);
  assert.equal(slotOf(s), 'together');
  assert.deepEqual(loadSaved(store, 'normal').saved, solo, 'the solo realm is still there');
  const back = loadSaved(store, 'together').saved;
  assert.deepEqual(back, s);
  for (const g of [s, back]) {
    while (!g.over) {
      const m = greedyMove(g, 3);
      if (m.op === 'lay') place(g, m.q, m.r, m.rot); else discard(g);
      endTurn(g);
    }
  }
  assert.equal(fingerprint(back), fingerprint(s));
  // A game together never loads as a solo realm, nor a solo one as a game together.
  store.set(SLOTS.normal.game, JSON.stringify(s));
  assert.equal(loadSaved(store, 'normal'), null);
  store.set(SLOTS.together.game, JSON.stringify(solo));
  assert.equal(loadSaved(store, 'together'), null);
});

test('a solo save from before playing together still loads from its slot', () => {
  const old = JSON.parse(readFileSync(new URL('./fixtures/solo-before-multiplayer.json', import.meta.url))).save.state;
  const store = memoryStore({ [SLOTS.normal.game]: JSON.stringify(old), [SLOTS.normal.undo]: '' });
  const got = loadSaved(store, 'normal');
  assert.deepEqual(got.saved, old);
  assert.equal(got.undo, null);
  assert.equal(loadSaved(store, 'together'), null);
});
