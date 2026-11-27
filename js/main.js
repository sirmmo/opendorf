import { View } from './view.js';
import * as R from './rules.js';
import { BANNERS, BUILDINGS, CAMPS, PALETTE, PALETTE_GROUPS, tileName } from './tiles.js';
import { toGeoJSON } from './geojson.js';
import { loadSaved as loadSlot, saveGame } from './saves.js';
import * as Net from './net.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const view = new View($('scene'));
let state = null;
let undoJSON = null;
let spots = new Map(); // "q,r" -> legal rotations for the current tile
let hover = null; // cell under the mouse
let selected = null; // cell chosen by touch
let wantRot = 0; // the rotation the player asked for
let shownRot = 0; // the rotation actually shown (nearest legal one)
let touchMode = false;
let previewCache = { k: '', v: null };
let seenCharters = new Set();
const floaters = [];
// Playing together: null alone; { local: true } taking turns on this device; { online: true }
// through the game server (see "online" below, and `net`).
let together = null;
let curtain = null; // on this device: the "Pass to" curtain due or showing, { i, timer }
let net = null;

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const bannerOf = (i) => BANNERS[state.players?.[i]?.color] || BANNERS.blue;
const nameOf = (i) => esc(state.players?.[i]?.name ?? '');
// A player's name with a dot of their colour, for the HUD and the news.
const who = (i) => `<span class="who" style="--c:${bannerOf(i).hex}"><i></i>${nameOf(i)}</span>`;

// ---------- game flow ----------

function randomSeed() {
  return Math.random().toString(36).slice(2, 8);
}

function todaySeed() {
  const d = new Date();
  return `day-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A sandbox realm has no seed worth sharing: its link just says "sandbox". An online game's link
// is its room's, so a reload goes back in; a game together on this device says so.
function setURL() {
  const u = new URL(location.href);
  u.searchParams.delete('join');
  if (together?.online && net?.code) {
    u.searchParams.delete('seed');
    u.searchParams.delete('mode');
    u.searchParams.set('join', net.code);
  } else if (together) {
    u.searchParams.delete('seed');
    u.searchParams.set('mode', 'together');
  } else if (R.isSandbox(state)) {
    u.searchParams.delete('seed');
    u.searchParams.set('mode', 'sandbox');
  } else {
    u.searchParams.delete('mode');
    u.searchParams.set('seed', state.seed);
  }
  history.replaceState(null, '', u);
}

// The normal game, the sandbox and a game together on this device keep separate saves (see
// saves.js), so one never overwrites another.
function loadSaved(slot) {
  return loadSlot(store, slot);
}

function startSandbox() {
  startGame('sandbox-' + randomSeed(), 'sandbox');
}

function enterSandbox() {
  const s = loadSaved('sandbox');
  if (s) resume(s.saved, s.undo);
  else startSandbox();
}

function leaveSandbox() {
  const s = loadSaved('normal');
  if (s) resume(s.saved, s.undo);
  else startGame(randomSeed());
}

// Every charter in play: the royal ones, and the players' own in a shared realm.
const allCharters = () => [...state.charters, ...(state.players || []).map((p) => p.charter).filter(Boolean)];

// Shows a realm: a new one (`fresh`, the view at the hearth) or one to go on with.
function enter(s, { undo = null, fresh = false } = {}) {
  state = s;
  undoJSON = undo || null;
  paletteTab = null;
  selected = null;
  if (fresh) wantRot = 0;
  previewCache = { k: '', v: null };
  seenCharters = new Set(allCharters().map((c) => c.id));
  view.setPlayers(state);
  view.setHint(null);
  view.clear();
  view.sync(state, { animate: false });
  if (fresh) {
    view.cam.target.set(0, 0, 0);
    view.cam.dist = 15;
  } else {
    view.frame(state);
  }
  $('over').hidden = true;
  setURL();
}

function startGame(seed, mode = 'normal') {
  dropOnline();
  together = null;
  enter(R.newGame(seed, { mode }), { fresh: true });
  save();
  onTurn();
}

function resume(saved, undo) {
  dropOnline();
  together = R.isMulti(saved) ? { local: true } : null;
  enter(saved, { undo });
  save();
  onTurn();
  if (together) curtainFor(state.current, 0);
}

// An online game is not saved here: the game server keeps its moves.
function save() {
  if (together?.online) return;
  saveGame(store, state, undoJSON);
  store.set('opendorf.mode', R.isMulti(state) ? 'together' : state.mode || 'normal');
}

// May this device make a move now?
function canAct() {
  if (!together) return true;
  if (state.over) return false;
  if (together.local) return !curtain;
  return !!net && net.me === state.current && !state.moved && !net.pending;
}

let notYetShown = 0;
function notYourTurn() {
  if (performance.now() - notYetShown < 2500) return;
  notYetShown = performance.now();
  toast(together?.local ? 'Pass the device on first.' : `It is ${nameOf(state.current)}'s turn.`);
}

function onTurn() {
  const piece = state.queue[0];
  spots = new Map();
  if (piece) for (const s of R.legalSpots(state, piece)) spots.set(R.key(s.q, s.r), s.rots);
  if (R.isSandbox(state)) showPalette();
  hud();
  refreshGhost();
  if (!R.isSandbox(state)) {
    view.thumbs.draw($('thumb1'), state.queue[1], 0);
    view.thumbs.draw($('thumb2'), state.queue[2], 0);
  }
  $('bUndo').disabled = !undoJSON || !!together;
  $('bDiscard').disabled = !canAct();
  if (state.over) setTimeout(showOver, 900);
}

function target() {
  return touchMode ? selected : hover;
}

function nearestLegal(rots, want) {
  for (let i = 0; i < 6; i++) {
    const r = (want + i) % 6;
    if (rots.includes(r)) return r;
  }
  return want;
}

function touchesRealm(c) {
  return R.neighbours(c.q, c.r).some((n) => R.tileAt(state, n.q, n.r));
}

