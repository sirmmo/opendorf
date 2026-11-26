// The 3D board: loads the KayKit models, keeps one group per placed tile in step with the
// game state, draws the ghost tile and the spots where it fits, and turns screen points into
// hex cells.

import * as THREE from 'three';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import { BASES, BUILDINGS } from './tiles.js';
import { edgeAt, groups, key, neighbours, tileAt } from './rules.js';

const SQ3 = Math.sqrt(3);
const TAU = Math.PI * 2;
const STEP = Math.PI / 3;
// Fields: the KayKit field stops short of the tile edge with a ragged rim. A flat bed in the
// same straw colour sits under it and runs to the edge wherever the neighbour is a field too,
// so neighbouring fields read as one; elsewhere it tucks in under the model's own rim.
const BED_HEIGHT = 0.2;
const BED_INSET = 0.1;
const bedGeos = new Map();
function fieldBed(mask) {
  if (bedGeos.has(mask)) return bedGeos.get(mask);
  const inset = (k) => (mask & (1 << k) ? 0 : BED_INSET);
  const corner = (c) => {
    const a = c * STEP;
    const b = (c + 1) * STEP;
    const r1 = 1 - inset(c);
    const r2 = 1 - inset((c + 1) % 6);
    const det = Math.sin(b - a);
    return [(r1 * Math.sin(b) - r2 * Math.sin(a)) / det, (r2 * Math.cos(a) - r1 * Math.cos(b)) / det];
  };
  const pts = [0, 1, 2, 3, 4, 5].map(corner);
  const top = [];
  const side = [];
  for (let c = 0; c < 6; c++) {
    const [x1, z1] = pts[(c + 5) % 6];
    const [x2, z2] = pts[c];
    top.push(0, BED_HEIGHT, 0, x2, BED_HEIGHT, z2, x1, BED_HEIGHT, z1);
    side.push(x1, BED_HEIGHT, z1, x2, BED_HEIGHT, z2, x2, 0.01, z2, x1, BED_HEIGHT, z1, x2, 0.01, z2, x1, 0.01, z1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...top, ...side], 3));
  geo.addGroup(0, top.length / 3, 0);
  geo.addGroup(top.length / 3, side.length / 3, 1);
  geo.computeVertexNormals();
  bedGeos.set(mask, geo);
  return geo;
}
const bedMats = [
  new THREE.MeshStandardMaterial({ color: 0xe6b555, roughness: 0.9, side: THREE.DoubleSide }),
  new THREE.MeshStandardMaterial({ color: 0xb9823c, roughness: 0.9, side: THREE.DoubleSide }),
];

export function hexToWorld(q, r) {
  return new THREE.Vector3(2 * q + r, 0, SQ3 * r);
}

export function worldToHex(x, z) {
  const rf = z / SQ3;
  const qf = (x - rf) / 2;
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf);
  const dr = Math.abs(r - rf);
  const ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

// Facing edge k (angle 60k from +x towards +z) for a model whose front is +z.
const faceEdge = (k) => Math.PI / 2 - k * STEP;

function prng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const MODELS = [
  ...new Set([
    ...Object.values(BASES).map((b) => b.model),
    ...Object.values(BUILDINGS).map((b) => b.model).filter(Boolean),
    'building_grain', 'building_stage_A', 'building_stage_B', 'building_stage_C', 'building_scaffolding',
    'building_home_A_blue', 'building_home_B_blue',
    'trees_A_small', 'trees_A_medium', 'trees_A_large', 'trees_B_small', 'trees_B_medium', 'trees_B_large',
    'mountain_A_grass', 'mountain_B_grass', 'mountain_C_grass', 'mountain_A_grass_trees', 'mountain_C_grass_trees',
    'hill_single_A', 'hill_single_B', 'hill_single_C', 'rock_single_A', 'rock_single_C', 'rock_single_E',
    'tree_single_A', 'tree_single_B', 'waterlily_A', 'waterlily_B', 'waterplant_A', 'waterplant_B',
    'cloud_big', 'cloud_small', 'barrel', 'crate_A_big', 'crate_B_small', 'sack',
    'flag_blue', 'wheelbarrow', 'tent',
    'Gold_Bars_Stack_Large',
    'hills_A', 'hills_B', 'hills_C', 'hills_A_trees', 'hills_B_trees', 'hills_C_trees',
    'building_bridge_A', 'building_bridge_B', 'resource_stone', 'rock_single_B', 'rock_single_D', 'bucket_water',
  ]),
];

// What piles up beside a building, from the KayKit Resource Bits pack: a small, medium or large
// stack as the land that feeds it (or the village it serves) grows. `from` is the group that sets
// the size: for a workshop the biggest group of its land next to it, for a town building its
// village. `at` are the group sizes where the pile turns medium and large.
const PILES = {
  lumbermill: { from: 'forest', at: [6, 12], m: ['Wood_Planks_Stack_Small', 'Wood_Planks_Stack_Medium', 'Wood_Planks_Stack_Large'] },
  mine: { from: 'mountain', at: [2, 4], m: ['Stone_Chunks_Small', 'Stone_Bricks_Stack_Medium', 'Stone_Bricks_Stack_Large'] },
  blacksmith: { from: 'village', at: [8, 12], m: ['Iron_Bars_Stack_Small', 'Iron_Bars_Stack_Medium', 'Iron_Bars_Stack_Large'] },
  market: { from: 'village', at: [9, 12], m: ['Textiles_Stack_Small', 'Textiles_Stack_Large', 'Textiles_Stack_Large_Colored'] },
};
const PILE_SCALE = 0.24; // Resource Bits stacks are about 1.6 across; a house is about 0.8.
for (const p of Object.values(PILES)) MODELS.push(...p.m);

// ---------- Kenney kits ----------

// Marsh plants, camps and caves from Kenney's Nature Kit (GLB, one unit to a tile edge, so about
// KayKit's own scale), and the churchyard from Kenney's Graveyard Kit (GLB with the kit's own
// Textures/colormap.png, so each kit keeps its own folder).
const NATURE = [
  'lily_large', 'lily_small', 'mushroom_redGroup', 'mushroom_tanGroup', 'plant_bush', 'plant_bushSmall',
  'grass_large', 'tent_detailedOpen', 'tent_smallClosed', 'campfire_logs', 'cliff_cave_rock', 'cliff_cave_stone',
];
const GRAVEYARD = ['fence', 'gravestone-cross', 'gravestone-round', 'gravestone-bevel', 'lantern-candle'];
MODELS.push(...NATURE.map((n) => 'nature/' + n), ...GRAVEYARD.map((n) => 'graveyard/' + n));

// The Nature Kit colours its models by named materials in a bright palette of its own. Give
// them KayKit's colours instead (taken from hexagons_medieval.png): its tree greens, a reed green
// a little darker than the grass, its wood, stone and reds.
const NATURE_COLOURS = {
  leafsGreen: 0x14a566, leafsDark: 0x0b7d5c, grass: 0x6f9a35, wood: 0xa0603f, woodDark: 0x74402e,
  stone: 0xa3adb1, dirt: 0x7a736a, colorRed: 0xd65050, colorRedDark: 0xa83c3c, colorTan: 0xe2b27f, _defaultMat: 0xf1e9d8,
};
function restyleNature(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const fix = (m) => {
      const out = m.clone();
      const c = NATURE_COLOURS[m.name];
      if (c !== undefined) out.color = new THREE.Color(c);
      out.roughness = 0.9;
      out.metalness = 0;
      return out;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
  });
}

// ---------- ruins ----------

