// OpenDorf rules. Pure and deterministic: the whole game is a plain JSON object and every
// random choice comes from the seeded generator stored inside it, so a seed always plays out
// the same way and a game can be saved, restored and undone by copying the object.

import { BASES, BAG, BUILDINGS, WORKSHOPS, CIVIC, compatible, cornersAgree } from './tiles.js';

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
  for (const n of neighbours(q, r)) {
    const other = tileAt(state, n.q, n.r);
    if (!other) continue;
    touching++;
    if (!fits(t, other, n.k)) return false;
  }
  return touching > 0;
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

export function newGame(seed = String(Date.now() % 1e9)) {
  const state = {
    version: 1,
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
    stats: { placed: 0, discarded: 0, built: 0, charters: 0 },
  };
  addTile(state, { base: 'grass', feature: 'village', v: 7 }, 0, 0, 0);
  refill(state);
  for (const kind of ['forest', 'road', 'field']) state.charters.push(makeCharter(state, kind));
  return state;
}

function addTile(state, piece, q, r, rot) {
  const t = { id: state.nextId++, q, r, rot, base: piece.base, v: piece.v };
  if (piece.feature) t.feature = piece.feature;
  state.tiles[key(q, r)] = t;
  return t;
}

function draw(state) {
  // The carts only bring a tile that fits somewhere today, if they can find one in a few tries.
  let piece;
  for (let i = 0; i < 4; i++) {
    const kind = pick(state, BAG);
    piece = { base: kind.base, v: Math.floor(rand(state) * 1e6) };
    if (kind.feature) piece.feature = kind.feature;
    if (legalSpots(state, piece).length) break;
  }
  return piece;
}

function refill(state) {
  while (state.queue.length < Math.min(HAND, state.supply)) state.queue.push(draw(state));
  if (state.supply <= 0) state.over = true;
}

// ---------- placing ----------

// Places the current tile. Returns the list of events, or null if the move is not legal.
export function place(state, q, r, rot) {
  const piece = state.queue[0];
  if (state.over || !piece || !canPlace(state, piece, q, r, rot)) return null;
  const events = [];
  const t = addTile(state, piece, q, r, rot);
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
  state.score += pts;
  events.push({ type: 'place', q, r, pts });

  state.queue.shift();
  state.supply--;
  develop(state, events);
  checkCharters(state, events);
  refill(state);
  if (state.over) events.push({ type: 'over', score: state.score });
  return events;
}

export function discard(state) {
  if (state.over || !state.queue.length) return null;
  state.queue.shift();
  state.supply--;
  state.turn++;
  state.stats.discarded++;
  refill(state);
  const events = [{ type: 'discard' }];
  if (state.over) events.push({ type: 'over', score: state.score });
  return events;
}

// What placing here would bring, without changing the game.
export function preview(state, q, r, rot) {
  const copy = structuredClone(state);
  const before = copy.score;
  const events = place(copy, q, r, rot);
  if (!events) return null;
  return { pts: copy.score - before, events };
}

// ---------- the realm grows ----------

function dist(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
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

function build(state, tile, building, events) {
  const b = BUILDINGS[building];
  tile.building = building;
  state.score += b.pts;
  state.supply += b.tiles;
  state.stats.built++;
  events.push({ type: 'build', building, q: tile.q, r: tile.r, pts: b.pts, tiles: b.tiles });
}

// One building per pass, until nothing more can grow.
function develop(state, events) {
  for (let guard = 0; guard < 64; guard++) {
    if (!growOnce(state, events)) return;
  }
}

function growOnce(state, events) {
  for (const w of WORKSHOPS) {
    for (const g of groups(state, w.group)) {
      const allowed = Math.floor(g.length / w.per);
      if (allowed <= adjacentBuilt(state, g, w.building)) continue;
      const house = housesBy(state, g, false)[0];
      if (house) {
        build(state, house, w.building, events);
        return true;
      }
    }
  }
  for (const g of groups(state, 'village')) {
    const has = (b) => g.some((k) => state.tiles[k].building === b);
    const houses = housesBy(state, g, true);
    if (!houses.length) continue;
    for (const c of CIVIC) {
      if (g.length >= c.size && !has(c.building)) {
        const spot = c.building === 'castle' ? mostCentral(state, houses) : houses[0];
        build(state, spot, c.building, events);
        return true;
      }
    }
    if (has('lumbermill') && has('mine') && !has('blacksmith')) {
      build(state, houses[0], 'blacksmith', events);
      return true;
    }
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

const CHARTER_KINDS = ['forest', 'field', 'village', 'road', 'river', 'sea', 'build'];

export function charterProgress(state, c) {
  if (c.kind === 'build') return countBuilt(state, c.building);
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
    case 'build': {
      const name = BUILDINGS[c.building].name;
      return n === 1 ? `Raise a ${name}` : `Raise ${n} ${name}s`;
    }
  }
  return '';
}

function makeCharter(state, kind) {
  const c = { id: state.nextCharter++, kind };
  if (kind === 'build') {
    const options = ['lumbermill', 'windmill', 'watermill', 'mine', 'well', 'tavern', 'market'];
    c.building = options[Math.floor(rand(state) * options.length)];
    c.n = countBuilt(state, c.building) + 1;
    c.pts = 15;
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
    state.score += c.pts;
    state.supply += c.tiles;
    state.stats.charters++;
    events.push({ type: 'charter', text: charterText(c), pts: c.pts, tiles: c.tiles });
    const active = new Set(state.charters.map((x) => x.kind));
    const options = CHARTER_KINDS.filter((k) => !active.has(k));
    state.charters[i] = makeCharter(state, options[Math.floor(rand(state) * options.length)]);
  }
}