function refreshGhost() {
  const c = target();
  const piece = state.queue[0];
  const tip = $('tip');
  let legal = false;
  shownRot = wantRot;
  // Together, a laid tile under the mouse says who laid it (in a shared realm with its rim too).
  const laid = c && !touchMode && R.isMulti(state) ? R.tileAt(state, c.q, c.r) : null;
  const owned = laid && laid.by !== undefined;
  view.setHint(owned && !R.isRival(state) ? laid : null);
  if (owned) {
    view.setGhost(null);
    tip.hidden = false;
    tip.classList.remove('bad');
    tip.innerHTML = `Laid by ${who(laid.by)}`;
  } else if (!c || !piece || R.tileAt(state, c.q, c.r) || !touchesRealm(c)) {
    view.setGhost(null);
    tip.hidden = true;
  } else {
    const rots = spots.get(R.key(c.q, c.r));
    legal = !!rots;
    if (legal) shownRot = nearestLegal(rots, wantRot);
    view.setGhost(piece, c.q, c.r, shownRot, legal);
    tip.hidden = false;
    tip.classList.toggle('bad', !legal);
    if (legal) {
      const p = previewAt(c.q, c.r, shownRot);
      const lines = [];
      for (const e of p.events) {
        // In a rival game, say when the renown would go to someone else.
        const other = e.to && !e.to.includes(state.current) ? ` (for ${e.to.map(nameOf).join(' and ')})` : '';
        if (e.type === 'build') lines.push(`<span class="b">${BUILDINGS[e.building].verb === 'laid out' ? 'lays out' : 'raises'} ${aOrAn(BUILDINGS[e.building].name)}${other}</span>`);
        if (e.type === 'clear') lines.push(`<span class="b">clears the ${CAMPS[e.camp].name.toLowerCase()}${other}</span>`);
        if (e.type === 'charter') lines.push(`<span class="b">fulfils ${e.private !== undefined ? `${nameOf(e.private)}'s charter` : 'a charter'}</span>`);
      }
      tip.innerHTML = `<span class="pts">+${p.mine ?? p.pts}</span>${lines.join('')}`;
    } else {
      tip.textContent = "Doesn't fit here";
    }
  }
  view.setSpots(spotList(), c);
  $('bPlace').hidden = !(touchMode && selected && legal);
  view.thumbs.draw($('thumb0'), piece, shownRot);
}

const aOrAn = (name) => (/^[AEIOU]/i.test(name) ? 'an ' : 'a ') + name;

function spotList() {
  return [...spots.keys()].map((k) => {
    const [q, r] = R.unkey(k);
    return { q, r };
  });
}

function previewAt(q, r, rot) {
  const p = state.queue[0];
  const k = `${state.turn}|${state.current}|${p.base}|${p.feature}|${p.v}|${q}|${r}|${rot}`;
  if (previewCache.k !== k) previewCache = { k, v: R.preview(state, q, r, rot) };
  return previewCache.v;
}

function rotate(dir) {
  const c = target();
  const rots = c && spots.get(R.key(c.q, c.r));
  if (rots && rots.length) {
    let r = shownRot;
    for (let i = 0; i < 6; i++) {
      r = (r + dir + 6) % 6;
      if (rots.includes(r)) break;
    }
    wantRot = r;
  } else {
    wantRot = (wantRot + dir + 6) % 6;
  }
  refreshGhost();
}

function placeAt(c, forceRot) {
  if (!c || state.over) return;
  const rots = spots.get(R.key(c.q, c.r));
  if (!rots) return;
  if (!canAct()) {
    notYourTurn();
    return;
  }
  const rot = forceRot ?? nearestLegal(rots, wantRot);
  // Online the move goes to the server, and is made when it comes back, as everyone's are.
  if (together?.online) {
    request({ op: 'lay', q: c.q, r: c.r, rot });
    return;
  }
  const before = JSON.stringify(state);
  const events = R.place(state, c.q, c.r, rot);
  if (!events) return;
  undoJSON = together ? null : before;
  selected = null;
  view.sync(state);
  react(events);
  tally(events);
  if (together) passTurn();
  save();
  onTurn();
}

function discardTile() {
  if (state.over || R.isSandbox(state)) return;
  if (!canAct()) {
    notYourTurn();
    return;
  }
  if (together?.online) {
    request({ op: 'discard' });
    return;
  }
  const before = JSON.stringify(state);
  const events = R.discard(state);
  if (!events) return;
  undoJSON = together ? null : before;
  toast('Tile thrown away');
  tally(events);
  if (together) passTurn();
  hud();
  save();
  onTurn();
}

// On this device: the turn passes on, and once the news has played, the curtain comes down.
function passTurn() {
  R.endTurn(state);
  if (!state.over) curtainFor(state.current, 1400);
}

function undo() {
  if (!undoJSON || together) return;
  const ach = state.ach; // what was counted stays counted (see tally)
  state = JSON.parse(undoJSON);
  if (ach) state.ach = ach;
  undoJSON = null;
  $('over').hidden = true;
  view.sync(state, { animate: false });
  save();
  onTurn();
}

function react(events) {
  let delay = 0;
  // Extra tiles mean nothing in the sandbox, so the news leaves them out.
  const more = (n) => (R.isSandbox(state) ? '' : ` · +${n} tile${n > 1 ? 's' : ''}`);
  // In a rival game, whose renown it is.
  const forWhom = (e) => (e.to ? ` for ${e.to.map(who).join(' and ')}` : '');
  const rival = R.isRival(state);
  for (const e of events) {
    if (e.type === 'place') floater(e.q, e.r, `+${e.pts}`, '', 0, rival ? bannerOf(e.by).hex : null);
    if (e.type === 'discard' && e.timeout) toast(`${who(e.by)}'s time ran out: the tile is thrown away`);
    if (e.type === 'build') {
      const b = BUILDINGS[e.building];
      delay += 0.5;
      floater(e.q, e.r, b.name, 'build', delay);
      toast(`<b>${b.name}</b> ${b.verb || 'raised'} · +${e.pts} renown${forWhom(e)}${more(e.tiles)}`);
    }
    // The wild: a camp turns up, a camp is cleared, a dungeon mouth opens.
    if (e.type === 'camp') toast(e.camp === 'bandits'
      ? 'Bandits have made camp in the forest. A watchtower or Barracks nearby will see them off.'
      : 'Wolves den in the mountain. A watchtower or Barracks nearby will see them off.');
    if (e.type === 'clear') {
      delay += 0.5;
      floater(e.q, e.r, 'Cleared', 'build', delay);
      toast(`<b>${CAMPS[e.camp].name}</b> cleared · +${e.pts} renown${forWhom(e)}${more(e.tiles)}`);
    }
    if (e.type === 'dungeon') toast('A dark way opens under the mountain. <b>Tap it</b> to look inside.');
    if (e.type === 'charter') {
      const whose = e.private !== undefined ? `${who(e.private)}'s charter` : 'Charter';
      toast(`${whose} fulfilled: ${e.text} · <b>+${e.pts}</b>${forWhom(e)}${more(e.tiles)}`);
    }
  }
  bump('score');
  if (events.some((e) => e.type === 'build' || e.type === 'charter' || e.type === 'clear')) bump('supply');
}

// ---------- achievements ----------

// achievements.json lists them; vendor/openachievements keeps the player's progress and reports
// it (to Wavedash, when the game runs there). Only solo normal realms earn them: in the sandbox
// every tile is chosen, so it counts nothing (but the map download), and a game together counts
// nothing at all. What a realm has already counted
// travels with it in `state.ach`, which undo leaves alone, so a move undone and made again is
// not counted twice.
const TRADES = ['lumbermill', 'windmill', 'watermill', 'mine', 'watchtower'];

function tally(events) {
  const oa = window.openachievements;
  // Only a realm of one's own counts: not the sandbox, and not a game together.
  if (!oa || R.isSandbox(state) || R.isMulti(state)) return;
  const m = state.ach || (state.ach = { placed: 0, built: 0, charters: 0, renown: 0, over: false });
  const count = (stat, k) => {
    const n = state.stats[k];
    if (n > m[k]) { oa.add(stat, n - m[k]); m[k] = n; }
  };
  count('tiles_laid', 'placed');
  count('buildings_raised', 'built');
  count('charters_fulfilled', 'charters');
  if (state.score > m.renown) { oa.set('best_renown', state.score); m.renown = state.score; }
  if (state.over && !m.over) { m.over = true; oa.add('realms_completed', 1); }
  for (const e of events) {
    if (e.type === 'place' && joinsRiverToSea(e.q, e.r)) oa.unlock('RIVER_MOUTH');
    if (e.type !== 'build') continue;
    if (e.building === 'castle') oa.unlock('CASTLE_ON_THE_HILL');
    if (e.building === 'academy') oa.unlock('SEAT_OF_LEARNING');
    if (TRADES.includes(e.building) && TRADES.every((b) => R.countBuilt(state, b) > 0)) oa.unlock('EVERY_TRADE');
  }
}

// Does the tile at q, r meet a neighbour river-to-sea, on either side?
function joinsRiverToSea(q, r) {
  const t = R.tileAt(state, q, r);
  return R.neighbours(q, r).some((n) => {
    const o = R.tileAt(state, n.q, n.r);
    const pair = o ? R.edgeAt(t, n.k) + R.edgeAt(o, (n.k + 3) % 6) : '';
    return pair === 'WS' || pair === 'SW';
  });
}

// The list, over the game: L or the trophy button opens it; Esc, its × or a click outside closes
// it. While it is open the library keeps every key from the game.
const toggleAchievements = () => window.openachievements?.toggleList();

// ---------- sandbox palette ----------

let paletteTab = null;
let paletteBuilt = false;

const sameKind = (a, b) => a.base === b.base && (a.feature || null) === (b.feature || null);
const GROUP_LABELS = { land: 'Land', road: 'Roads', river: 'Rivers', sea: 'Sea' };

// One button per tile kind, with a thumbnail drawn once by the hand's thumbnail renderer.
function buildPalette() {
  if (paletteBuilt) return;
  paletteBuilt = true;
  for (const g of PALETTE_GROUPS) {
    const b = document.createElement('button');
    b.textContent = GROUP_LABELS[g];
    b.dataset.group = g;
    b.setAttribute('role', 'tab');
    b.onclick = () => { paletteTab = g; showPalette(); };
    $('palTabs').appendChild(b);
  }
  PALETTE.forEach((kind, i) => {
    const b = document.createElement('button');
    const name = tileName(kind);
    b.title = name;
    b.setAttribute('aria-label', name);
    b.dataset.i = i;
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    b.appendChild(c);
    view.thumbs.draw(c, { base: kind.base, feature: kind.feature, v: 3 + i }, 0);
    b.onclick = () => chooseTile(kind);
    $('palGrid').appendChild(b);
  });
}

function showPalette() {
  buildPalette();
  const choice = state.choice || state.queue[0];
  const cur = PALETTE.find((k) => sameKind(k, choice));
  if (!paletteTab) paletteTab = cur ? cur.group : 'land';
  $('palName').textContent = cur ? tileName(cur) : '';
  for (const b of $('palTabs').children) b.setAttribute('aria-selected', String(b.dataset.group === paletteTab));
  for (const b of $('palGrid').children) {
    const kind = PALETTE[b.dataset.i];
    b.hidden = kind.group !== paletteTab;
    b.classList.toggle('on', !!cur && kind === cur);
  }
}

function chooseTile(kind) {
  if (!R.isSandbox(state) || !R.choose(state, kind)) return;
  paletteTab = kind.group;
  save();
  onTurn();
  const on = $('palGrid').querySelector('.on');
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// T / Shift+T: the next or previous tile in the palette.
function cycleTile(dir) {
  if (!R.isSandbox(state)) return;
  const i = PALETTE.findIndex((k) => sameKind(k, state.choice || state.queue[0]));
  chooseTile(PALETTE[(i + dir + PALETTE.length) % PALETTE.length]);
}

// ---------- HUD ----------

// Tell the view how much of the screen the HUD covers at the top and the bottom.
function insets() {
  if ($('hud').hidden) return;
  const top = Math.max($('scorecard').getBoundingClientRect().bottom, $('charters').getBoundingClientRect().bottom);
  let bottom = $('hand').getBoundingClientRect().top;
  if (!$('turnbar').hidden) bottom = Math.min(bottom, $('turnbar').getBoundingClientRect().top);
  // On phones the sandbox palette sits right above the tray.
  const pal = $('palette').getBoundingClientRect();
  if (!$('palette').hidden && pal.top > window.innerHeight / 2) bottom = Math.min(bottom, pal.top);
  view.setInsets(top, window.innerHeight - bottom);
}
window.addEventListener('resize', insets);

function hud() {
  const sandbox = R.isSandbox(state);
  const multi = R.isMulti(state);
  const rival = R.isRival(state);
  document.body.classList.toggle('sandbox', sandbox);
  document.body.classList.toggle('together', multi);
  document.body.classList.toggle('online', !!together?.online);
  document.body.classList.toggle('rival', rival);
  $('modeTag').hidden = !sandbox;
  $('playTag').hidden = !multi;
  $('playTag').textContent = rival ? 'Rival lords' : 'Shared realm';
  $('palette').hidden = !sandbox;
  $('menuTitle').textContent = sandbox ? 'Sandbox' : multi ? (rival ? 'Rival lords' : 'Shared realm') : 'Realm';
  $('score').textContent = state.score;
  $('supply').textContent = sandbox ? '∞' : state.supply;
  $('supply').classList.toggle('low', !sandbox && state.supply <= 5);
  const box = $('charters');
  box.innerHTML = '';
  for (const c of state.charters) {
    const now = Math.min(R.charterProgress(state, c), c.n);
    const el = document.createElement('div');
    el.className = 'charter card' + (seenCharters.has(c.id) ? '' : ' fresh');
    el.innerHTML = `<div class="head"><span class="seal">Royal charter</span><span class="reward">+${c.pts}${sandbox ? '' : ` · +${c.tiles} tiles`}</span></div>
      <div class="txt">${R.charterText(c)} <small>(${now}/${c.n})</small></div>
      <div class="prog"><i style="width:${(100 * now) / c.n}%"></i></div>`;
    box.appendChild(el);
    seenCharters.add(c.id);
  }
  // A shared realm: the private charter of the player at this device (online), or of the
  // player whose turn it is (on one device).
  const pi = multi && !rival ? (together?.online && net?.me >= 0 ? net.me : state.current) : -1;
  const pc = pi >= 0 ? state.players[pi].charter : null;
  if (pc) {
    const now = Math.min(R.privateProgress(state, pi, pc), pc.n);
    const el = document.createElement('div');
    el.className = 'charter card private' + (seenCharters.has(pc.id) ? '' : ' fresh');
    el.style.setProperty('--c', bannerOf(pi).hex);
    const whose = together?.online && pi === net?.me ? 'Your charter' : `${nameOf(pi)}'s charter`;
    el.innerHTML = `<div class="head"><span class="seal">${whose}</span><span class="reward">+${pc.pts} · +${pc.tiles} tiles</span></div>
      <div class="txt">${R.privateText(pc)} <small>(${now}/${pc.n})</small></div>
      <div class="prog"><i style="width:${(100 * now) / pc.n}%"></i></div>`;
    // On a phone the heading is hidden: the line itself says whose it is.
    el.querySelector('.txt').dataset.who = together?.online && pi === net?.me ? 'You' : state.players[pi].name;
    box.appendChild(el);
    seenCharters.add(pc.id);
  }
  playersHud();
  turnHud();
  $('togetherLabel').innerHTML = together?.online && net
    ? `Room <b>${esc(net.code)}</b> · seed <code>${esc(state.seed)}</code>`
    : `On this device · seed <code>${esc(state.seed)}</code>`;
  $('seedLabel').textContent = state.seed;
  $('best').textContent = store.get('opendorf.best') || 0;
  insets();
}

function bump(id) {
  const el = $(id);
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function toast(html) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3300);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
}

function floater(q, r, text, cls, delay, color = null) {
  const el = document.createElement('div');
  el.className = 'floater ' + cls;
  el.textContent = text;
  if (color) el.style.color = color;
  el.style.opacity = 0;
  $('floaters').appendChild(el);
  floaters.push({ el, q, r, t: -delay, life: 1.4 });
}

view.onFrame = (dt) => {
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.t += dt;
    if (f.t < 0) continue;
    const k = f.t / f.life;
    if (k >= 1) {
      f.el.remove();
      floaters.splice(i, 1);
      continue;
    }
    const p = view.toScreen(f.q, f.r, 1.4 + k * 1.2);
    f.el.style.left = p.x + 'px';
    f.el.style.top = p.y + 'px';
    f.el.style.opacity = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
  }
  const c = target();
  const tip = $('tip');
  if (c && !tip.hidden) {
    const p = view.toScreen(c.q, c.r, 1.9);
    tip.style.left = p.x + 'px';
    tip.style.top = p.y + 'px';
  }
};