// Pieces of the Quaternius Ultimate Modular Ruins Pack (GLB, in metres). KayKit props are about
// 0.2 to the metre (a barrel is 0.21 tall), so the ruins are scaled the same way: a 3.5 m arch
// stands 0.7 tall, a little lower than a house.
const RUIN = 0.2;
const RUIN_PIECES = [
  'Arch_Round', 'Wall_ArchRound', 'Wall_ArchRound_Overgrown_Broken', 'Wall_Broken', 'Wall_Double_Broken', 'Wall',
  'Window_Open', 'Column_Round', 'Column_Round_Short', 'Statue_Fox', 'Statue_Stag',
  'Floor_Squares', 'Floor_Diamond', 'Stairs', 'Bookcase_Full', 'Doors_RoundArch',
  'Pot1', 'Pot1_Broken', 'Pot2_Broken', 'Pot3_Broken', 'Bricks', 'Skull', 'Candles_1', 'Cart', 'Torch',
];
MODELS.push(...RUIN_PIECES.map((n) => 'ruins/' + n));

// The pack's stone is a dark olive grey; KayKit's is light and slightly warm. Recolour the stone
// materials (by name) so the ruins sit in the same palette, and lift the wood a little.
const RUIN_COLOURS = { Main: 0xa8a28f, Highlights: 0xccc5af, Black: 0x655f51, Stone: 0xb7b09c };
function restyleRuin(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const fix = (m) => {
      const c = RUIN_COLOURS[m.name];
      const out = m.clone();
      if (c) out.color = new THREE.Color(c);
      else if (/wood/i.test(m.name)) out.color = m.color.clone().multiplyScalar(1.6);
      return out;
    };
    o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
  });
}

// Shapes the ruins pack does not have: a gable roof in KayKit blue with stone gable ends, a
// dome, a stone block, and a patch of dug earth. Each is centred on x/z with its base at y 0.
const MAT = {
  stone: new THREE.MeshStandardMaterial({ color: RUIN_COLOURS.Highlights, roughness: 0.9, flatShading: true }),
  roof: new THREE.MeshStandardMaterial({ color: 0x2a8bd2, roughness: 0.8, flatShading: true }),
  earth: new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 1, flatShading: true }),
  // Marsh water: KayKit's river blue, dulled towards the green of standing water, on a rim of mud.
  pool: new THREE.MeshStandardMaterial({ color: 0x3f9bb0, roughness: 0.35, flatShading: true }),
  mud: new THREE.MeshStandardMaterial({ color: 0x8a7d45, roughness: 1, flatShading: true }),
  bog: new THREE.MeshStandardMaterial({ color: 0x9ba83a, roughness: 1, flatShading: true }),
  wood: new THREE.MeshStandardMaterial({ color: 0x9a5a3e, roughness: 0.9, flatShading: true }),
  darkWood: new THREE.MeshStandardMaterial({ color: 0x6a3a2a, roughness: 0.9, flatShading: true }),
  witchRoof: new THREE.MeshStandardMaterial({ color: 0x6b4f8f, roughness: 0.85, flatShading: true }),
  iron: new THREE.MeshStandardMaterial({ color: 0x33363d, roughness: 0.6, flatShading: true }),
  brew: new THREE.MeshStandardMaterial({ color: 0x8fdc5a, emissive: 0x3f8a1e, roughness: 0.4, flatShading: true }),
  glow: new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xc98a1e, roughness: 0.6, flatShading: true }),
  fire: new THREE.MeshStandardMaterial({ color: 0xffa13a, emissive: 0xe0601a, roughness: 0.6, flatShading: true }),
  // The dark inside of a cave mouth.
  dark: new THREE.MeshBasicMaterial({ color: 0x15171c }),
  cut: new THREE.MeshStandardMaterial({ color: 0xbcc3c5, roughness: 0.95, flatShading: true }),
};
function gableRoof(w, d, h) {
  const g = new THREE.Group();
  const slope = Math.hypot(d / 2, h);
  const tilt = Math.atan2(h, d / 2);
  for (const side of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, 0.04, slope + 0.05), MAT.roof);
    m.position.set(0, h / 2, (side * d) / 4);
    m.rotation.x = side * tilt;
    g.add(m);
  }
  const tri = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, h)]);
  const ends = new THREE.ExtrudeGeometry(tri, { depth: w, bevelEnabled: false }).translate(0, 0, -w / 2).rotateY(Math.PI / 2);
  g.add(new THREE.Mesh(ends, MAT.stone));
  return g;
}
function dome(r, drum) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, drum, 16), MAT.stone);
  base.position.y = drum / 2;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 8, 0, TAU, 0, Math.PI / 2), MAT.roof);
  cap.position.y = drum;
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.03, r * 0.5, 6), MAT.stone);
  tip.position.y = drum + r + r * 0.2;
  g.add(base, cap, tip);
  return g;
}
const box = (w, h, d, mat) => {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.y = h / 2;
  g.add(m);
  return g;
};
// A puddle of marsh water on a rim of mud, w by d, just above the grass.
function pool(w, d) {
  const g = new THREE.Group();
  const mud = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.02, 9), MAT.mud);
  mud.scale.set(w / 2 + 0.05, 1, d / 2 + 0.05);
  mud.position.y = 0.01;
  const water = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.02, 9), MAT.pool);
  water.scale.set(w / 2, 1, d / 2);
  water.position.y = 0.016;
  water.receiveShadow = true;
  g.add(mud, water);
  return g;
}
// Wet ground: a darker, greener hexagon just inside the tile, under the pools.
function bog() {
  // Six segments put the corners at +-z, as on the tiles: flats 0.95 out, a rim of grass beyond.
  const m = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.008, 6), MAT.bog);
  m.position.y = 0.004;
  m.receiveShadow = true;
  const g = new THREE.Group();
  g.add(m);
  return g;
}
// The witch's hut: a round wooden hut on stilts under a tall, leaning purple roof, with a
// lit window and a door facing +z.
function witchHut() {
  const g = new THREE.Group();
  for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.16, 6), MAT.darkWood);
    post.position.set(x, 0.08, z);
    g.add(post);
  }
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.035, 8), MAT.wood);
  deck.position.y = 0.17;
  const walls = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.27, 8), MAT.wood);
  walls.position.y = 0.32;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.44, 8), MAT.witchRoof);
  roof.position.set(0.02, 0.67, -0.01);
  roof.rotation.set(-0.1, 0, 0.14);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.15, 0.03), MAT.darkWood);
  door.position.set(0, 0.265, 0.19);
  const win = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.03), MAT.glow);
  win.position.set(0.12, 0.36, 0.15);
  win.rotation.y = 0.6;
  const step = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.14), MAT.wood);
  step.position.set(0, 0.09, 0.33);
  step.rotation.x = 0.5;
  g.add(deck, walls, roof, door, win, step);
  return g;
}
// A cauldron on the boil.
function cauldron() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, TAU, Math.PI / 2.6, Math.PI - Math.PI / 2.6), MAT.iron);
  pot.position.y = 0.075;
  const brew = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.01, 10), MAT.brew);
  brew.position.y = 0.105;
  g.add(pot, brew);
  for (const a of [0, 2.1, 4.2]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.05, 0.015), MAT.iron);
    leg.position.set(Math.cos(a) * 0.045, 0.02, Math.sin(a) * 0.045);
    g.add(leg);
  }
  return g;
}
// The quarry's cut: pale stone stepped down in three benches, the back one tallest.
function quarryCut() {
  const g = new THREE.Group();
  [[0.62, 0.34, -0.06], [0.5, 0.22, 0.1], [0.36, 0.1, 0.24]].forEach(([w, h, z], i) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2 - i * 0.02), MAT.cut);
    m.position.set(0, h / 2, z - 0.1);
    g.add(m);
  });
  return g;
}
// The dark inside of a cave, a half-disc standing upright facing +z.
function caveDark(r) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 12, 0, Math.PI), MAT.dark);
  const g = new THREE.Group();
  g.add(m);
  return g;
}
const SHAPES = {
  bog,
  pool_a: () => pool(0.5, 0.34),
  pool_b: () => pool(0.36, 0.28),
  pool_c: () => pool(0.26, 0.2),
  witch_hut: witchHut,
  cauldron,
  quarry_cut: quarryCut,
  cave_dark: () => caveDark(0.2),
  flame: () => {
    const g = new THREE.Group();
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.13, 6), MAT.fire);
    f.position.y = 0.09;
    g.add(f);
    return g;
  },
  bed: () => box(0.34, 0.05, 0.16, MAT.earth),
  roof_society: () => gableRoof(0.78, 0.74, 0.24),
  roof_academy: () => gableRoof(1.06, 0.78, 0.22),
  dome_academy: () => dome(0.19, 0.16),
  slab_society: () => box(0.86, 0.05, 0.8, MAT.stone),
  slab_academy: () => box(1.12, 0.05, 0.86, MAT.stone),
  plinth_society: () => box(0.84, 0.07, 0.78, MAT.stone),
  plinth_academy: () => box(1.12, 0.07, 0.86, MAT.stone),
  pit: () => box(0.46, 0.012, 0.36, MAT.earth),
};

