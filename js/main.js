import { View } from './view.js';
import * as R from './rules.js';
import { BUILDINGS, CAMPS, PALETTE, PALETTE_GROUPS, tileName } from './tiles.js';
import { toGeoJSON } from './geojson.js';

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

// ---------- game flow ----------

function randomSeed() {
  return Math.random().toString(36).slice(2, 8);
}

function todaySeed() {
  const d = new Date();
  return `day-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A sandbox realm has no seed worth sharing: its link just says "sandbox".
function setURL() {
  const u = new URL(location.href);
  if (R.isSandbox(state)) {
    u.searchParams.delete('seed');
    u.searchParams.set('mode', 'sandbox');
  } else {
    u.searchParams.delete('mode');
    u.searchParams.set('seed', state.seed);
  }
  history.replaceState(null, '', u);
}

// The normal game and the sandbox keep separate saves, so one never overwrites the other.
const SAVES = {
  normal: { game: 'opendorf.save', undo: 'opendorf.undo' },
  sandbox: { game: 'opendorf.sandbox', undo: 'opendorf.sandbox.undo' },
};

function loadSaved(mode) {
  let saved = null;
  try { saved = JSON.parse(store.get(SAVES[mode].game) || 'null'); } catch { saved = null; }
  if (!saved || saved.version !== 1 || saved.over || (saved.mode || 'normal') !== mode) return null;
  return { saved, undo: store.get(SAVES[mode].undo) };
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

function startGame(seed, mode = 'normal') {
  state = R.newGame(seed, { mode });
  undoJSON = null;
  paletteTab = null;
  selected = null;
  wantRot = 0;
  seenCharters = new Set(state.charters.map((c) => c.id));
  view.clear();
  view.sync(state, { animate: false });
  view.cam.target.set(0, 0, 0);
  view.cam.dist = 15;
  $('over').hidden = true;
  setURL();
  save();
  onTurn();
}

function resume(saved, undo) {
  state = saved;
  undoJSON = undo || null;
  paletteTab = null;
  seenCharters = new Set(state.charters.map((c) => c.id));
  view.clear();
  view.sync(state, { animate: false });
  view.frame(state);
  $('over').hidden = true;
  selected = null;
  setURL();
  store.set('opendorf.mode', state.mode || 'normal');
  onTurn();
}

function save() {
  const keys = SAVES[R.isSandbox(state) ? 'sandbox' : 'normal'];
  store.set(keys.game, JSON.stringify(state));
  store.set(keys.undo, undoJSON || '');
  store.set('opendorf.mode', state.mode || 'normal');
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
  $('bUndo').disabled = !undoJSON;
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
  if (!c || !piece || R.tileAt(state, c.q, c.r) || !touchesRealm(c)) {
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
        if (e.type === 'build') lines.push(`<span class="b">${BUILDINGS[e.building].verb === 'laid out' ? 'lays out' : 'raises'} ${aOrAn(BUILDINGS[e.building].name)}</span>`);
        if (e.type === 'clear') lines.push(`<span class="b">clears the ${CAMPS[e.camp].name.toLowerCase()}</span>`);
        if (e.type === 'charter') lines.push(`<span class="b">fulfils a charter</span>`);
      }
      tip.innerHTML = `<span class="pts">+${p.pts}</span>${lines.join('')}`;
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
  const k = `${state.turn}|${p.base}|${p.feature}|${p.v}|${q}|${r}|${rot}`;
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
  const before = JSON.stringify(state);
  const rot = forceRot ?? nearestLegal(rots, wantRot);
  const events = R.place(state, c.q, c.r, rot);
  if (!events) return;
  undoJSON = before;
  selected = null;
  view.sync(state);
  react(events);
  tally(events);
  save();
  onTurn();
}

function discardTile() {
  if (state.over || R.isSandbox(state)) return;
  const before = JSON.stringify(state);
  const events = R.discard(state);
  if (!events) return;
  undoJSON = before;
  toast('Tile thrown away');
  tally(events);
  hud();
  save();
  onTurn();
}

function undo() {
  if (!undoJSON) return;
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
  for (const e of events) {
    if (e.type === 'place') floater(e.q, e.r, `+${e.pts}`, '', 0);
    if (e.type === 'build') {
      const b = BUILDINGS[e.building];
      delay += 0.5;
      floater(e.q, e.r, b.name, 'build', delay);
      toast(`<b>${b.name}</b> ${b.verb || 'raised'} · +${e.pts} renown${more(e.tiles)}`);
    }
    // The wild: a camp turns up, a camp is cleared, a dungeon mouth opens.
    if (e.type === 'camp') toast(e.camp === 'bandits'
      ? 'Bandits have made camp in the forest. A watchtower or Barracks nearby will see them off.'
      : 'Wolves den in the mountain. A watchtower or Barracks nearby will see them off.');
    if (e.type === 'clear') {
      delay += 0.5;
      floater(e.q, e.r, 'Cleared', 'build', delay);
      toast(`<b>${CAMPS[e.camp].name}</b> cleared · +${e.pts} renown${more(e.tiles)}`);
    }
    if (e.type === 'dungeon') toast('A dark way opens under the mountain. <b>Tap it</b> to look inside.');
    if (e.type === 'charter') toast(`Charter fulfilled: ${e.text} · <b>+${e.pts}</b>${more(e.tiles)}`);
  }
  bump('score');
  if (events.some((e) => e.type === 'build' || e.type === 'charter' || e.type === 'clear')) bump('supply');
}

// ---------- achievements ----------

// achievements.json lists them; vendor/openachievements keeps the player's progress and reports
// it (to Wavedash, when the game runs there). Only normal realms earn them: in the sandbox every
// tile is chosen, so it counts nothing (but the map download). What a realm has already counted
// travels with it in `state.ach`, which undo leaves alone, so a move undone and made again is
// not counted twice.
const TRADES = ['lumbermill', 'windmill', 'watermill', 'mine', 'watchtower'];

function tally(events) {
  const oa = window.openachievements;
  if (!oa || R.isSandbox(state)) return;
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
  // On phones the sandbox palette sits right above the tray.
  const pal = $('palette').getBoundingClientRect();
  if (!$('palette').hidden && pal.top > window.innerHeight / 2) bottom = Math.min(bottom, pal.top);
  view.setInsets(top, window.innerHeight - bottom);
}
window.addEventListener('resize', insets);

function hud() {
  const sandbox = R.isSandbox(state);
  document.body.classList.toggle('sandbox', sandbox);
  $('modeTag').hidden = !sandbox;
  $('palette').hidden = !sandbox;
  $('menuTitle').textContent = sandbox ? 'Sandbox' : 'Realm';
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

function floater(q, r, text, cls, delay) {
  const el = document.createElement('div');
  el.className = 'floater ' + cls;
  el.textContent = text;
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
  const best = Math.max(Number(store.get('opendorf.best') || 0), state.score);
  const isBest = best === state.score && state.score > 0;
  store.set('opendorf.best', String(best));
  $('finalScore').textContent = state.score;
  $('finalBest').textContent = isBest ? 'A new best realm!' : `Best realm: ${best}`;
  const s = state.stats;
  $('finalStats').innerHTML = `<li>${s.placed} tiles laid</li><li>${s.built} buildings raised</li><li>${s.charters} charters fulfilled</li><li>Seed <code>${state.seed}</code></li>`;
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

function tap(c) {
  if (!c) return;
  const t = R.tileAt(state, c.q, c.r);
  if (t?.dungeon) {
    showDungeon(t);
    return;
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
  if (k === 'l' && $('help').hidden && $('menu').hidden && $('dungeon').hidden) {
    toggleAchievements();
    e.preventDefault();
    return;
  }
  const overlayOpen = !$('help').hidden || !$('menu').hidden || !$('dungeon').hidden || !!window.openachievements?.isListOpen();
  if (k === 'escape') {
    $('help').hidden = true;
    $('menu').hidden = true;
    $('dungeon').hidden = true;
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
  window.openachievements?.unlock('CARTOGRAPHER');
}
$('bGeo').onclick = downloadGeo;
$('bOverGeo').onclick = downloadGeo;
$('bOverNew').onclick = () => startGame(randomSeed());
$('bOverRestart').onclick = () => startGame(state.seed);
$('bOverLook').onclick = () => { $('over').hidden = true; view.frame(state); };
$('bDungeonClose').onclick = () => { $('dungeon').hidden = true; };
$('dungeonLink').onclick = () => { $('dungeon').hidden = true; };
for (const id of ['help', 'menu', 'dungeon']) {
  $(id).addEventListener('click', (e) => {
    if (e.target.id === id) $(id).hidden = true;
  });
}

// ---------- boot ----------

async function boot() {
  await view.load((k) => { $('loadbar').style.width = `${Math.round(k * 100)}%`; window.WavedashHook?.progress(k); });
  const params = new URLSearchParams(location.search);
  const urlSeed = params.get('seed');
  // ?mode=sandbox opens the sandbox; a plain link goes back to whichever was played last.
  if (params.get('mode') === 'sandbox' || (!urlSeed && store.get('opendorf.mode') === 'sandbox')) {
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
  if (!store.get('opendorf.seenHelp')) $('help').hidden = false;
  view.start();
  window.__opendorf = { get state() { return state; }, view, R, placeAt, rotate, chooseTile, enterSandbox, leaveSandbox, tap };
}

boot().catch((err) => {
  console.error(err);
  window.WavedashHook?.ready(); // show the error, not Wavedash's loading screen
  $('loading').innerHTML = `<div class="title">OpenDorf</div><p>Could not load the realm: ${String(err.message || err)}</p>`;
});