function showOver() {
  if (!state.over) return;
  const s = state.stats;
  $('finalStats').innerHTML = `<li>${s.placed} tiles laid</li><li>${s.built} buildings raised</li><li>${s.charters} charters fulfilled</li><li>Seed <code>${esc(state.seed)}</code></li>`;
  $('finalRanks').hidden = !R.isMulti(state);
  if (R.isMulti(state)) {
    // Together: no best realm to keep. Rival lords are ranked; a shared realm thanks its builders.
    const ranks = R.standings(state);
    if (R.isRival(state)) {
      const first = ranks.filter((p) => p.place === 1);
      $('finalScore').textContent = first[0].score;
      $('finalBest').innerHTML = `${first.map((p) => who(p.i)).join(' and ')} ${first.length > 1 ? 'share the realm' : 'wins the realm'}`;
      $('finalRanks').innerHTML = ranks.map((p) => `<li><span class="place">${p.place}</span>${who(p.i)}<b>${p.score}</b></li>`).join('');
    } else {
      $('finalScore').textContent = state.score;
      $('finalBest').textContent = 'Built together';
      $('finalRanks').innerHTML = ranks.map((p) => `<li>${who(p.i)}<span>${p.laid} tiles laid</span></li>`).join('');
    }
    $('over').hidden = false;
    return;
  }
  const best = Math.max(Number(store.get('opendorf.best') || 0), state.score);
  const isBest = best === state.score && state.score > 0;
  store.set('opendorf.best', String(best));
  $('finalScore').textContent = state.score;
  $('finalBest').textContent = isBest ? 'A new best realm!' : `Best realm: ${best}`;
  $('over').hidden = false;
}