// A ruin piece at (x, z) in some local frame, turned by ry, at RUIN scale times `k`.
const ruin = (name, x, z, ry = 0, more = {}) => ({ m: 'ruins/' + name, x, z, ry, s: RUIN * (more.k || 1), ...more });
// A column lying on its side: its axis turned from y onto -x, then the whole turned by ry.
const fallen = (name, x, z, ry, radius) => ruin(name, x, z, ry, { rz: Math.PI / 2, y: radius * RUIN });

// The small ruins in the middle of a ruins tile, one of a few layouts.
const RUIN_LAYOUTS = [
  // A broken arch over a stretch of floor, a column stump, a fallen drum, bricks and a pot.
  () => [
    ruin('Floor_Squares', -0.2, -0.1), ruin('Floor_Squares', 0.2, -0.1, Math.PI / 2),
    ruin('Arch_Round', 0, -0.1),
    ruin('Column_Round_Short', 0.44, 0.2),
    fallen('Column_Round_Short', -0.05, 0.3, 0.35, 0.24),
    ruin('Bricks', 0.42, -0.42, 1.1), ruin('Pot1_Broken', -0.46, -0.32, 0.4),
  ],
  // A colonnade: two columns still standing, one stump, one fallen across the floor.
  () => [
    ruin('Floor_Squares', -0.4, -0.12), ruin('Floor_Squares', 0, -0.12, Math.PI / 2), ruin('Floor_Squares', 0.4, -0.12),
    ruin('Column_Round', -0.4, -0.2), ruin('Column_Round_Short', 0, -0.2), ruin('Column_Round', 0.4, -0.2),
    fallen('Column_Round', 0.42, 0.3, -0.12, 0.33),
    ruin('Skull', -0.3, 0.32, 0.6), ruin('Pot2_Broken', -0.5, 0.18), ruin('Bricks', 0.15, -0.5, 2.2),
  ],
  // The corner of a hall: an overgrown broken arched wall, a side wall, a low wall and pots.
  () => [
    ruin('Floor_Diamond', -0.05, 0.12), ruin('Floor_Squares', 0.3, 0.05),
    ruin('Wall_ArchRound_Overgrown_Broken', 0, -0.2),
    ruin('Wall_Broken', 0.44, 0.02, Math.PI / 2),
    ruin('Wall_Double_Broken', -0.34, 0.36, 0.5),
    ruin('Pot1', -0.12, 0.34, 1), ruin('Pot3_Broken', 0.18, 0.38), ruin('Bricks', 0.5, 0.46, 0.4),
  ],
  // A fox on its plinth between a column and a stump, candles still at its feet.
  () => [
    ruin('Floor_Squares', 0, 0.1), ruin('Floor_Squares', -0.4, 0.1), ruin('Floor_Diamond', 0.4, 0.1),
    ruin('Statue_Fox', 0, -0.12, 0, { k: 0.85 }),
    ruin('Column_Round', 0.42, -0.2), ruin('Column_Round_Short', -0.42, -0.18),
    ruin('Candles_1', 0.16, 0.18, 0.3), ruin('Pot1_Broken', -0.4, 0.32, 2), ruin('Bricks', 0.46, 0.36, 0.7),
  ],
];

// Turn a list of placements by `a` about the tile centre (positions and facings alike).
function turned(list, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return list.map((d) => ({ ...d, x: d.x * c + d.z * s, z: -d.x * s + d.z * c, ry: (d.ry || 0) + a }));
}

