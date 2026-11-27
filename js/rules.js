// OpenDorf rules. Pure and deterministic: the whole game is a plain JSON object and every
// random choice comes from the seeded generator stored inside it, so a seed always plays out
// the same way and a game can be saved, restored and undone by copying the object.
//
// Two modes: 'normal' deals tiles from a seeded bag until the supply runs out; 'sandbox' lets
// the player choose every tile (`choose`), never runs out and never ends. Everything else
// (fitting, renown, buildings, charters) is the same in both.
//
// A normal realm may be played by 2 to 4 people taking turns (`players`), in one of two ways
// (`play`): 'shared', where they build one realm together, or 'rival', where each tile carries
// its layer's banner (`tile.by`) and renown goes to whoever earned it. See "Playing together"
// below. A solo realm has none of these fields, so it plays and saves exactly as it always has.

import {
  BASES, BAG, BUILDINGS, FEATURES, WORKSHOPS, CIVIC, COMBOS, REACH, WITCH_MARSH, CAMPS, CLEARS_CAMPS, DUNGEON_MOUNTAIN,
  DELVE_URL, INN_URL, workshopsFor, compatible, cornersAgree, needsWater,
} from './tiles.js';

export const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
export const START_SUPPLY = 40;
export const HAND = 3;

export const key = (q, r) => q + ',' + r;
export const unkey = (k) => k.split(',').map(Number);

// ---------- random ----------

export function hashSeed(s) {
  let h = 2166136261 >>> 0;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h || 1;
}