// ---------- input ----------

const canvas = $('scene');
const pointers = new Map();
let drag = null;
let pinch = null;

function setTouch(on) {
  if (touchMode === on) return;
  touchMode = on;
  document.body.classList.toggle('touch', on);
  hover = null;
  selected = null;
  refreshGhost();
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  setTouch(e.pointerType === 'touch');
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  view.camGoal = null;
  if (pointers.size === 1) {
    drag = { button: e.button, x0: e.clientX, y0: e.clientY, moved: false, ground: view.groundAt(e.clientX, e.clientY), yaw0: view.cam.yaw, pitch0: view.cam.pitch, t0: performance.now() };
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), a0: Math.atan2(b.y - a.y, b.x - a.x), dist0: view.cam.dist, yaw0: view.cam.yaw, ground: view.groundAt((a.x + b.x) / 2, (a.y + b.y) / 2) };
    if (drag) drag.moved = true;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    view.cam.dist = pinch.dist0 * (pinch.d0 / Math.max(d, 1));
    view.cam.yaw = pinch.yaw0 - (Math.atan2(b.y - a.y, b.x - a.x) - pinch.a0);
    view.updateCamera();
    panTo(pinch.ground, (a.x + b.x) / 2, (a.y + b.y) / 2);
    return;
  }
  if (drag) {
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) > (touchMode ? 10 : 5)) drag.moved = true;
    if (drag.moved) {
      if (drag.button === 2 || drag.button === 1) {
        view.cam.yaw = drag.yaw0 - dx * 0.008;
        view.cam.pitch = drag.pitch0 + dy * 0.005;
        view.updateCamera();
      } else {
        panTo(drag.ground, e.clientX, e.clientY);
      }
    }
  }
  if (!touchMode) {
    const c = view.cellAt(e.clientX, e.clientY);
    if (!c || !hover || c.q !== hover.q || c.r !== hover.r) {
      hover = c;
      refreshGhost();
    }
  }
});

function panTo(ground, x, y) {
  if (!ground) return;
  const p = view.groundAt(x, y);
  if (!p) return;
  view.cam.target.x += ground.x - p.x;
  view.cam.target.z += ground.z - p.z;
  view.updateCamera();
}

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  const wasTap = drag && !drag.moved && pointers.size === 1;
  pointers.delete(e.pointerId);
  if (wasTap && e.type === 'pointerup') {
    if (drag.button === 2) rotate(1);
    else if (drag.button === 0) tap(view.cellAt(e.clientX, e.clientY));
  }
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 1) {
    const [p] = [...pointers.values()];
    drag = { button: 0, x0: p.x, y0: p.y, moved: true, ground: view.groundAt(p.x, p.y), yaw0: view.cam.yaw, pitch0: view.cam.pitch };
  } else if (pointers.size === 0) {
    drag = null;
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  if (!touchMode && !drag) {
    hover = null;
    refreshGhost();
  }
});

// The dungeon mouth: a small card with the way down, into OpenDelve.
function showDungeon(t) {
  $('dungeonLink').href = R.dungeonLink(state, t);
  $('dungeon').hidden = false;
}

// A tavern: a small card to run it as an inn, in OpenInn.
function showInn(t) {
  $('innLink').href = R.innLink(state, t);
  $('inn').hidden = false;
}