// The buildings the ruins draw, laid out facing +z (turned to face their neighbour later).
const COMPOSED = {
  // A dig site: a pit of turned earth with a mosaic coming to light, a tent, a cart, tools.
  digsite: () => [
    { m: 'pit', x: 0.02, z: 0.22 },
    ruin('Floor_Diamond', -0.05, 0.22, 0.2, { y: 0.012, k: 0.8 }),
    ruin('Column_Round_Short', 0.17, 0.3, 0, { k: 0.8 }),
    ruin('Pot1', -0.16, 0.34, 0.5, { k: 0.8 }),
    { m: 'tent', x: -0.36, z: -0.3, ry: 0.5 },
    ruin('Cart', 0.42, -0.26, -0.5, { k: 0.75 }),
    { m: 'wheelbarrow', x: -0.46, z: 0.25, ry: 2.4 },
    { m: 'crate_A_big', x: 0.02, z: -0.44, ry: 0.3 },
    { m: 'sack', x: 0.15, z: -0.5, ry: 1 },
    ruin('Bricks', 0.44, 0.3, 0.6, { k: 0.7 }),
    ruin('Torch', 0.29, 0.06, 0, { y: 0.054 }),
  ],
  // The Archaeological Society: a small restored hall with an arched door, a portico of four
  // columns and a blue roof, the society's fox before it.
  society: () => {
    const y = 0.07; // top of the plinth
    const out = [
      { m: 'plinth_society', x: 0, z: -0.02 },
      ruin('Wall', 0, -0.34, 0, { y, s: [0.4, 0.27, 0.2] }),
      ruin('Window_Open', -0.38, -0.12, -Math.PI / 2, { y, s: [0.22, 0.27, 0.2] }),
      ruin('Window_Open', 0.38, -0.12, Math.PI / 2, { y, s: [0.22, 0.27, 0.2] }),
      ruin('Wall_ArchRound', 0, 0.1, 0, { y, s: [0.2, 0.135, 0.2] }),
      ruin('Doors_RoundArch', 0, 0.09, 0, { y, k: 0.7 }),
      { m: 'slab_society', x: 0, z: -0.02, y: y + 0.54 },
      { m: 'roof_society', x: 0, z: -0.02, y: y + 0.59, ry: Math.PI / 2 },
      ruin('Statue_Fox', 0.42, 0.5, -0.5, { k: 0.5 }),
      ruin('Pot1', -0.44, 0.46, 0, { k: 0.8 }),
    ];
    for (const x of [-0.33, -0.11, 0.11, 0.33]) out.push(ruin('Column_Round', x, 0.32, 0, { y, s: [0.17, 0.135, 0.17] }));
    return out;
  },
  // A quarry: benches of pale stone cut back into the hills it faces, blocks stacked to go,
  // a barrow and a stone heap.
  // and the quarrymen's hut.
  quarry: () => [
    { m: 'quarry_cut', x: 0.05, z: 0.34, ry: Math.PI },
    { m: 'rock_single_E', x: -0.4, z: 0.5, ry: 0.4, s: 1.2 },
    { m: 'rock_single_D', x: 0.5, z: 0.48, ry: 1.2 },
    { m: 'building_home_B_blue', x: -0.4, z: -0.3, ry: 0.2, s: 0.75 },
    { m: 'Stone_Bricks_Stack_Large', x: 0.4, z: -0.28, ry: -0.3, s: PILE_SCALE },
    { m: 'resource_stone', x: 0.08, z: -0.06, ry: 0.2 },
    { m: 'wheelbarrow', x: 0.1, z: -0.52, ry: 2.6 },
  ],
  // An herb garden: a cottage, beds of herbs and toadstools, a water bucket and a sack.
  herbgarden: () => {
    const out = [
      { m: 'building_home_A_blue', x: -0.34, z: -0.28, ry: 0 },
      { m: 'bucket_water', x: -0.06, z: -0.02, ry: 0 },
      { m: 'sack', x: -0.58, z: 0.08, ry: 0.7 },
    ];
    [[0.28, -0.32], [0.3, -0.04], [0.32, 0.24], [-0.22, 0.3]].forEach(([x, z], i) => {
      out.push({ m: 'bed', x, z, ry: 0 });
      if (i === 3) out.push(nat('mushroom_tanGroup', x, z, 0.4, 0.45, { y: 0.05 }));
      else for (const dx of [-0.09, 0.09]) out.push(nat(i === 1 ? 'grass_large' : 'plant_bushSmall', x + dx, z, dx * 9, 0.42, { y: 0.05 }));
    });
    return out;
  },
  // The witch's hut, on the marsh itself, a cauldron and a lantern by the door.
  witchhut: (R) => [
    ...marshBits(R, true),
    { m: 'witch_hut', x: 0, z: -0.12, ry: 0 },
    { m: 'cauldron', x: -0.3, z: 0.34, ry: 0 },
    grave('lantern-candle', 0.2, 0.36, 0.3, 0.5),
    nat('mushroom_redGroup', -0.5, 0.12, 1, 0.45),
  ],
  // A churchyard: a fenced plot of gravestones with a gate towards the church and a lantern by it.
  churchyard: () => {
    const K = 1.2; // the plot, a little over half the tile across
    const f = (x, z, ry, len) => grave('fence', x * K, z * K, ry, 1, { s: [len * K, 0.45, 0.5] });
    const g = (name, x, z, s) => grave(name, x * K, z * K, 0, s);
    return [
      f(-0.24, -0.46, 0, 0.48), f(0.24, -0.46, 0, 0.48),
      f(-0.5, -0.22, Math.PI / 2, 0.48), f(-0.5, 0.22, Math.PI / 2, 0.48),
      f(0.5, -0.22, Math.PI / 2, 0.48), f(0.5, 0.22, Math.PI / 2, 0.48),
      f(-0.35, 0.46, 0, 0.3), f(0.35, 0.46, 0, 0.3),
      g('gravestone-cross', -0.26, -0.22, 0.38), g('gravestone-round', 0, -0.24, 0.4),
      g('gravestone-bevel', 0.26, -0.22, 0.4), g('gravestone-round', -0.24, 0.1, 0.36),
      g('gravestone-cross', 0.25, 0.12, 0.34),
      grave('lantern-candle', 0.2, 0.7, 0, 0.6),
      { m: 'tree_single_B', x: -0.66, z: -0.66, ry: 1, s: 0.75 },
    ];
  },
  // The Academy: a temple of learning on a stepped plinth, six columns before shelves of books,
  // a blue roof crowned by a dome, and the stag of the old realm beside the steps.
  academy: () => {
    const y = 0.07;
    const out = [
      { m: 'plinth_academy', x: 0, z: -0.05 },
      ruin('Stairs', 0, 0.42, 0, { s: [0.15, 0.078, 0.06] }),
      ruin('Wall', -0.27, -0.44, 0, { y, s: [0.27, 0.3, 0.2] }), ruin('Wall', 0.27, -0.44, 0, { y, s: [0.27, 0.3, 0.2] }),
      ruin('Window_Open', -0.52, -0.2, -Math.PI / 2, { y, s: [0.24, 0.3, 0.2] }),
      ruin('Window_Open', 0.52, -0.2, Math.PI / 2, { y, s: [0.24, 0.3, 0.2] }),
      ruin('Bookcase_Full', -0.25, -0.36, 0, { y, k: 0.9 }), ruin('Bookcase_Full', 0.25, -0.36, 0, { y, k: 0.9 }),
      ruin('Candles_1', 0, -0.2, 0, { y, k: 0.6 }),
      { m: 'slab_academy', x: 0, z: -0.05, y: y + 0.6 },
      { m: 'roof_academy', x: 0, z: -0.05, y: y + 0.65 },
      { m: 'dome_academy', x: 0, z: -0.05, y: y + 0.72 },
      ruin('Statue_Stag', -0.48, 0.52, 0.5, { k: 0.5 }),
    ];
    for (const x of [-0.45, -0.27, -0.09, 0.09, 0.27, 0.45]) out.push(ruin('Column_Round', x, 0.26, 0, { y, s: [0.15, 0.15, 0.15] }));
    return out;
  },
};

// ---------- the new lands ----------

const nat = (name, x, z, ry = 0, s = 1, more = {}) => ({ m: 'nature/' + name, x, z, ry, s, ...more });
const grave = (name, x, z, ry = 0, s = 1, more = {}) => ({ m: 'graveyard/' + name, x, z, ry, s, ...more });

// Marsh: pools of standing water with lily pads, reeds at their rims, bushes and toadstools on
// the wet ground between. `R` gives each tile its own; `light` leaves the middle free for a hut.
function marshBits(R, light = false) {
  // The wet ground is a hexagon, so it may only turn by sixths: the hut's marsh brings its own.
  const out = light ? [] : [{ m: 'bog', x: 0, z: 0 }];
  const pools = light
    ? [['pool_b', 0.46, 0.28], ['pool_c', -0.5, -0.36]]
    : [['pool_a', -0.18, -0.12], ['pool_b', 0.36, 0.3], ['pool_c', -0.3, 0.48], ['pool_c', 0.42, -0.4]];
  for (const [m, x, z] of pools) {
    const ry = R() * 0.8;
    out.push({ m, x, z, ry });
    const big = m === 'pool_a';
    out.push(nat(R() < 0.6 || big ? 'lily_large' : 'lily_small', x + (R() - 0.5) * 0.12, z + (R() - 0.5) * 0.08, R() * TAU, big ? 0.9 : 0.7, { y: 0.02 }));
    if (big) out.push(nat('lily_small', x + 0.14, z - 0.05, R() * TAU, 0.9, { y: 0.02 }));
    // Reeds at the rim of each pool.
    const a = R() * TAU;
    out.push(nat('grass_large', x + Math.cos(a) * (big ? 0.27 : 0.18), z + Math.sin(a) * (big ? 0.19 : 0.14), R() * TAU, 0.8 + R() * 0.3));
  }
  // Bushes and toadstools out towards the rim.
  const rim = ['plant_bush', 'plant_bushSmall', 'grass_large', 'mushroom_redGroup', 'mushroom_tanGroup', 'plant_bushSmall'];
  for (let i = light ? 3 : 4; i > 0; i--) {
    const a = R() * TAU;
    const d = 0.66 + R() * 0.14;
    const m = rim[Math.floor(R() * rim.length)];
    out.push(nat(m, Math.cos(a) * d, Math.sin(a) * d, R() * TAU, m.startsWith('mushroom') ? 0.5 : 0.75 + R() * 0.25));
  }
  return out;
}