export function rand(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function pick(state, items, weight = (x) => x.w) {
  const total = items.reduce((s, x) => s + weight(x), 0);
  let roll = rand(state) * total;
  for (const x of items) if ((roll -= weight(x)) < 0) return x;
  return items[items.length - 1];
}

// ---------- tiles and edges ----------

export function edgeAt(tile, k) {
  return BASES[tile.base].edges[(((k - tile.rot) % 6) + 6) % 6];
}

export function cornerAt(tile, c) {
  return BASES[tile.base].corners[(((c - tile.rot) % 6) + 6) % 6];
}

// Do two tiles fit along edge k of `a` (b being the neighbour across it)?
// The edge must match, and so must the two corners the tiles share: a's corner k meets
// b's corner k+2, and a's corner k-1 meets b's corner k+3.
export function fits(a, b, k) {
  if (!compatible(edgeAt(a, k), edgeAt(b, (k + 3) % 6))) return false;
  return cornersAgree(cornerAt(a, k), cornerAt(b, (k + 2) % 6))
    && cornersAgree(cornerAt(a, (k + 5) % 6), cornerAt(b, (k + 3) % 6));
}

export function neighbours(q, r) {
  return DIRS.map(([dq, dr], k) => ({ q: q + dq, r: r + dr, k }));
}

export function tileAt(state, q, r) {
  return state.tiles[key(q, r)];
}

export function canPlace(state, piece, q, r, rot) {
  if (tileAt(state, q, r)) return false;
  const t = { base: piece.base, rot };
  let touching = 0;
  let wet = false;
  for (const n of neighbours(q, r)) {
    const other = tileAt(state, n.q, n.r);
    if (!other) continue;
    touching++;
    if (!fits(t, other, n.k)) return false;
    if (isWet(other)) wet = true;
  }
  // Marsh only lies where it touches a river or the sea.
  if (needsWater(piece.feature) && !wet) return false;
  return touching > 0;
}

// Does a tile carry a river or the sea (so a marsh may lie beside it)?
export function isWet(tile) {
  const e = BASES[tile.base].edges;
  return e.includes('W') || e.includes('S');
}

export function legalRotations(state, piece, q, r) {
  const out = [];
  for (let rot = 0; rot < 6; rot++) if (canPlace(state, piece, q, r, rot)) out.push(rot);
  return out;
}

export function frontier(state) {
  const seen = new Set();
  const out = [];
  for (const t of Object.values(state.tiles)) {
    for (const n of neighbours(t.q, t.r)) {
      const k = key(n.q, n.r);
      if (seen.has(k) || state.tiles[k]) continue;
      seen.add(k);
      out.push({ q: n.q, r: n.r });
    }
  }
  return out;
}

export function legalSpots(state, piece) {
  const out = [];
  for (const c of frontier(state)) {
    const rots = legalRotations(state, piece, c.q, c.r);
    if (rots.length) out.push({ ...c, rots });
  }
  return out;
}

// ---------- groups ----------

// What a tile counts as when grouping: a feature on grass, or the water and roads it carries.
function inGroup(tile, kind) {
  switch (kind) {
    case 'forest':
    case 'field':
    case 'village':
    case 'mountain':
    case 'ruins':
    case 'hills':
    case 'marsh':
      return tile.feature === kind;
    case 'road':
      return BASES[tile.base].edges.includes('R');
    case 'river':
      return BASES[tile.base].edges.includes('W');
    case 'sea':
      return BASES[tile.base].edges.includes('S');
  }
  return false;
}

const LINK = { road: 'R', river: 'W', sea: 'S' };

function linked(a, b, k, kind) {
  const e = LINK[kind];
  if (!e) return true; // features join with any neighbour of the same feature
  return edgeAt(a, k) === e && edgeAt(b, (k + 3) % 6) === e;
}

// Connected groups of one kind, each a list of tile keys.
export function groups(state, kind) {
  const seen = new Set();
  const out = [];
  for (const [k0, t0] of Object.entries(state.tiles)) {
    if (seen.has(k0) || !inGroup(t0, kind)) continue;
    const g = [];
    const stack = [k0];
    seen.add(k0);
    while (stack.length) {
      const k = stack.pop();
      g.push(k);
      const t = state.tiles[k];
      for (const n of neighbours(t.q, t.r)) {
        const nk = key(n.q, n.r);
        const o = state.tiles[nk];
        if (!o || seen.has(nk) || !inGroup(o, kind) || !linked(t, o, n.k, kind)) continue;
        seen.add(nk);
        stack.push(nk);
      }
    }
    out.push(g);
  }
  return out;
}

export function largest(state, kind) {
  return groups(state, kind).reduce((m, g) => Math.max(m, g.length), 0);
}

export function countBuilt(state, building) {
  let n = 0;
  for (const t of Object.values(state.tiles)) if (t.building === building) n++;
  return n;
}

// ---------- new game ----------

export const MODES = ['normal', 'sandbox'];

export function isSandbox(state) {
  return state.mode === 'sandbox';
}

export function newGame(seed = String(Date.now() % 1e9), { mode = 'normal', players = null, play = 'shared' } = {}) {
  if (!MODES.includes(mode)) throw new Error('unknown mode ' + mode);
  if (players) checkPlayers(players, play, mode);
  const state = {
    version: 1,
    mode,
    seed: String(seed),
    rng: hashSeed(seed),
    tiles: {},
    nextId: 1,
    queue: [],
    supply: START_SUPPLY,
    score: 0,
    turn: 0,
    charters: [],
    nextCharter: 1,
    last: null,
    over: false,
    stats: { placed: 0, discarded: 0, built: 0, charters: 0, cleared: 0 },
  };
  if (mode === 'sandbox') state.choice = { base: 'grass', feature: 'forest' };
  addTile(state, { base: 'grass', feature: 'village', v: 7 }, 0, 0, 0);
  if (players) {
    seatPlayers(state, players, play);
  } else {
    refill(state);
  }
  for (const kind of ['forest', 'road', 'field']) state.charters.push(makeCharter(state, kind));
  if (players && play === 'shared') state.players.forEach((p, i) => { p.charter = makePrivate(state, i); });
  return state;
}

// `by`: the player who laid it (only when several play; the hearth belongs to no one).
function addTile(state, piece, q, r, rot, by) {
  const t = { id: state.nextId++, q, r, rot, base: piece.base, v: piece.v };
  if (piece.feature) t.feature = piece.feature;
  if (by !== undefined && by !== null) t.by = by;
  state.tiles[key(q, r)] = t;
  return t;
}

// A tile of the given kind ({ base, feature? }), with its own look (`v`).
function makePiece(state, kind) {
  const piece = { base: kind.base, v: Math.floor(rand(state) * 1e6) };
  if (kind.feature) piece.feature = kind.feature;
  return piece;
}

function draw(state) {
  // The carts only bring a tile that fits somewhere today, if they can find one in a few tries.
  let piece;
  for (let i = 0; i < 4; i++) {
    piece = makePiece(state, pick(state, BAG));
    if (legalSpots(state, piece).length) break;
  }
  return piece;
}

// Tops up the current hand. The supply counts every tile not yet laid, the ones in hand too, so
// all the hands together never hold more than the supply.
function refill(state) {
  if (isSandbox(state)) {
    // The sandbox never runs out: the hand is the one tile the player chose, dealt again and again.
    if (!state.queue.length) state.queue.push(makePiece(state, state.choice));
    return;
  }
  while (state.queue.length < HAND && held(state) < state.supply) state.queue.push(draw(state));
  if (state.supply <= 0) state.over = true;
}

// Tiles in hand: the current one's (`queue`), and the others' when several play.
function held(state) {
  let n = state.queue.length;
  if (state.players) state.players.forEach((p, i) => { if (i !== state.current) n += p.hand.length; });
  return n;
}

// ---------- placing ----------

// Places the current tile. Returns the list of events, or null if the move is not legal.
export function place(state, q, r, rot) {
  const piece = state.queue[0];
  if (state.over || !piece || state.moved || !canPlace(state, piece, q, r, rot)) return null;
  const events = [];
  const mover = isMulti(state) ? state.current : undefined;
  const t = addTile(state, piece, q, r, rot, mover);
  state.last = { q, r };
  state.turn++;
  state.stats.placed++;

  let pts = 0;
  for (const n of neighbours(q, r)) {
    const o = tileAt(state, n.q, n.r);
    if (!o) continue;
    pts += 1;
    if (t.feature && t.feature !== 'meadow' && o.feature === t.feature) pts += 2;
    const e = edgeAt(t, n.k);
    if (e === 'R' || e === 'W') pts += 2;
    else if (e === 'S' && edgeAt(o, (n.k + 3) % 6) === 'S') pts += 1;
  }
  gain(state, pts, mover === undefined ? null : [mover]);
  events.push(mover === undefined ? { type: 'place', q, r, pts } : { type: 'place', q, r, pts, by: mover });

  state.queue.shift();
  if (!isSandbox(state)) state.supply--;
  if (mover !== undefined) state.moved = true;
  wilds(state, t, events);
  develop(state, events);
  checkCharters(state, events);
  if (state.play === 'shared') checkPrivate(state, events);
  refill(state);
  if (state.over) events.push({ type: 'over', score: state.score });
  return events;
}

export function discard(state) {
  if (state.over || !state.queue.length || isSandbox(state) || state.moved) return null;
  state.queue.shift();
  state.supply--;
  state.turn++;
  state.stats.discarded++;
  if (isMulti(state)) state.moved = true;
  refill(state);
  const events = [{ type: 'discard' }];
  if (state.over) events.push({ type: 'over', score: state.score });
  return events;
}

// Is `kind` a tile that exists: a known base, and a feature only on plain grass?
export function isTileKind(kind) {
  if (!kind || typeof kind !== 'object' || !Object.prototype.hasOwnProperty.call(BASES, kind.base)) return false;
  if (kind.feature === undefined || kind.feature === null) return true;
  return kind.base === 'grass' && FEATURES.includes(kind.feature);
}

// Sandbox only: the player chooses the tile to lay next ({ base, feature? }). It stays chosen
// after it is laid. Returns the new current tile, or null if the choice is not allowed.
export function choose(state, kind) {
  if (!isSandbox(state) || state.over || !isTileKind(kind)) return null;
  const choice = { base: kind.base };
  if (kind.feature) choice.feature = kind.feature;
  const cur = state.queue[0];
  if (cur && cur.base === choice.base && (cur.feature || null) === (choice.feature || null)) {
    state.choice = choice;
    return cur;
  }
  state.choice = choice;
  state.queue = [makePiece(state, choice)];
  return state.queue[0];
}

// What placing here would bring, without changing the game.
// In a rival game `mine` is what the player laying it would earn (`pts` is the whole realm's).
export function preview(state, q, r, rot) {
  const copy = structuredClone(state);
  const before = copy.score;
  const events = place(copy, q, r, rot);
  if (!events) return null;
  const out = { pts: copy.score - before, events };
  if (isRival(state)) out.mine = copy.players[state.current].score - state.players[state.current].score;
  return out;
}

// ---------- the realm grows ----------

export function dist(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// Is there a tile matching `test` within `d` tiles of any of `keys` (the tiles themselves too)?
export function within(state, keys, d, test) {
  return !!findWithin(state, keys, d, test);
}

// The first such tile (always the same one for the same realm), or null.
export function findWithin(state, keys, d, test) {
  for (const k of keys) {
    const t = state.tiles[k];
    for (let dq = -d; dq <= d; dq++) {
      for (let dr = Math.max(-d, -dq - d); dr <= Math.min(d, -dq + d); dr++) {
        const o = tileAt(state, t.q + dq, t.r + dr);
        if (o && test(o)) return o;
      }
    }
  }
  return null;
}

// The tile of a group with the most (or, with `outer`, the fewest) neighbours in the group,
// then the oldest: the heart of a forest for a camp, the flank of a mountain for a cave mouth.
function heartOf(state, keys, outer = false, ok = () => true) {
  const inside = new Set(keys);
  let best = null;
  let bestN = 0;
  for (const k of keys) {
    const t = state.tiles[k];
    if (!ok(t)) continue;
    let n = neighbours(t.q, t.r).filter((c) => inside.has(key(c.q, c.r))).length;
    if (outer) n = -n;
    if (!best || n > bestN || (n === bestN && t.id < best.id)) {
      best = t;
      bestN = n;
    }
  }
  return best;
}

function isHouse(t) {
  return t && t.feature === 'village' && !t.building;
}

// Free houses next to (or inside) a group, nearest to the last move first.
function housesBy(state, keys, inside) {
  const found = new Map();
  for (const k of keys) {
    const t = state.tiles[k];
    if (inside) {
      if (isHouse(t)) found.set(k, t);
      continue;
    }
    for (const n of neighbours(t.q, t.r)) {
      const o = tileAt(state, n.q, n.r);
      if (isHouse(o)) found.set(key(o.q, o.r), o);
    }
  }
  const last = state.last || { q: 0, r: 0 };
  return [...found.values()].sort((a, b) => dist(a, last) - dist(b, last) || a.id - b.id);
}

function adjacentBuilt(state, keys, building) {
  const found = new Set();
  for (const k of keys) {
    const t = state.tiles[k];
    if (t.building === building) found.add(k);
    for (const n of neighbours(t.q, t.r)) {
      const o = tileAt(state, n.q, n.r);
      if (o && o.building === building) found.add(key(o.q, o.r));
    }
  }
  return found.size;
}

// `group`: the tiles whose growth raised it (the land that feeds a workshop, the village a town
// building serves), for a rival game's renown.
function build(state, tile, building, events, group) {
  const b = BUILDINGS[building];
  tile.building = building;
  const to = isRival(state) ? earners(state, tile, group) : null;
  gain(state, b.pts, to);
  state.supply += b.tiles;
  state.stats.built++;
  const e = { type: 'build', building, q: tile.q, r: tile.r, pts: b.pts, tiles: b.tiles };
  if (to) e.to = to;
  events.push(e);
}

// One building per pass, until nothing more can grow.
function develop(state, events) {
  for (let guard = 0; guard < 64; guard++) {
    if (!growOnce(state, events)) return;
  }
}

// ---------- the wild ----------

// What the last tile laid stirs up in the wild: the realm's one dungeon mouth, once a mountain
// range is big enough, and perhaps a camp in a stretch of land far from any village.
function wilds(state, placed, events) {
  if (!Object.values(state.tiles).some((t) => t.dungeon)) {
    const range = groups(state, 'mountain').find((g) => g.length >= DUNGEON_MOUNTAIN);
    if (range) {
      // On the flank of the range, so the mouth looks out of the mountain.
      const t = heartOf(state, range, true);
      t.dungeon = true;
      events.push({ type: 'dungeon', q: t.q, r: t.r });
    }
  }
  for (const [camp, c] of Object.entries(CAMPS)) {
    if (placed.feature !== c.land) continue;
    const g = groups(state, c.land).find((x) => x.includes(key(placed.q, placed.r)));
    if (g.length < c.size || g.some((k) => state.tiles[k].camp)) continue;
    if (within(state, g, REACH, (o) => o.feature === 'village')) continue;
    if (rand(state) >= c.chance) continue;
    // Bandits hide in the heart of the forest; wolves den on the flank of the mountain, away
    // from the dungeon mouth if they can.
    const t = camp === 'bandits' ? heartOf(state, g) : heartOf(state, g, true, (x) => !x.dungeon) || heartOf(state, g, true);
    t.camp = camp;
    events.push({ type: 'camp', camp, q: t.q, r: t.r });
  }
}

// Groups of `land` holding a camp, with the camp's tile.
function campGroups(state, land) {
  const out = [];
  for (const g of groups(state, land)) {
    const k = g.find((x) => state.tiles[x].camp);
    if (k) out.push({ g, tile: state.tiles[k] });
  }
  return out;
}

// A link to the dungeon under the mountain: OpenDelve, seeded by the realm and the tile.
export function dungeonLink(state, tile) {
  return `${DELVE_URL}?seed=${encodeURIComponent(`${state.seed}-${tile.q}-${tile.r}`)}`;
}

// A link to run a tavern as an inn: OpenInn, seeded by the realm and the tile, so the same
// tavern is always the same inn.
export function innLink(state, tile) {
  return `${INN_URL}&seed=${encodeURIComponent(`${state.seed}-${tile.q}-${tile.r}`)}`;
}

function growOnce(state, events) {
  // A watchtower or Barracks within reach of a camp's land clears the camp.
  const camps = Object.values(state.tiles).some((t) => t.camp);
  for (const [camp, c] of camps ? Object.entries(CAMPS) : []) {
    for (const { g, tile } of campGroups(state, c.land)) {
      const by = tile.camp === camp && findWithin(state, g, REACH, (o) => CLEARS_CAMPS.includes(o.building));
      if (!by) continue;
      delete tile.camp;
      // In a rival game the renown goes to whoever holds the watchtower or Barracks.
      const to = isRival(state) ? earners(state, by, null) : null;
      gain(state, c.pts, to);
      state.supply += c.tiles;
      state.stats.cleared = (state.stats.cleared || 0) + 1;
      const e = { type: 'clear', camp, q: tile.q, r: tile.r, pts: c.pts, tiles: c.tiles };
      if (to) e.to = to;
      events.push(e);
      return true;
    }
  }
  for (const w of WORKSHOPS) {
    for (const g of groups(state, w.group)) {
      // A camp keeps the land from feeding its workshop until it is cleared.
      if (camps && Object.values(CAMPS).some((c) => c.blocks === w.building && g.some((k) => state.tiles[k].camp))) continue;
      const allowed = workshopsFor(w, g.length);
      if (allowed <= adjacentBuilt(state, g, w.building)) continue;
      const house = favour(state, housesBy(state, g, false), g)[0];
      if (house) {
        build(state, house, w.building, events, g);
        return true;
      }
    }
  }
  for (const g of groups(state, 'village')) {
    const has = (b) => g.some((k) => state.tiles[k].building === b);
    const houses = favour(state, housesBy(state, g, true), g);
    if (!houses.length) continue;
    for (const c of CIVIC) {
      if (g.length >= c.size && !has(c.building)) {
        const spot = c.building === 'castle' ? mostCentral(state, holdersOnly(state, houses, g)) : houses[0];
        build(state, spot, c.building, events, g);
        return true;
      }
    }
    for (const c of COMBOS) {
      const near = (b) => within(state, g, REACH, (o) => o.building === b);
      if (!has(c.building) && c.needs.every((any) => any.some(has)) && (c.near || []).every((any) => any.some(near))) {
        build(state, houses[0], c.building, events, g);
        return true;
      }
    }
  }
  // Buildings that stand on the land itself.
  for (const g of groups(state, 'marsh')) {
    if (g.length < WITCH_MARSH || g.some((k) => state.tiles[k].building === 'witchhut')) continue;
    const spot = heartOf(state, g, false, (t) => !t.building);
    if (spot) {
      build(state, spot, 'witchhut', events, g);
      return true;
    }
  }
  for (const g of groups(state, 'village')) {
    // One churchyard per church: the free meadow beside the village nearest the church.
    const church = g.map((k) => state.tiles[k]).find((t) => t.building === 'church');
    if (!church) continue;
    const meadows = new Map();
    let yard = false;
    for (const k of g) {
      const t = state.tiles[k];
      for (const n of neighbours(t.q, t.r)) {
        const o = tileAt(state, n.q, n.r);
        if (o?.feature !== 'meadow') continue;
        if (o.building === 'churchyard') yard = true;
        else if (!o.building) meadows.set(key(o.q, o.r), o);
      }
    }
    if (yard || !meadows.size) continue;
    const spot = [...meadows.values()].sort((a, b) => dist(a, church) - dist(b, church) || a.id - b.id)[0];
    build(state, spot, 'churchyard', events, g);
    return true;
  }
  return false;
}

function mostCentral(state, houses) {
  let best = houses[0];
  let bestN = -1;
  for (const h of houses) {
    const n = neighbours(h.q, h.r).filter((c) => tileAt(state, c.q, c.r)?.feature === 'village').length;
    if (n > bestN) {
      best = h;
      bestN = n;
    }
  }
  return best;
}

// ---------- royal charters ----------

const CHARTER_KINDS = ['forest', 'field', 'village', 'road', 'river', 'sea', 'build', 'ruins', 'camp'];

// A charter kind that can be offered now: clearing a camp only while there is one to clear.
function offered(state, kind) {
  if (kind === 'camp') return Object.values(state.tiles).some((t) => t.camp);
  return true;
}

export function countFeature(state, feature) {
  let n = 0;
  for (const t of Object.values(state.tiles)) if (t.feature === feature) n++;
  return n;
}

export function charterProgress(state, c) {
  if (c.kind === 'build') return countBuilt(state, c.building);
  // Ruins are rare: they count wherever they lie, not only side by side.
  if (c.kind === 'ruins') return countFeature(state, 'ruins');
  if (c.kind === 'camp') return state.stats.cleared || 0;
  return largest(state, c.kind);
}

export function charterText(c) {
  const n = c.n;
  switch (c.kind) {
    case 'forest': return `Grow a forest of ${n} tiles`;
    case 'field': return `Sow ${n} fields side by side`;
    case 'village': return `Grow a village of ${n} tiles`;
    case 'road': return `Build a road across ${n} tiles`;
    case 'river': return `Follow a river across ${n} tiles`;
    case 'sea': return `Chart a sea of ${n} tiles`;
    case 'ruins': return `Uncover ruins across ${n} tiles`;
    case 'camp': return 'Clear a bandit camp or a wolf den';
    case 'build': {
      const b = BUILDINGS[c.building];
      return n === 1 ? `Raise a ${b.name}` : `Raise ${n} ${b.plural || b.name + 's'}`;
    }
  }
  return '';
}

function makeCharter(state, kind) {
  const c = { id: state.nextCharter++, kind };
  if (kind === 'build') {
    const options = ['lumbermill', 'windmill', 'watermill', 'mine', 'quarry', 'well', 'tavern', 'market'];
    c.building = options[Math.floor(rand(state) * options.length)];
    c.n = countBuilt(state, c.building) + 1;
    c.pts = 15;
    c.tiles = 3;
    return c;
  }
  if (kind === 'camp') {
    // One more camp cleared, by a watchtower or Barracks within reach of it.
    c.n = (state.stats.cleared || 0) + 1;
    c.pts = 20;
    c.tiles = 3;
    return c;
  }
  if (kind === 'ruins') {
    // Ruins are rare, so the goal is one or two more ruin tiles anywhere in the realm.
    const step = 1 + Math.floor(rand(state) * 2);
    c.n = countFeature(state, 'ruins') + step;
    c.pts = 10 + 4 * step;
    c.tiles = 3;
    return c;
  }
  const now = largest(state, kind);
  const step = kind === 'sea' || kind === 'river' ? 3 : 4;
  c.n = Math.max(now + step + Math.floor(rand(state) * 3), 3);
  c.pts = 10 + 2 * (c.n - now);
  c.tiles = 3 + (c.n - now >= 6 ? 1 : 0);
  return c;
}

function checkCharters(state, events) {
  for (let i = 0; i < state.charters.length; i++) {
    const c = state.charters[i];
    if (charterProgress(state, c) < c.n) continue;
    // In a rival game a charter rewards the player whose move fulfilled it.
    const to = isRival(state) ? [state.current] : null;
    gain(state, c.pts, to);
    state.supply += c.tiles;
    state.stats.charters++;
    const e = { type: 'charter', text: charterText(c), pts: c.pts, tiles: c.tiles };
    if (to) e.to = to;
    events.push(e);
    const active = new Set(state.charters.map((x) => x.kind));
    const options = CHARTER_KINDS.filter((k) => !active.has(k) && offered(state, k));
    state.charters[i] = makeCharter(state, options[Math.floor(rand(state) * options.length)]);
  }
}

// ---------- playing together ----------
//
// Two to four people take turns on one realm. Each has a hand of three tiles, drawn from the
// realm's one supply: `queue` is always the hand of the player whose turn it is (`current`), so
// everything that works on the current tile works as it does alone, and `players[i].hand` keeps
// the others'. A turn is one move (lay or discard: `moved`), then `endTurn` passes it on.
//
// 'shared': renown, the supply and royal charters belong to everyone; each player also has a
// private charter (`players[i].charter`) judged on the tiles they laid, rewarding everyone.
// 'rival': every tile carries its layer's banner (`tile.by`), and each player has their own
// renown (`players[i].score`; `score` stays the realm's total):
// - a tile's own renown goes to whoever laid it;
// - a building earns for the owner of the tile it stands on. A group (a land, or a village) is
//   held by whoever laid most of its tiles (a tie: all of them), and its next building goes up
//   on one of its holders' free houses if they have one, so a building follows the majority;
//   one that stands on the hearth, which no one laid, earns for the holders, shared equally;
// - clearing a camp earns for the owner of the watchtower or Barracks that cleared it;
// - a royal charter rewards the player whose move fulfilled it.
// Everything comes from the seeded generator and the order of the moves, so the same seed and
// moves make the same game in every browser (`command` applies an online move list).

export const PLAYS = ['shared', 'rival'];
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

export function isMulti(state) {
  return !!state.players;
}

export function isRival(state) {
  return state.play === 'rival';
}

function checkPlayers(players, play, mode) {
  if (mode !== 'normal') throw new Error('only a normal realm can be played together');
  if (!PLAYS.includes(play)) throw new Error('unknown way to play ' + play);
  if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  }
}

// Seats the players and deals each a hand, in turn order.
function seatPlayers(state, players, play) {
  state.play = play;
  state.players = players.map((p) => {
    const out = { name: String(p.name || '').slice(0, 24), color: String(p.color || ''), hand: [] };
    if (p.seat !== undefined) out.seat = p.seat; // the online seat ("faction") this player sits in
    if (play === 'rival') out.score = 0;
    return out;
  });
  state.moved = false;
  for (let i = 0; i < players.length; i++) {
    state.current = i;
    state.queue = [];
    refill(state);
    state.players[i].hand = state.queue;
  }
  state.current = 0;
  state.queue = state.players[0].hand;
  state.players[0].hand = [];
}

// Adds renown, to the realm and, in a rival game, to the players in `to` (shared out equally;
// what does not divide goes one each to the first of them).
function gain(state, pts, to) {
  state.score += pts;
  if (!to || !to.length || !isRival(state)) return;
  const each = Math.floor(pts / to.length);
  let rest = pts - each * to.length;
  for (const i of to) {
    state.players[i].score += each + (rest > 0 ? 1 : 0);
    rest--;
  }
}

// Players in turn order, starting with the one whose turn it is.
function fromCurrent(state, list) {
  const n = state.players.length;
  return [...list].sort((a, b) => ((a - state.current + n) % n) - ((b - state.current + n) % n));
}

// Who holds a group: whoever laid most of its tiles (all of them when tied), in turn order from
// the current player; none if no one laid any of it.
export function holders(state, keys) {
  const count = new Map();
  for (const k of keys) {
    const by = state.tiles[k].by;
    if (by !== undefined) count.set(by, (count.get(by) || 0) + 1);
  }
  const most = Math.max(0, ...count.values());
  if (!most) return [];
  return fromCurrent(state, [...count].filter(([, n]) => n === most).map(([i]) => i));
}

// Who a building (or the watchtower that cleared a camp) earns for: the owner of its tile; on
// the hearth, the holders of the group that raised it; failing that, the current player.
function earners(state, tile, group) {
  if (tile.by !== undefined) return [tile.by];
  const h = group ? holders(state, group) : [];
  return h.length ? h : [state.current];
}

// In a rival game, a group's free houses with its holders' first (nearest first among each).
function favour(state, houses, group) {
  if (!isRival(state) || houses.length < 2) return houses;
  const h = new Set(holders(state, group));
  return [...houses.filter((t) => h.has(t.by)), ...houses.filter((t) => !h.has(t.by))];
}

// The holders' houses, if they have any free (where a rival village's castle goes).
function holdersOnly(state, houses, group) {
  if (!isRival(state)) return houses;
  const h = new Set(holders(state, group));
  const own = houses.filter((t) => h.has(t.by));
  return own.length ? own : houses;
}

// The player to move passes the turn on. A player who made no move (online, when the pace's
// clock ran out) throws their tile away first. Players with nothing in hand are passed over.
// Returns the events, or null if there is no turn to end.
export function endTurn(state) {
  if (!isMulti(state) || state.over) return null;
  const events = [];
  if (!state.moved) {
    const who = state.current;
    const ev = discard(state);
    if (ev) events.push(...ev.map((e) => (e.type === 'discard' ? { ...e, by: who, timeout: true } : e)));
    if (state.over) return events;
  }
  state.moved = false;
  const n = state.players.length;
  const from = state.current;
  state.players[from].hand = state.queue;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    state.current = i;
    state.queue = state.players[i].hand;
    state.players[i].hand = [];
    refill(state); // the supply may have grown since this hand was dealt
    if (state.queue.length) break;
    state.players[i].hand = state.queue;
  }
  if (!state.queue.length) state.over = true; // nobody holds a tile: the supply is spent
  events.push({ type: 'turn', player: state.current });
  if (state.over) events.push({ type: 'over', score: state.score });
  return events;
}

