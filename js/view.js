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
    ...Object.values(BUILDINGS).map((b) => b.model),
    'building_grain', 'building_stage_A', 'building_stage_B', 'building_stage_C', 'building_scaffolding',
    'building_home_A_blue', 'building_home_B_blue',
    'trees_A_small', 'trees_A_medium', 'trees_A_large', 'trees_B_small', 'trees_B_medium', 'trees_B_large',
    'mountain_A_grass', 'mountain_B_grass', 'mountain_C_grass', 'mountain_A_grass_trees', 'mountain_C_grass_trees',
    'hill_single_A', 'hill_single_B', 'hill_single_C', 'rock_single_A', 'rock_single_C', 'rock_single_E',
    'tree_single_A', 'tree_single_B', 'waterlily_A', 'waterlily_B', 'waterplant_A', 'waterplant_B',
    'cloud_big', 'cloud_small', 'barrel', 'crate_A_big', 'crate_B_small', 'sack', 'resource_lumber',
    'resource_stone', 'flag_blue', 'wheelbarrow', 'tent',
  ]),
];

// ---------- what stands on a tile ----------

// Which neighbour a building should face: a road if it has one, else what feeds it.
function facing(state, tile) {
  const source = {
    lumbermill: (o) => o.feature === 'forest',
    windmill: (o) => o.feature === 'field',
    mine: (o) => o.feature === 'mountain',
    watermill: (o) => BASES[o.base].edges.includes('W'),
    watchtower: (o) => BASES[o.base].edges.includes('S'),
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
    if (b === 'watermill' || b === 'watchtower') {
      const p = along(0.25, 0);
      out.push({ m: BUILDINGS[b].model, x: p.x, z: p.z, ry });
    } else {
      out.push({ m: BUILDINGS[b].model, x: 0, z: 0, ry });
    }
    const extra = { lumbermill: 'resource_lumber', mine: 'resource_stone', market: 'crate_A_big', blacksmith: 'barrel', tavern: 'barrel', windmill: 'sack' }[b];
    if (extra && b !== 'castle') {
      const p = along(0.62, 0.45);
      out.push({ m: extra, x: p.x, z: p.z, ry: ry + 0.4 });
    }
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
    case 'meadow':
      scatter(['hill_single_A', 'hill_single_B', 'hill_single_C'], 1, 0.35);
      scatter(['rock_single_A', 'rock_single_C', 'tree_single_A', 'tree_single_B', 'rock_single_E'], 2 + Math.floor(R() * 2), 0.7);
      if (R() < 0.2) out.push({ m: 'tent', x: 0.45, z: 0.35, ry: R() * TAU });
      break;
  }

  if (tile.base === 'water') scatter(['waterlily_A', 'waterlily_B', 'waterplant_A', 'waterplant_B'], 2 + Math.floor(R() * 3), 0.75);

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
        const gltf = await loader.loadAsync(`models/${name}.gltf`);
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
    for (const d of decorate(tile, info)) {
      const m = this.model(d.m);
      m.position.set(d.x, 0, d.z);
      m.rotation.y = d.ry || 0;
      if (d.s) m.scale.setScalar(d.s);
      top.add(m);
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
    const forest = new Map();
    for (const grp of groups(state, 'forest')) for (const k of grp) forest.set(k, grp.length);
    const seen = new Set();
    for (const [k, t] of Object.entries(state.tiles)) {
      seen.add(k);
      const info = { forest: forest.get(k), facing: t.building ? facing(state, t) : null, fields: 0 };
      if (t.feature === 'field') {
        for (const n of neighbours(t.q, t.r)) if (tileAt(state, n.q, n.r)?.feature === 'field') info.fields |= 1 << n.k;
      }
      const fClass = t.feature === 'forest' ? (info.forest >= 5 ? 3 : info.forest >= 2 ? 2 : 1) : 0;
      const vis = [t.base, t.rot, t.feature, t.building, fClass, info.facing, info.fields].join('|');
      const cur = this.views.get(k);
      if (cur && cur.vis === vis) continue;
      const g = this.tileGroup(t, info);
      g.position.copy(hexToWorld(t.q, t.r));
      this.board.add(g);
      if (cur) {
        this.board.remove(cur.group);
        if (animate && t.building && !cur.building) this.construct(g, t);
        else if (animate) this.pop(g.userData.top, 0.25);
      } else if (animate) {
        this.drop(g);
      }
      this.views.set(k, { group: g, vis, building: t.building });
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
        o.material = ghostMaterial(o.material, legal);
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

  // Glide the camera to look at the middle of the realm.
  frame(state) {
    const ts = Object.values(state.tiles);
    const c = new THREE.Vector3();
    for (const t of ts) c.add(hexToWorld(t.q, t.r));
    c.divideScalar(ts.length || 1);
    let far = 0;
    for (const t of ts) far = Math.max(far, hexToWorld(t.q, t.r).distanceTo(c));
    this.camGoal = { target: c, dist: Math.max(13, far * 2.1 + 8) };
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