// Hills: one of KayKit's hill clusters, now and then wooded.
const HILLS = ['hills_A', 'hills_B', 'hills_C', 'hills_A', 'hills_B', 'hills_C', 'hills_A_trees', 'hills_B_trees', 'hills_C_trees'];

// A bandit camp in the heart of a forest: two tents round a fire, a crate and a barrel, with
// the trees pushed back to the rim of the tile.
function banditCamp(R) {
  const out = [
    nat('tent_detailedOpen', -0.12, -0.3, 0.2, 0.75),
    nat('tent_smallClosed', 0.38, 0.0, -1.2, 0.75),
    nat('campfire_logs', -0.05, 0.18, R() * TAU, 1),
    { m: 'flame', x: -0.05, z: 0.18 },
    { m: 'crate_A_big', x: -0.42, z: 0.14, ry: 0.4 },
    { m: 'barrel', x: 0.22, z: 0.4, ry: 0 },
  ];
  for (const a of [2.2, 3.4, 4.5, 5.6, 0.4, 1.3]) {
    const d = 0.78 + R() * 0.08;
    out.push({ m: R() < 0.5 ? 'tree_single_A' : 'tree_single_B', x: Math.cos(a) * d, z: Math.sin(a) * d, ry: R() * TAU, s: 0.8 + R() * 0.2 });
  }
  return out;
}

// A cave mouth on the flank of a mountain, facing local edge j: the arch (a dark hollow inside
// it) and what lies before it. The mountain above it is drawn smaller and pushed back (see
// decorate), so its cliff stands about 0.43 out and the arch sits against it.
function caveMouth(j, kind, R) {
  const a = j * STEP;
  const ry = faceEdge(j);
  const at = (d, side = 0) => ({ x: Math.cos(a) * d - Math.sin(a) * side, z: Math.sin(a) * d + Math.cos(a) * side });
  const arch = at(0.26);
  const out = [
    { m: 'cave_dark', ...at(0.47), y: 0.0, ry },
    nat(kind === 'wolves' ? 'cliff_cave_rock' : 'cliff_cave_stone', arch.x, arch.z, ry, 0.55),
  ];
  if (kind === 'wolves') {
    // Bones before the den, and a rock or two.
    out.push(ruin('Skull', at(0.78, 0.08).x, at(0.78, 0.08).z, ry + 0.6, { k: 1.4 }));
    out.push({ m: 'rock_single_B', ...at(0.8, -0.24), ry: R() * TAU });
    out.push({ m: 'rock_single_D', ...at(0.88, 0.3), ry: R() * TAU, s: 0.8 });
  } else {
    // The way down to the dungeon: a torch either side of the arch.
    for (const side of [-0.23, 0.23]) {
      const p = at(0.8, side);
      out.push(ruin('Torch', p.x, p.z, ry, { y: 0.054 }));
    }
    for (const side of [-0.32, 0.32]) {
      const p = at(0.6, side);
      out.push({ m: 'rock_single_B', ...p, ry: R() * TAU, s: 0.8 });
    }
  }
  return out;
}
// Pile size (0, 1, 2) for a building tile, from the groups around it.
function pileTier(state, tile, sizes) {
  const p = PILES[tile.building];
  if (!p) return null;
  let n = 0;
  if (p.from === 'village') {
    n = sizes.village.get(key(tile.q, tile.r)) || 0;
  } else {
    for (const c of neighbours(tile.q, tile.r)) n = Math.max(n, sizes[p.from].get(key(c.q, c.r)) || 0);
  }
  return n >= p.at[1] ? 2 : n >= p.at[0] ? 1 : 0;
}

// ---------- what stands on a tile ----------

// Which neighbour a building should face: a road if it has one, else what feeds it.
function facing(state, tile) {
  const source = {
    lumbermill: (o) => o.feature === 'forest',
    windmill: (o) => o.feature === 'field',
    mine: (o) => o.feature === 'mountain',
    watermill: (o) => BASES[o.base].edges.includes('W'),
    watchtower: (o) => BASES[o.base].edges.includes('S'),
    digsite: (o) => o.feature === 'ruins',
    quarry: (o) => o.feature === 'hills',
    herbgarden: (o) => o.feature === 'marsh',
    witchhut: (o) => o.feature !== 'marsh',
    churchyard: (o) => o.building === 'church' || o.feature === 'village',
  }[tile.building];
  let road = null;
  let src = null;
  for (const n of neighbours(tile.q, tile.r)) {
    const o = tileAt(state, n.q, n.r);
    if (!o) continue;
    if (road === null && edgeAt(o, (n.k + 3) % 6) === 'R') road = n.k;
    if (src === null && source && source(o)) src = n.k;
  }
  return src ?? road ?? (tile.v % 6);
}

// Which world edge a cave mouth looks out of: out over open land if it can (laid land first,
// so it settles early, then empty ground), else a village, and into the mountain only if the
// tile is walled in; for the same neighbours, always the same.
function mouthOf(state, tile) {
  let best = tile.v % 6;
  let bestRank = 9;
  for (let i = 0; i < 6; i++) {
    const k = (tile.v + i) % 6;
    const n = neighbours(tile.q, tile.r)[k];
    const o = tileAt(state, n.q, n.r);
    const rank = !o ? 1 : o.feature === 'mountain' ? 3 : o.feature === 'village' ? 2 : 0;
    if (rank < bestRank) {
      best = k;
      bestRank = rank;
    }
  }
  return best;
}