function tap(c) {
  if (!c) return;
  const t = R.tileAt(state, c.q, c.r);
  if (t?.dungeon) {
    showDungeon(t);
    return;
  }
  if (t?.building === 'tavern') {
    showInn(t);
    return;
  }
  // Together, on a touch screen: who laid this tile (the mouse sees it by hovering).
  if (touchMode && t && t.by !== undefined && R.isMulti(state)) {
    toast(`Laid by ${who(t.by)}`);
    if (!R.isRival(state)) {
      view.setHint(t);
      setTimeout(() => view.setHint(null), 2000);
    }
  }
  if (!touchMode) {
    placeAt(c);
    return;
  }
  if (selected && selected.q === c.q && selected.r === c.r) {
    placeAt(c);
    return;
  }
  selected = touchesRealm(c) && !R.tileAt(state, c.q, c.r) ? c : null;
  refreshGhost();
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view.camGoal = null;
  view.cam.dist *= Math.exp(e.deltaY * 0.0012);
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input,textarea')) return;
  const k = e.key.toLowerCase();
  const sheets = ['help', 'menu', 'dungeon', 'inn', 'together', 'lobby', 'curtain'];
  if (k === 'l' && sheets.every((id) => $(id).hidden)) {
    toggleAchievements();
    e.preventDefault();
    return;
  }
  const overlayOpen = sheets.some((id) => !$(id).hidden) || !!window.openachievements?.isListOpen();
  if (k === 'escape') {
    $('help').hidden = true;
    $('menu').hidden = true;
    $('dungeon').hidden = true;
    $('inn').hidden = true;
    $('together').hidden = true;
    selected = null;
    refreshGhost();
    return;
  }
  if (overlayOpen) return;
  const step = 1.6;
  const fwd = { x: -Math.sin(view.cam.yaw), z: -Math.cos(view.cam.yaw) };
  const right = { x: -fwd.z, z: fwd.x };
  const move = (f, s) => {
    view.camGoal = null;
    view.cam.target.x += (fwd.x * f + right.x * s) * step;
    view.cam.target.z += (fwd.z * f + right.z * s) * step;
  };
  if (k === 'r') rotate(e.shiftKey ? -1 : 1);
  else if (k === 'f') rotate(-1);
  else if (k === 'z' || (k === 'z' && (e.ctrlKey || e.metaKey))) undo();
  else if (k === 'x') discardTile();
  else if (k === 't') cycleTile(e.shiftKey ? -1 : 1);
  else if (k === 'c') view.frame(state);
  else if (k === 'h' || k === '?') $('help').hidden = false;
  else if (k === 'q') view.cam.yaw += 0.3;
  else if (k === 'e') view.cam.yaw -= 0.3;
  else if (k === 'w' || k === 'arrowup') move(1, 0);
  else if (k === 's' || k === 'arrowdown') move(-1, 0);
  else if (k === 'a' || k === 'arrowleft') move(0, -1);
  else if (k === 'd' || k === 'arrowright') move(0, 1);
  else if (k === '+' || k === '=') view.cam.dist *= 0.85;
  else if (k === '-') view.cam.dist /= 0.85;
  else return;
  e.preventDefault();
});

// ---------- buttons ----------

$('bRotL').onclick = () => rotate(-1);
$('bRotR').onclick = () => rotate(1);
$('bPlace').onclick = () => placeAt(selected);
$('bDiscard').onclick = discardTile;
$('bUndo').onclick = undo;
$('bCenter').onclick = () => view.frame(state);
$('bAch').onclick = toggleAchievements;
$('bHelp').onclick = () => { $('help').hidden = false; };
$('bHelpClose').onclick = () => { $('help').hidden = true; store.set('opendorf.seenHelp', '1'); };
$('bMenu').onclick = () => { hud(); $('menu').hidden = false; };
$('bMenuClose').onclick = () => { $('menu').hidden = true; };
$('bNew').onclick = () => { $('menu').hidden = true; startGame(randomSeed()); };
$('bDaily').onclick = () => { $('menu').hidden = true; startGame(todaySeed()); };
$('bRestart').onclick = () => { $('menu').hidden = true; startGame(state.seed); };
$('bSandbox').onclick = () => { $('menu').hidden = true; enterSandbox(); };
$('bNewSandbox').onclick = () => { $('menu').hidden = true; startSandbox(); };
$('bLeave').onclick = () => { $('menu').hidden = true; leaveSandbox(); };
$('bShare').onclick = async () => {
  const u = new URL(location.href);
  u.search = '?seed=' + encodeURIComponent(state.seed);
  try {
    await navigator.clipboard.writeText(u.href);
    toast('Link copied');
  } catch {
    toast(u.href);
  }
};
// Map export. ?origin=lon,lat places the realm on the globe (default 0,0).
function downloadGeo() {
  const o = (new URLSearchParams(location.search).get('origin') || '').split(',').map(Number);
  const origin = o.length === 2 && o.every(Number.isFinite) ? o : [0, 0];
  const blob = new Blob([JSON.stringify(toGeoJSON(state, { origin }))], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `opendorf-${state.seed}.geojson`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  if (!together) window.openachievements?.unlock('CARTOGRAPHER');
}
$('bGeo').onclick = downloadGeo;
$('bOverGeo').onclick = downloadGeo;
$('bOverNew').onclick = () => startGame(randomSeed());
$('bOverAgain').onclick = () => { $('over').hidden = true; openTogether(true); };
$('bOverLeave').onclick = leaveTogether;
$('bTogether').onclick = () => { $('menu').hidden = true; openTogether(false); };
$('bLeaveTogether').onclick = () => { $('menu').hidden = true; leaveTogether(); };
$('bInvite').onclick = () => copyInvite();
$('bOverRestart').onclick = () => startGame(state.seed);
$('bOverLook').onclick = () => { $('over').hidden = true; view.frame(state); };
$('bDungeonClose').onclick = () => { $('dungeon').hidden = true; };
$('dungeonLink').onclick = () => { $('dungeon').hidden = true; };
$('bInnClose').onclick = () => { $('inn').hidden = true; };
$('innLink').onclick = () => { $('inn').hidden = true; };
for (const id of ['help', 'menu', 'dungeon', 'inn', 'together']) {
  $(id).addEventListener('click', (e) => {
    if (e.target.id === id) $(id).hidden = true;
  });
}

// ---------- playing together ----------

// Each player's chip: their colour, name and, in a rival game, renown; the one to play is lit.
function playersHud() {
  const box = $('players');
  box.hidden = !R.isMulti(state);
  if (box.hidden) return;
  const rival = R.isRival(state);
  box.innerHTML = state.players.map((p, i) => {
    const now = i === state.current && !state.over ? ' now' : '';
    const you = together?.online && i === net?.me ? ' <small>(you)</small>' : '';
    return `<div class="pl${now}" style="--c:${bannerOf(i).hex}"><i></i><span class="nm">${nameOf(i)}${you}</span>${rival ? `<b>${p.score}</b>` : ''}</div>`;
  }).join('');
}

// Whose turn it is, in their colour, above the tray.
function turnHud() {
  const bar = $('turnbar');
  bar.hidden = !R.isMulti(state) || state.over;
  if (bar.hidden) return;
  const i = state.current;
  const b = bannerOf(i);
  bar.style.setProperty('--c', b.hex);
  bar.style.setProperty('--on', b.ink);
  let text = `${nameOf(i)}'s turn`;
  let skip = false;
  if (together?.online && net) {
    if (net.me === i) {
      text = state.moved || net.pending ? 'Your move is on its way…' : 'Your turn';
    } else if (net.away.has(state.players[i].seat)) {
      text = `${nameOf(i)} is away`;
      skip = net.me >= 0 && !state.moved && !net.readySent && !net.ready.has(net.faction);
    } else {
      text = `${nameOf(i)} is thinking…`;
    }
  }
  $('turnWho').innerHTML = text;
  $('bSkip').hidden = !skip;
  tick();
}

// The countdown to the end of an online turn, kept by the server's clock.
function tick() {
  const el = $('turnClock');
  if (!together?.online || !net || state.over) {
    el.textContent = '';
    return;
  }
  if (net.paused) el.textContent = ' · paused';
  else if (net.deadline === null) el.textContent = '';
  else el.textContent = ` · ${Math.ceil(Math.max(0, net.deadline - performance.now()) / 1000)} s`;
}
setInterval(tick, 250);

// ---------- on this device ----------

// "Pass to <name>": a curtain in the next player's colour, after `delay` ms (once the news of the
// last move has played). No one plays until it is lifted.
function curtainFor(i, delay) {
  clearTimeout(curtain?.timer);
  curtain = { i, timer: setTimeout(showCurtain, delay) };
  onTurn();
}

function showCurtain() {
  if (!curtain || !together?.local || state.over) {
    curtain = null;
    $('curtain').hidden = true;
    return;
  }
  const i = curtain.i;
  const p = state.players[i];
  const b = bannerOf(i);
  $('curtain').style.setProperty('--c', b.hex);
  $('curtain').style.setProperty('--on', b.ink);
  $('curtainName').textContent = p.name;
  $('curtainInfo').innerHTML = R.isRival(state)
    ? `Hand the device to ${nameOf(i)}, who has <b>${p.score}</b> renown.`
    : `Hand the device to ${nameOf(i)}.${p.charter ? ` Their charter: <i>${R.privateText(p.charter)}</i>.` : ''}`;
  $('bCurtain').textContent = `I am ${p.name}`;
  $('curtain').hidden = false;
}

$('bCurtain').onclick = () => {
  $('curtain').hidden = true;
  curtain = null;
  selected = null;
  onTurn();
};

// The setup sheet: how to play, who plays (2 to 4, each a name and a colour of their own), the
// seed; then this device, or an online room.
const COLOURS = Object.keys(BANNERS);
let seats = [];

function loadSeats() {
  try {
    const s = JSON.parse(store.get('opendorf.together.players') || 'null');
    if (Array.isArray(s) && s.length >= R.MIN_PLAYERS && s.length <= R.MAX_PLAYERS) return s;
  } catch { /* none kept */ }
  return [{ name: 'Player 1', color: 'blue' }, { name: 'Player 2', color: 'red' }];
}

function renderSeats() {
  const box = $('seats');
  box.innerHTML = '';
  seats.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'seat';
    row.style.setProperty('--c', BANNERS[p.color].hex);
    const sw = COLOURS.map((c) => `<button class="sw${c === p.color ? ' on' : ''}" data-c="${c}" style="--c:${BANNERS[c].hex}" title="${BANNERS[c].name}" aria-label="${BANNERS[c].name}"></button>`).join('');
    row.innerHTML = `<span class="sws">${sw}</span><input maxlength="24" aria-label="Name of player ${i + 1}" value="${esc(p.name)}">`
      + `<button class="x" title="Remove" aria-label="Remove this player"${seats.length <= R.MIN_PLAYERS ? ' disabled' : ''}>×</button>`;
    // A colour another player has is swapped with theirs: every colour stays someone's own.
    row.querySelectorAll('.sw').forEach((b) => {
      b.onclick = () => {
        const other = seats.find((q) => q !== p && q.color === b.dataset.c);
        if (other) other.color = p.color;
        p.color = b.dataset.c;
        renderSeats();
      };
    });
    row.querySelector('input').oninput = (e) => { p.name = e.target.value; };
    row.querySelector('.x').onclick = () => {
      seats.splice(i, 1);
      renderSeats();
    };
    box.appendChild(row);
  });
  $('bAddSeat').hidden = seats.length >= R.MAX_PLAYERS;
}