// An online move, as the game server sends it: `{ op: 'lay', q, r, rot, faction }`,
// `{ op: 'discard', faction }` or `{ op: 'step' }` (the end of the turn). A move counts only if
// it comes from the seat whose turn it is and is legal now; every browser refuses the same
// ones, and a refused move changes nothing. Returns the events, or null if refused.
export function command(state, c) {
  if (!isMulti(state) || state.over || !c) return null;
  if (c.op === 'step') return endTurn(state);
  const who = Number.isInteger(c.faction) ? state.players.findIndex((p) => p.seat === c.faction) : -1;
  if (who < 0 || who !== state.current) return null;
  if (c.op === 'lay') {
    if (![c.q, c.r, c.rot].every(Number.isInteger) || c.rot < 0 || c.rot > 5) return null;
    return place(state, c.q, c.r, c.rot);
  }
  if (c.op === 'discard') return discard(state);
  return null;
}

// The game as text with every object's keys in order, so the same game reads the same anywhere.
export function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

// A fingerprint of the game (two FNV-1a hashes of its canonical text), for browsers to check
// that they agree.
export function fingerprint(state) {
  const text = canonical(state);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    b = (b ^ (b >>> 15)) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

// Players from the most renown to the least, each with their place (a tie shares it).
export function standings(state) {
  if (!isMulti(state)) return [];
  const list = state.players.map((p, i) => ({ i, name: p.name, color: p.color, score: isRival(state) ? p.score : null, laid: 0 }));
  for (const t of Object.values(state.tiles)) if (t.by !== undefined) list[t.by].laid++;
  if (!isRival(state)) return list;
  list.sort((a, b) => b.score - a.score || a.i - b.i);
  list.forEach((p, k) => { p.place = k && p.score === list[k - 1].score ? list[k - 1].place : k + 1; });
  return list;
}

// ---------- private charters (a shared realm) ----------

// What a private charter can ask of the tiles a player laid: so many of one land, roads or
// rivers on so many of them, or workshops standing on so many of them.
const PRIVATE_KINDS = ['forest', 'field', 'village', 'road', 'river', 'workshop'];
const PRIVATE_STEP = { forest: 4, field: 3, village: 3, road: 3, river: 2, workshop: 1 };
const IS_WORKSHOP = new Set(WORKSHOPS.map((w) => w.building));

function mine(state, i, test) {
  let n = 0;
  for (const t of Object.values(state.tiles)) if (t.by === i && test(t)) n++;
  return n;
}

export function privateProgress(state, i, c) {
  switch (c.kind) {
    case 'road': return mine(state, i, (t) => BASES[t.base].edges.includes('R'));
    case 'river': return mine(state, i, (t) => BASES[t.base].edges.includes('W'));
    case 'workshop': return mine(state, i, (t) => IS_WORKSHOP.has(t.building));
  }
  return mine(state, i, (t) => t.feature === c.kind);
}

export function privateText(c) {
  const n = c.n;
  const s = n > 1 ? 's' : '';
  switch (c.kind) {
    case 'forest': return `Lay ${n} forest tile${s}`;
    case 'field': return `Lay ${n} field${s}`;
    case 'village': return `Lay ${n} village tile${s}`;
    case 'road': return `Your roads across ${n} tile${s}`;
    case 'river': return `Your rivers across ${n} tile${s}`;
    case 'workshop': return `A workshop on ${n} of your tiles`;
  }
  return '';
}

// A new private charter for player i: something more than they have now, never the same kind
// twice running.
function makePrivate(state, i, not = null) {
  const options = PRIVATE_KINDS.filter((k) => k !== not);
  const kind = options[Math.floor(rand(state) * options.length)];
  const step = PRIVATE_STEP[kind] + Math.floor(rand(state) * 2);
  const c = { id: state.nextCharter++, kind };
  c.n = privateProgress(state, i, c) + step;
  c.pts = 6 + 4 * step;
  c.tiles = 2;
  return c;
}

// After every move, each player's private charter, in turn order: its reward goes to the realm.
function checkPrivate(state, events) {
  state.players.forEach((p, i) => {
    const c = p.charter;
    if (!c || privateProgress(state, i, c) < c.n) return;
    gain(state, c.pts, null);
    state.supply += c.tiles;
    state.stats.charters++;
    events.push({ type: 'charter', text: privateText(c), pts: c.pts, tiles: c.tiles, private: i });
    p.charter = makePrivate(state, i, c.kind);
  });
}