// A list of {m, x, z, ry, s} placements on top of the tile, in tile space (unrotated).
function decorate(tile, info) {
  const R = prng(tile.v * 7919 + 13);
  const out = [];
  const rot60 = () => Math.floor(R() * 6) * STEP;
  const scatter = (models, n, radius) => {
    for (let i = 0; i < n; i++) {
      const a = R() * TAU;
      const d = Math.sqrt(R()) * radius;
      out.push({ m: models[Math.floor(R() * models.length)], x: Math.cos(a) * d, z: Math.sin(a) * d, ry: R() * TAU });
    }
  };

  if (tile.building) {
    const b = tile.building;
    // The whole tile group is turned by -rot; undo that so the building faces its neighbour.
    const ry = faceEdge(info.facing ?? 0) + tile.rot * STEP;
    const along = (d, side) => {
      const a = -ry + Math.PI / 2;
      return { x: Math.cos(a) * d + Math.cos(a + Math.PI / 2) * side, z: Math.sin(a) * d + Math.sin(a + Math.PI / 2) * side };
    };
    if (COMPOSED[b]) {
      if (b === 'witchhut') out.push({ m: 'bog', x: 0, z: 0 });
      out.push(...turned(COMPOSED[b](R), ry));
      return out;
    }
    if (b === 'watermill' || b === 'watchtower') {
      const p = along(0.25, 0);
      out.push({ m: BUILDINGS[b].model, x: p.x, z: p.z, ry });
    } else {
      out.push({ m: BUILDINGS[b].model, x: 0, z: 0, ry });
    }
    const p = along(0.62, 0.45);
    if (PILES[b]) {
      out.push({ m: PILES[b].m[info.pile ?? 0], x: p.x, z: p.z, ry: ry + 0.4, s: PILE_SCALE });
    } else if (b === 'castle') {
      out.push({ m: 'Gold_Bars_Stack_Large', x: p.x, z: p.z, ry: ry + 0.4, s: PILE_SCALE });
    } else {
      const extra = { tavern: 'barrel', windmill: 'sack' }[b];
      if (extra) out.push({ m: extra, x: p.x, z: p.z, ry: ry + 0.4 });
    }
    return out;
  }

  // A camp in the wild, or the way into a dungeon. Marked `camp` so the view can see it off.
  if (tile.camp === 'bandits') {
    out.push(...turned(banditCamp(R), rot60()).map((d) => ({ ...d, camp: true })));
    return out;
  }
  if (tile.feature === 'mountain' && (tile.camp || tile.dungeon)) {
    // Local edge of the open side the mouth looks out of. The mountain stands back from it,
    // a little smaller, to leave room for the way in (or two ways, back to back).
    const j = (((info.mouth ?? 0) - tile.rot) % 6 + 6) % 6;
    const both = tile.camp && tile.dungeon;
    const back = both ? 0 : 0.2;
    out.push({ m: 'mountain_B_grass', x: -Math.cos(j * STEP) * back, z: -Math.sin(j * STEP) * back, ry: 0, s: both ? 0.6 : 0.72 });
    if (tile.dungeon) out.push(...caveMouth(j, 'dungeon', R));
    if (tile.camp) out.push(...caveMouth((j + (tile.dungeon ? 3 : 0)) % 6, 'wolves', R).map((d) => ({ ...d, camp: true })));
    return out;
  }

  switch (tile.feature) {
    case 'forest': {
      const size = info.forest || 1;
      const cls = size >= 5 ? 'large' : size >= 2 ? 'medium' : 'small';
      out.push({ m: `trees_${R() < 0.5 ? 'A' : 'B'}_${cls}`, x: 0, z: 0, ry: rot60() });
      break;
    }
    case 'field':
      out.push({ m: 'building_grain', x: 0, z: 0, ry: rot60() });
      if (R() < 0.35) out.push({ m: R() < 0.5 ? 'sack' : 'wheelbarrow', x: 0.55, z: -0.5, ry: R() * TAU });
      break;
    case 'village': {
      const turn = rot60();
      const homes = [
        { m: 'building_home_A_blue', x: -0.42, z: -0.22 },
        { m: R() < 0.5 ? 'building_home_B_blue' : 'building_home_A_blue', x: 0.4, z: 0.3 },
      ];
      for (const h of homes) {
        const c = Math.cos(-turn), s = Math.sin(-turn);
        out.push({ m: h.m, x: h.x * c - h.z * s, z: h.x * s + h.z * c, ry: turn + Math.floor(R() * 3 - 1) * STEP });
      }
      const props = ['barrel', 'crate_B_small', 'sack', 'crate_A_big'];
      for (let i = 0; i < 2; i++) {
        const a = turn + (i ? 0.9 : -2.2) + R() * 0.4;
        out.push({ m: props[Math.floor(R() * props.length)], x: Math.cos(a) * 0.62, z: Math.sin(a) * 0.62, ry: R() * TAU });
      }
      break;
    }
    case 'mountain': {
      const m = ['mountain_A_grass', 'mountain_B_grass', 'mountain_C_grass', 'mountain_A_grass_trees', 'mountain_C_grass_trees'];
      out.push({ m: m[Math.floor(R() * m.length)], x: 0, z: 0, ry: rot60() });
      break;
    }
    case 'ruins': {
      const layout = RUIN_LAYOUTS[Math.floor(R() * RUIN_LAYOUTS.length)]();
      out.push(...turned(layout, rot60() + (R() - 0.5) * 0.4));
      // A rock or a small tree or two at the rim, kept low so the ruins stay in view.
      const rim = ['rock_single_A', 'rock_single_C', 'rock_single_E', 'tree_single_A', 'tree_single_B'];
      for (let i = 1 + Math.floor(R() * 2); i > 0; i--) {
        const a = R() * TAU;
        out.push({ m: rim[Math.floor(R() * rim.length)], x: Math.cos(a) * 0.76, z: Math.sin(a) * 0.76, ry: R() * TAU, s: 0.65 });
      }
      break;
    }
    case 'hills':
      out.push({ m: HILLS[Math.floor(R() * HILLS.length)], x: 0, z: 0, ry: rot60() });
      break;
    case 'marsh':
      out.push(...turned(marshBits(R), rot60()));
      break;
    case 'meadow':
      scatter(['hill_single_A', 'hill_single_B', 'hill_single_C'], 1, 0.35);
      scatter(['rock_single_A', 'rock_single_C', 'tree_single_A', 'tree_single_B', 'rock_single_E'], 2 + Math.floor(R() * 2), 0.7);
      if (R() < 0.2) out.push({ m: 'tent', x: 0.45, z: 0.35, ry: R() * TAU });
      break;
  }

  if (tile.base === 'water') scatter(['waterlily_A', 'waterlily_B', 'waterplant_A', 'waterplant_B'], 2 + Math.floor(R() * 3), 0.75);

  // The bridge: the road runs straight from edge 1 to edge 5 (x 0.5), square across the river.
  // KayKit's bridges span edge 1 to edge 4 (60 degrees); turned by -30 degrees and brought in a
  // little, one spans the shorter chord.
  if (tile.base === 'bridge') out.push({ m: tile.v % 2 ? 'building_bridge_B' : 'building_bridge_A', x: 0.5, z: 0, ry: -Math.PI / 6, s: 0.9 });

  // Small trees and rocks in the dry corners of road, river and coast tiles.
  if (tile.base !== 'grass' && tile.base !== 'water') {
    const e = BASES[tile.base].edges;
    for (let c = 0; c < 6; c++) {
      if (e[c] !== 'L' || e[(c + 1) % 6] !== 'L' || R() > 0.45) continue;
      const a = c * STEP + STEP / 2 + (R() - 0.5) * 0.25;
      const d = 0.72 + R() * 0.1;
      const m = ['tree_single_A', 'tree_single_B', 'rock_single_C', 'rock_single_A', 'tree_single_B'][Math.floor(R() * 5)];
      out.push({ m, x: Math.cos(a) * d, z: Math.sin(a) * d, ry: R() * TAU });
    }
  }
  return out;
}

// ---------- the view ----------