$('bAddSeat').onclick = () => {
  if (seats.length >= R.MAX_PLAYERS) return;
  seats.push({ name: `Player ${seats.length + 1}`, color: COLOURS.find((c) => !seats.some((p) => p.color === c)) });
  renderSeats();
};

function openTogether(again) {
  seats = again && R.isMulti(state) ? state.players.map((p) => ({ name: p.name, color: p.color })) : loadSeats();
  if (again) document.querySelector(`input[name=play][value=${state.play || 'shared'}]`).checked = true;
  $('tSeed').value = randomSeed();
  $('tPace').innerHTML = Net.PACES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  $('tError').textContent = '';
  renderSeats();
  $('together').hidden = false;
}

function formValues() {
  const players = seats.map((p, i) => ({ name: p.name.trim().slice(0, 24) || `Player ${i + 1}`, color: p.color }));
  store.set('opendorf.together.players', JSON.stringify(players));
  return {
    players,
    play: document.querySelector('input[name=play]:checked').value,
    seed: $('tSeed').value.trim().slice(0, 40) || randomSeed(),
  };
}

function startLocal() {
  const { players, play, seed } = formValues();
  dropOnline();
  together = { local: true };
  enter(R.newGame(seed, { players, play }), { fresh: true });
  $('together').hidden = true;
  save();
  onTurn();
  curtainFor(0, 0);
}

// Back to the realm of one's own (or a new one).
function leaveTogether() {
  clearTimeout(curtain?.timer);
  curtain = null;
  $('curtain').hidden = true;
  $('lobby').hidden = true;
  $('over').hidden = true;
  dropOnline();
  together = null;
  const s = loadSaved('normal');
  if (s) resume(s.saved, s.undo);
  else startGame(randomSeed());
}