export class View {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcfe6ee, 40, 95);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
    this.cam = { target: new THREE.Vector3(), yaw: 0.35, pitch: 0.95, dist: 17 };
    this.camGoal = null;
    this.shift = 0;
    this.shiftGoal = 0;

    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x7b6a4c, 1.6));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -24;
    sun.shadow.camera.right = 24;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -24;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    this.sun = sun;
    this.scene.add(sun, sun.target);

    this.board = new THREE.Group();
    this.scene.add(this.board);
    this.markers = new THREE.Group();
    this.scene.add(this.markers);
    this.views = new Map(); // tile key -> { group, vis }
    this.anims = [];
    this.templates = {};
    this.ghost = null;
    this.ghostKey = '';
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.ray = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.clouds = [];
    this.onFrame = null;

    const hexShape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + i * STEP;
      const p = [Math.cos(a) * 1.08, Math.sin(a) * 1.08];
      if (i) hexShape.lineTo(...p); else hexShape.moveTo(...p);
    }
    this.markerGeo = new THREE.ShapeGeometry(hexShape).rotateX(Math.PI / 2);
    this.markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    this.markerHot = new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    const ring = [];
    for (let i = 0; i <= 6; i++) {
      const a = Math.PI / 6 + i * STEP;
      ring.push(new THREE.Vector3(Math.cos(a) * 1.0, 0.01, -Math.sin(a) * 1.0));
    }
    this.ringGeo = new THREE.BufferGeometry().setFromPoints(ring);
    this.ringMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  async load(onProgress) {
    const loader = new GLTFLoader();
    let done = 0;
    await Promise.all(
      MODELS.map(async (name) => {
        const ruins = name.startsWith('ruins/');
        const glb = name.includes('/'); // the Quaternius and Kenney kits come as GLB, each in its folder
        const gltf = await loader.loadAsync(`models/${name}.${glb ? 'glb' : 'gltf'}`);
        if (ruins) restyleRuin(gltf.scene);
        if (name.startsWith('nature/')) restyleNature(gltf.scene);
        gltf.scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = !name.startsWith('hex_') && !name.startsWith('cloud');
            o.receiveShadow = true;
          }
        });
        this.templates[name] = gltf.scene;
        onProgress?.(++done / MODELS.length);
      }),
    );
    for (const [name, make] of Object.entries(SHAPES)) {
      const g = make();
      g.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
      this.templates[name] = g;
    }
    this.makeClouds();
    this.thumbs = new Thumbs(this);
  }

  model(name) {
    const t = this.templates[name];
    if (!t) throw new Error('missing model ' + name);
    return t.clone(true);
  }

  makeClouds() {
    const R = prng(99);
    for (let i = 0; i < 9; i++) {
      const c = this.model(R() < 0.5 ? 'cloud_big' : 'cloud_small');
      const a = R() * TAU;
      const d = 14 + R() * 26;
      c.position.set(Math.cos(a) * d, 5 + R() * 4, Math.sin(a) * d);
      c.scale.setScalar(0.8 + R() * 0.8);
      c.userData.speed = 0.25 + R() * 0.35;
      this.scene.add(c);
      this.clouds.push(c);
    }
  }

  // ---------- tiles ----------

  tileGroup(tile, info) {
    const g = new THREE.Group();
    const base = this.model(BASES[tile.base].model);
    g.add(base);
    const top = new THREE.Group();
    // A camp sits in its own group, so that when it is cleared it can be seen off on its own.
    const camp = new THREE.Group();
    for (const d of decorate(tile, info)) {
      const m = this.model(d.m);
      m.position.set(d.x, d.y || 0, d.z);
      m.rotation.set(d.rx || 0, d.ry || 0, d.rz || 0);
      if (Array.isArray(d.s)) m.scale.set(...d.s);
      else if (d.s) m.scale.setScalar(d.s);
      (d.camp ? camp : top).add(m);
    }
    if (camp.children.length) {
      top.add(camp);
      g.userData.camp = camp;
    }
    if (tile.feature === 'field') {
      // info.fields: bit k set when the neighbour across world edge k is a field.
      // The group turns by -rot, so local edge j faces world edge j + rot.
      let local = 0;
      for (let j = 0; j < 6; j++) if ((info.fields || 0) & (1 << ((j + tile.rot) % 6))) local |= 1 << j;
      const bed = new THREE.Mesh(fieldBed(local), bedMats);
      bed.receiveShadow = true;
      top.add(bed);
    }
    g.add(top);
    g.userData.top = top;
    // Base meshes turn with the tile; features are laid out in tile space for grass, but roads,
    // rivers and coasts carry corner decorations that must turn with the tile too.
    g.rotation.y = -tile.rot * STEP;
    return g;
  }

  // Bring the board in line with the game. Returns nothing; animates what changed.
  sync(state, { animate = true } = {}) {
    // Size of the group each tile belongs to, for forests and the piles beside buildings.
    const sizes = {};
    for (const kind of ['forest', 'mountain', 'village']) {
      sizes[kind] = new Map();
      for (const grp of groups(state, kind)) for (const k of grp) sizes[kind].set(k, grp.length);
    }
    const forest = sizes.forest;
    const seen = new Set();
    for (const [k, t] of Object.entries(state.tiles)) {
      seen.add(k);
      const info = { forest: forest.get(k), facing: t.building ? facing(state, t) : null, fields: 0 };
      if (t.camp || t.dungeon) info.mouth = mouthOf(state, t);
      info.pile = t.building ? pileTier(state, t, sizes) : null;
      if (t.feature === 'field') {
        for (const n of neighbours(t.q, t.r)) if (tileAt(state, n.q, n.r)?.feature === 'field') info.fields |= 1 << n.k;
      }
      const fClass = t.feature === 'forest' ? (info.forest >= 5 ? 3 : info.forest >= 2 ? 2 : 1) : 0;
      const vis = [t.base, t.rot, t.feature, t.building, fClass, info.facing, info.fields, info.pile, t.camp, t.dungeon, info.mouth].join('|');
      const cur = this.views.get(k);
      if (cur && cur.vis === vis) continue;
      const g = this.tileGroup(t, info);
      g.position.copy(hexToWorld(t.q, t.r));
      this.board.add(g);
      if (cur) {
        this.board.remove(cur.group);
        if (animate && cur.camp && !t.camp) this.seeOff(cur.group, g);
        else if (animate && t.building && !cur.building && BUILDINGS[t.building].land !== 'meadow') this.construct(g, t);
        else if (animate) this.pop(g.userData.top, 0.25);
      } else if (animate) {
        this.drop(g);
      }
      this.views.set(k, { group: g, vis, building: t.building, camp: t.camp });
    }
    for (const [k, v] of this.views) {
      if (!seen.has(k)) {
        this.board.remove(v.group);
        this.views.delete(k);
      }
    }
  }

  clear() {
    for (const v of this.views.values()) this.board.remove(v.group);
    this.views.clear();
  }

  drop(g) {
    const y0 = 1.6;
    g.position.y = y0;
    this.tween(0.38, (k) => {
      g.position.y = y0 * (1 - easeOutBack(k));
    });
    this.pop(g.userData.top, 0.32, 0.12);
  }

  pop(obj, dur, delay = 0) {
    obj.scale.setScalar(0.001);
    this.tween(dur, (k) => obj.scale.setScalar(Math.max(0.001, easeOutBack(k))), delay);
  }

  // A camp cleared: its tents (or its den) shrink, turn and rise away, and the land behind it
  // grows back.
  seeOff(old, g) {
    const camp = old.userData.camp;
    if (camp) {
      this.board.add(old);
      old.userData.top.children.forEach((c) => { if (c !== camp) c.visible = false; });
      old.children.forEach((c) => { if (c !== old.userData.top) c.visible = false; });
      this.tween(0.7, (k) => {
        const e = k * k;
        camp.scale.setScalar(Math.max(0.001, 1 - e));
        camp.position.y = e * 0.8;
        camp.rotation.y = e * 1.5;
        if (k >= 1) this.board.remove(old);
      });
    }
    this.pop(g.userData.top, 0.4, 0.45);
  }

  // Scaffolding, then the building rising in stages.
  construct(g, tile) {
    const top = g.userData.top;
    top.visible = false;
    const stages = ['building_stage_A', 'building_stage_B', 'building_stage_C'].map((n) => this.model(n));
    const ry = top.children[0]?.rotation.y || 0;
    for (const s of stages) {
      s.visible = false;
      s.rotation.y = ry;
      g.add(s);
    }
    const t0 = 0.22;
    stages.forEach((s, i) => {
      this.tween(t0, (k) => {
        s.visible = k < 1;
        s.scale.setScalar(0.6 + 0.4 * easeOutBack(k));
      }, i * t0);
    });
    this.tween(0.45, (k) => {
      if (!top.visible) {
        top.visible = true;
        for (const s of stages) g.remove(s);
      }
      top.scale.setScalar(Math.max(0.001, easeOutBack(k)));
    }, stages.length * t0);
  }

  tween(dur, fn, delay = 0) {
    this.anims.push({ t: -delay, dur, fn });
  }

  // ---------- spots and ghost ----------

  setSpots(spots, hot) {
    this.markers.clear();
    for (const s of spots) {
      const isHot = hot && hot.q === s.q && hot.r === s.r;
      const m = new THREE.Mesh(this.markerGeo, isHot ? this.markerHot : this.markerMat);
      m.position.copy(hexToWorld(s.q, s.r));
      m.position.y = 0.02;
      m.renderOrder = 1;
      this.markers.add(m);
      const line = new THREE.LineLoop(this.ringGeo, this.ringMat);
      line.position.copy(m.position);
      this.markers.add(line);
    }
  }

  setGhost(piece, q, r, rot, legal) {
    if (!piece || q === null) {
      if (this.ghost) this.ghost.visible = false;
      return;
    }
    const k = [piece.base, piece.feature, piece.v, rot, legal].join('|');
    if (k !== this.ghostKey) {
      if (this.ghost) this.scene.remove(this.ghost);
      const t = { ...piece, rot, q, r };
      const g = this.tileGroup(t, { forest: 1 });
      g.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false;
        o.material = Array.isArray(o.material) ? o.material.map((m) => ghostMaterial(m, legal)) : ghostMaterial(o.material, legal);
      });
      g.renderOrder = 2;
      this.ghost = g;
      this.ghostKey = k;
      this.scene.add(g);
    }
    this.ghost.visible = true;
    const p = hexToWorld(q, r);
    this.ghost.position.set(p.x, 0.35, p.z);
    this.ghost.userData.base = 0.35;
  }

  // ---------- camera and picking ----------

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 55 : 40;
    this.applyShift();
  }

  // On a tall screen the HUD covers the top and the bottom: keep the scene centred in the
  // space between them by shifting the projection (picking follows, it uses the same matrix).
  setInsets(top, bottom) {
    this.insets = { top, bottom };
    const tall = window.innerWidth < window.innerHeight;
    this.shiftGoal = tall ? (top - bottom) / 2 : 0;
  }

  applyShift() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (Math.abs(this.shift) > 0.5) this.camera.setViewOffset(w, h, 0, -this.shift, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  updateCamera() {
    const c = this.cam;
    c.pitch = Math.min(1.35, Math.max(0.45, c.pitch));
    c.dist = Math.min(60, Math.max(6, c.dist));
    const cp = Math.cos(c.pitch);
    this.camera.position.set(
      c.target.x + Math.sin(c.yaw) * cp * c.dist,
      c.target.y + Math.sin(c.pitch) * c.dist,
      c.target.z + Math.cos(c.yaw) * cp * c.dist,
    );
    this.camera.lookAt(c.target);
    // Fog stays behind what is in view, however far out the camera is.
    this.scene.fog.near = Math.max(40, c.dist + 25);
    this.scene.fog.far = this.scene.fog.near + 55;
    this.sun.position.set(c.target.x + 14, 26, c.target.z + 9);
    this.sun.target.position.copy(c.target);
  }

  groundAt(x, y) {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.ground, p) ? p : null;
  }

  cellAt(x, y) {
    const p = this.groundAt(x, y);
    return p ? worldToHex(p.x, p.z) : null;
  }

  toScreen(q, r, y = 0.5) {
    const p = hexToWorld(q, r);
    p.y = y;
    p.project(this.camera);
    return { x: (p.x + 1) / 2 * window.innerWidth, y: (1 - p.y) / 2 * window.innerHeight, behind: p.z > 1 };
  }

  // Glide the camera to look at the middle of the realm, close enough to fill the screen.
  frame(state) {
    const ts = Object.values(state.tiles);
    const c = new THREE.Vector3();
    for (const t of ts) c.add(hexToWorld(t.q, t.r));
    c.divideScalar(ts.length || 1);
    const R = 2 / Math.sqrt(3);
    const points = [];
    for (const t of ts) {
      const m = hexToWorld(t.q, t.r);
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3 + Math.PI / 6;
        for (const h of [0, 0.6]) points.push(new THREE.Vector3(m.x + Math.cos(a) * R, h, m.z + Math.sin(a) * R));
      }
    }
    this.camGoal = { target: c, dist: this.fitDistance(c, points, 13, 60) };
  }

  // The camera distance at which every point fits on screen, between the HUD bars on a tall
  // screen, seen from the current angle.
  fitDistance(target, points, min, max) {
    const keep = { target: this.cam.target.clone(), dist: this.cam.dist, shift: this.shift };
    const h = window.innerHeight;
    const tall = window.innerWidth < h && this.insets;
    const top = tall ? 1 - (2 * (this.insets.top + 10)) / h : 0.88;
    const bottom = tall ? -1 + (2 * (this.insets.bottom + 10)) / h : -0.88;
    this.shift = this.shiftGoal;
    this.applyShift();
    const v = new THREE.Vector3();
    const fits = (d) => {
      this.cam.target.copy(target);
      this.cam.dist = d;
      this.updateCamera();
      this.camera.updateMatrixWorld();
      return points.every((p) => {
        v.copy(p).project(this.camera);
        return v.z < 1 && Math.abs(v.x) <= 0.92 && v.y <= top && v.y >= bottom;
      });
    };
    let lo = min;
    let hi = max;
    if (fits(lo)) hi = lo;
    else for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
    this.cam.target.copy(keep.target);
    this.cam.dist = keep.dist;
    this.shift = keep.shift;
    this.applyShift();
    this.updateCamera();
    return hi;
  }


  // ---------- frame loop ----------

  start() {
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      const now = this.clock.elapsedTime;
      this.anims = this.anims.filter((a) => {
        a.t += dt;
        if (a.t < 0) return true;
        const k = Math.min(1, a.t / a.dur);
        a.fn(k);
        return k < 1;
      });
      if (this.shift !== this.shiftGoal) {
        const d = this.shiftGoal - this.shift;
        this.shift = Math.abs(d) < 0.5 ? this.shiftGoal : this.shift + d * (1 - Math.exp(-dt * 8));
        this.applyShift();
      }
      if (this.camGoal) {
        const g = this.camGoal;
        const f = 1 - Math.exp(-dt * 5);
        this.cam.target.lerp(g.target, f);
        this.cam.dist += (g.dist - this.cam.dist) * f;
        if (this.cam.target.distanceTo(g.target) < 0.01 && Math.abs(g.dist - this.cam.dist) < 0.02) this.camGoal = null;
      }
      if (this.ghost?.visible) this.ghost.position.y = this.ghost.userData.base + Math.sin(now * 3) * 0.06;
      for (const c of this.clouds) {
        c.position.x += c.userData.speed * dt;
        const dx = c.position.x - this.cam.target.x;
        if (dx > 45) c.position.x -= 90;
        if (dx < -45) c.position.x += 90;
      }
      this.updateCamera();
      this.onFrame?.(dt);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
}