$('bLocal').onclick = startLocal;
$('bHost').onclick = openRoom;
$('bJoin').onclick = () => joinRoom($('tCode').value);
$('tCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('tCode').value); });
$('bTogetherClose').onclick = () => { $('together').hidden = true; };
$('bSkip').onclick = () => {
  // The player to move is away: end the turn without them (their tile is thrown away).
  if (net) net.readySent = send({ t: 'ready' });
  hud();
};

// ---------- online ----------
// Through the Lilienstern game server (net.js). A room's seats are the players; the host sets
// the way to play and the seed (the room's params), and the pace. A turn is the server's day:
// the player to move sends 'lay' or 'discard', and every browser ends the day once that move is
// in (see maybeReady). Every browser runs every move from the server's log on its own copy of the
// game, refusing the same ones, and after each turn reports a fingerprint of it.

const UNREACHABLE = 'Could not reach the game server, so online play is not available here (on Wavedash, for one, the server does not let the game in). You can still play together on this device.';

let inbox = Promise.resolve();

function send(msg) {
  return !!net?.conn && net.conn.send(msg);
}

function hello() {
  send({ t: 'hello', game: Net.GAME_ID, code: net.code, token: net.token, have: net.started ? net.log.length : 0 });
}

// Closes the line to the server, if there is one.
function dropOnline() {
  if (net) {
    const old = net;
    net = null;
    old.conn?.close();
  }
  if (together?.online) together = null;
}

async function netStart(code) {
  dropOnline();
  const n = {
    token: Net.token(), code, owner: false, faction: null, me: -1, log: [], started: false,
    away: new Set(), ready: new Set(), readySent: false, pending: false, deadline: null, paused: false,
  };
  net = n;
  n.version = await Net.rulesVersion().catch(() => '');
  try {
    n.conn = await Net.connect((msg) => {
      inbox = inbox.then(() => (net === n ? serverMessage(msg) : null)).catch((e) => console.error(e));
    }, (s) => {
      if (net !== n) return;
      if (s === 'lost') {
        if (n.started) toast('Lost the line to the game server: trying again…');
      } else {
        if (n.started) toast('Connected again.');
        n.readySent = false;
        hello();
      }
    });
  } catch {
    if (net === n) net = null;
    throw new Error(UNREACHABLE);
  }
  if (net !== n) {
    n.conn.close();
    throw new Error('cancelled');
  }
}

async function openRoom() {
  const { players, play, seed } = formValues();
  const pace = $('tPace').value;
  $('tError').textContent = '';
  $('bHost').disabled = true;
  try {
    await netStart(null);
    net.owner = true;
    send({
      t: 'create', game: Net.GAME_ID, token: net.token, version: net.version, pace, seat: 0,
      params: { mode: play, seed, seats: players },
      seed: R.hashSeed(seed),
      families: players.map((p, i) => ({ i, name: p.name, color: p.color })),
    });
  } catch (e) {
    $('tError').textContent = e.message;
  } finally {
    $('bHost').disabled = false;
  }
}

// `direct`: from a ?join= link, straight to the room's sheet.
async function joinRoom(text, direct = false) {
  const code = Net.cleanCode(text);
  if (!code) {
    $('tError').textContent = 'Type the room code.';
    return;
  }
  $('tError').textContent = '';
  if (direct) {
    $('lobbyBox').innerHTML = `<h2>Room <span class="code">${esc(code)}</span></h2><p>Joining…</p>`;
    $('lobby').hidden = false;
  }
  $('bJoin').disabled = true;
  try {
    await netStart(code);
    hello();
  } catch (e) {
    if (e.message !== 'cancelled') netError(e.message);
  } finally {
    $('bJoin').disabled = false;
  }
}

// Before the game: on the setup sheet if it is open, else on the room's sheet.
function netError(msg) {
  if (!$('together').hidden) {
    $('tError').textContent = msg;
    return;
  }
  $('lobby').hidden = false;
  let el = $('lobbyError');
  if (!el) {
    $('lobbyBox').innerHTML = `<h2>Playing online</h2><p class="error" id="lobbyError"></p>
      <button class="btn" id="bLobbyLocal">Play together on this device</button>
      <button class="btn ghost" id="bLobbyLeave">Back to my realm</button>`;
    el = $('lobbyError');
    $('bLobbyLocal').onclick = () => { $('lobby').hidden = true; dropOnline(); openTogether(false); };
    $('bLobbyLeave').onclick = () => { $('lobby').hidden = true; dropOnline(); setURL(); };
  }
  el.textContent = msg;
}

const inviteLink = (code) => `${location.origin}${location.pathname}?join=${code}`;

async function copyInvite() {
  const link = inviteLink(net?.code || '');
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied');
  } catch {
    toast(esc(link));
  }
}

// The room before the game: its code and link, the seats, the pace, and the host's Begin.
function showLobby(msg) {
  const p = msg.params || {};
  const taken = new Map(msg.taken.map(([f, w, gone]) => [f, { w, gone }]));
  const seated = msg.taken.some(([, w]) => w === 'you');
  const count = msg.taken.length;
  const same = !net.version || !msg.version || msg.version === net.version;
  const rows = msg.families.map((f) => {
    const t = taken.get(f.i);
    let status;
    if (t) {
      status = t.w === 'you' ? 'You' : t.w === 'host' ? 'The host' : 'A friend';
      if (t.gone) status += ' (away)';
      // Someone who left can take their seat back from another tab or device.
      if (t.gone && !seated && msg.started) status += ` <button data-f="${f.i}">Take over</button>`;
    } else if (msg.started) {
      status = 'Not playing';
    } else {
      status = seated ? 'Free' : `<button data-f="${f.i}">Sit here</button>`;
    }
    const b = BANNERS[f.color] || BANNERS.blue;
    return `<div class="seatrow" style="--c:${b.hex}"><i></i><b>${esc(f.name)}</b><span>${status}</span></div>`;
  }).join('');
  const way = p.mode === 'rival' ? 'Rival lords' : 'Shared realm';
  const pace = msg.owner && !msg.started
    ? `<label class="seedrow">Pace <select id="lobbyPace">${Net.PACES.map(([v, t]) => `<option value="${v}"${v === msg.pace ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`
    : `<p>Pace: <b>${Net.paceName(msg.pace)}</b></p>`;
  let how;
  if (msg.started) how = seated ? 'The game is under way.' : 'The game is under way: only a player who is away can be taken over.';
  else if (msg.owner) how = count < 2 ? 'Waiting for at least one more player.' : 'Begin when everyone is seated.';
  else how = seated ? 'The host begins the game.' : 'Pick your seat.';
  $('lobbyBox').innerHTML = `<h2>Room <span class="code">${esc(msg.code)}</span></h2>
    <p><b>${way}</b> · seed <code>${esc(p.seed)}</code></p>
    <div class="invite"><input readonly value="${esc(inviteLink(msg.code))}" aria-label="Invite link"><button id="bCopyInvite">Copy</button></div>
    <div class="seatlist">${rows}</div>${pace}<p class="muted">${how}</p>
    ${same ? '' : '<p class="error">This room plays another version of OpenDorf: reload the page (all of you).</p>'}
    <p class="error" id="lobbyError" role="alert"></p>
    ${msg.owner && !msg.started ? `<button class="btn" id="bBegin"${count < 2 || !same ? ' disabled' : ''}>Begin</button>` : ''}
    <button class="btn ghost" id="bLobbyLeave">Leave the room</button>`;
  $('bCopyInvite').onclick = copyInvite;
  if ($('bBegin')) $('bBegin').onclick = () => { $('bBegin').disabled = true; send({ t: 'begin' }); };
  if ($('lobbyPace')) $('lobbyPace').onchange = (e) => send({ t: 'pace', pace: e.target.value });
  $('lobbyBox').querySelectorAll('button[data-f]').forEach((b) => {
    b.disabled = !same;
    b.onclick = () => {
      send({ t: 'pick', faction: +b.dataset.f });
      $('lobbyBox').querySelectorAll('button[data-f]').forEach((x) => { x.disabled = true; });
    };
  });
  $('bLobbyLeave').onclick = leaveTogether;
  $('together').hidden = true;
  $('lobby').hidden = false;
}

async function serverMessage(msg) {
  if (msg.t === 'lobby') {
    net.code = msg.code;
    net.owner = msg.owner;
    if (net.started) return;
    const u = new URL(location.href);
    u.searchParams.set('join', msg.code);
    history.replaceState(null, '', u);
    showLobby(msg);
  } else if (msg.t === 'start') {
    net.code = msg.code;
    net.owner = msg.owner;
    // Back after a dropped line: only the moves missed. Otherwise (a reload, a late arrival, or
    // the server asking everyone to replay after fingerprints differed) the whole game again.
    if (net.started && msg.from > 0 && msg.from === net.log.length) catchUp(msg.commands);
    else launchOnline(msg);
  } else if (msg.t === 'cmd') {
    if (!net.started) return;
    if (msg.seq !== net.log.length + 1) { send({ t: 'resync' }); return; }
    onCommand(msg.cmd);
  } else if (msg.t === 'step') {
    if (!net.started) return;
    if (msg.seq !== net.log.length + 1) { send({ t: 'resync' }); return; }
    onStep();
  } else if (msg.t === 'away') {
    net.away = new Set(msg.away);
    net.ready = new Set(msg.ready);
    if (net.started) {
      hud();
      maybeReady();
    }
  } else if (msg.t === 'clock') {
    net.paused = msg.paused;
    net.deadline = msg.ms === null || msg.ms === undefined ? null : performance.now() + msg.ms;
    tick();
  } else if (msg.t === 'note') {
    // The server's words are for Lilienstern's days; here an absent player's turn waits (or is
    // skipped), so leave out that the days go on.
    if (net.started) toast(esc(String(msg.msg).replace('; the days go on without waiting.', '.')));
  } else if (msg.t === 'err') {
    if (net.started) {
      toast(esc(msg.msg));
      net.pending = false;
      onTurn();
    } else {
      netError(msg.msg);
      $('lobbyBox').querySelectorAll('button[data-f]').forEach((x) => { x.disabled = false; });
      if ($('bBegin')) $('bBegin').disabled = false;
    }
  }
}

// A move of the server's log, run on this browser's game. It is part of the log whether or not
// the rules take it (every browser refuses the same ones). Returns the events, or null.
function follow(c) {
  net.log.push(c);
  return c.op === 'step' ? R.endTurn(state) : R.command(state, c);
}

// Builds the game from the room's settings and replays its log.
function launchOnline(msg) {
  const st = msg.settings || {};
  const p = st.params || {};
  let s;
  try {
    const players = (st.players || []).map((f) => {
      const seat = (Array.isArray(p.seats) && p.seats[f]) || {};
      return { name: String(seat.name || `Player ${f + 1}`), color: BANNERS[seat.color] ? seat.color : 'blue', seat: f };
    });
    s = R.newGame(String(p.seed ?? st.seed), { players, play: p.mode });
  } catch (e) {
    netError('This room cannot be played: ' + e.message);
    return;
  }
  clearTimeout(curtain?.timer);
  curtain = null;
  together = { online: true };
  Object.assign(net, { started: true, faction: msg.faction, log: [], readySent: false, pending: false });
  state = s;
  for (const c of msg.commands || []) follow(c);
  net.me = state.players.findIndex((x) => x.seat === msg.faction);
  for (const id of ['lobby', 'together', 'menu', 'curtain', 'over']) $(id).hidden = true;
  enter(state);
  onTurn();
  maybeReady();
}

function catchUp(commands) {
  for (const c of commands) follow(c);
  view.sync(state);
  onTurn();
  maybeReady();
}

function onCommand(c) {
  const events = follow(c);
  const mine = c.faction === net.faction;
  if (mine) net.pending = false;
  if (events) {
    selected = null;
    view.sync(state);
    react(events);
    if (c.op === 'discard') toast(mine ? 'Tile thrown away' : `${who(state.current)} throws a tile away`);
  } else if (mine) {
    toast('That move did not count: try again.');
  }
  if (state.over) send({ t: 'over' });
  onTurn();
  maybeReady();
}

// The end of a turn: the next player's. Then this browser says what it makes of the game.
function onStep() {
  const events = follow({ op: 'step' });
  net.readySent = false;
  net.pending = false;
  send({ t: 'fp', seq: net.log.length, fp: R.fingerprint(state) });
  if (events) {
    view.sync(state);
    react(events);
  }
  if (state.over) send({ t: 'over' });
  selected = null;
  onTurn();
  maybeReady();
}

// Ends the day for this browser once the player to move has made their move (and it is in the
// log). Not before: the server runs the day as soon as everyone still connected has ended it,
// so a player who reloads, or whose line drops, in the middle of their turn would lose it.
// Without a move the turn ends by the pace's clock, or when someone skips an absent player.
function maybeReady() {
  if (!net?.started || state.over || net.readySent || net.ready.has(net.faction)) return;
  // Someone skipped an absent player's turn: follow them.
  const seat = state.players[state.current].seat;
  const skipped = net.away.has(seat) && [...net.ready].some((f) => f !== seat);
  if (!state.moved && !skipped) return;
  net.readySent = send({ t: 'ready' });
  hud();
}

// This browser's player wants a move made: the server puts it in the log, for everyone.
function request(cmd) {
  if (!send({ t: 'req', cmd })) {
    toast('Not connected to the game server: wait a moment.');
    return;
  }
  net.pending = true;
  selected = null;
  onTurn();
}

// ---------- boot ----------

async function boot() {
  await view.load((k) => { $('loadbar').style.width = `${Math.round(k * 100)}%`; window.WavedashHook?.progress(k); });
  const params = new URLSearchParams(location.search);
  const urlSeed = params.get('seed');
  // ?join=CODE goes into an online room (the realm of one's own waits behind it).
  const join = Net.cleanCode(params.get('join'));
  const lastMode = store.get('opendorf.mode');
  const local = !join && (params.get('mode') === 'together' || (!urlSeed && lastMode === 'together')) && loadSaved('together');
  // ?mode=sandbox opens the sandbox; a plain link goes back to whichever was played last.
  if (local) {
    resume(local.saved, null);
  } else if (!join && (params.get('mode') === 'sandbox' || (!urlSeed && lastMode === 'sandbox'))) {
    enterSandbox();
  } else {
    const s = loadSaved('normal');
    if (s && (!urlSeed || s.saved.seed === urlSeed)) resume(s.saved, s.undo);
    else startGame(urlSeed || randomSeed());
  }
  $('loading').hidden = true;
  window.WavedashHook?.ready(); // on Wavedash: loaded, show the game
  $('hud').hidden = false;
  insets();
  view.shift = view.shiftGoal;
  view.applyShift();
  if (!store.get('opendorf.seenHelp') && !join) $('help').hidden = false;
  view.start();
  if (join) joinRoom(join, true);
  window.__opendorf = {
    get state() { return state; }, get net() { return net; }, get together() { return together; },
    view, R, placeAt, rotate, chooseTile, enterSandbox, leaveSandbox, tap, discardTile, openTogether, joinRoom,
  };
}

boot().catch((err) => {
  console.error(err);
  window.WavedashHook?.ready(); // show the error, not Wavedash's loading screen
  $('loading').innerHTML = `<div class="title">OpenDorf</div><p>Could not load the realm: ${String(err.message || err)}</p>`;
});