const ghostCache = new Map();
function ghostMaterial(mat, legal) {
  const k = mat.uuid + legal;
  if (!ghostCache.has(k)) {
    const m = mat.clone();
    m.transparent = true;
    m.opacity = legal ? 0.85 : 0.55;
    if (!legal) m.color = new THREE.Color(0xff7a6a);
    else m.emissive = new THREE.Color(0x2a2410);
    ghostCache.set(k, m);
  }
  return ghostCache.get(k);
}

function easeOutBack(k) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}

// Small renders of upcoming tiles for the hand.
class Thumbs {
  constructor(view) {
    this.view = view;
    this.canvas = document.createElement('canvas');
    this.size = 192;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.size, this.size, false);
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x7b6a4c, 1.8));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.position.set(3, 6, 4);
    this.scene.add(sun);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 5.6, 4.2);
    this.camera.lookAt(0, -0.1, 0.15);
  }

  draw(target, piece, rot) {
    const ctx = target.getContext('2d');
    ctx.clearRect(0, 0, target.width, target.height);
    if (!piece) return;
    const g = this.view.tileGroup({ ...piece, rot, q: 0, r: 0 }, { forest: 1 });
    this.scene.add(g);
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(g);
    ctx.drawImage(this.canvas, 0, 0, target.width, target.height);
  }
}

export { key };
