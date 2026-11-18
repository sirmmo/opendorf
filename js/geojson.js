// The realm as GeoJSON: one polygon per tile, merged areas for each forest, field, village,
// mountain range and sea, road and river networks as lines, buildings as points, and the
// outline of the whole realm.
//
// Game (0, 0) is placed at `origin` ([lon, lat], default 0, 0) and one game unit is
// `metersPerUnit` metres (default 50, so a tile is 100 m across).

import { BASES, BUILDINGS } from './tiles.js';
import { DIRS, edgeAt, groups, key } from './rules.js';
import { projector, dissolve, polygonGeometry, feature } from './geo.js';

const SQ3 = Math.sqrt(3);
const R = 2 / SQ3; // corner radius of a tile (flats are 1 from the centre)

const center = (t) => [2 * t.q + t.r, SQ3 * t.r];

function hexRing(t) {
  const [cx, cz] = center(t);
  const ring = [];
  for (let c = 0; c < 6; c++) {
    const a = (c * Math.PI) / 3 + Math.PI / 6;
    ring.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]);
  }
  ring.push(ring[0]);
  return ring;
}

function edgeMid(t, k) {
  const [cx, cz] = center(t);
  const a = (k * Math.PI) / 3;
  return [cx + Math.cos(a), cz + Math.sin(a)];
}

export function toGeoJSON(state, { origin = [0, 0], metersPerUnit = 50 } = {}) {
  const project = projector(origin, metersPerUnit);
  const tiles = Object.values(state.tiles);
  const features = [];

  features.push(feature(polygonGeometry(dissolve(tiles.map(hexRing)), project), {
    layer: 'realm', tiles: tiles.length, seed: state.seed, score: state.score,
  }));

  const areas = [
    ['forest', 'forest'], ['field', 'farmland'], ['village', 'village'], ['mountain', 'mountain'], ['sea', 'sea'],
  ];
  for (const [kind, name] of areas) {
    for (const g of groups(state, kind)) {
      const rings = g.map((k) => hexRing(state.tiles[k]));
      features.push(feature(polygonGeometry(dissolve(rings), project), { layer: 'area', kind: name, tiles: g.length }));
    }
  }

  for (const [kind, letter] of [['road', 'R'], ['river', 'W']]) {
    for (const g of groups(state, kind)) {
      const lines = [];
      for (const k of g) {
        const t = state.tiles[k];
        for (let e = 0; e < 6; e++) if (edgeAt(t, e) === letter) lines.push([center(t), edgeMid(t, e)].map(project));
      }
      features.push(feature({ type: 'MultiLineString', coordinates: lines }, { layer: kind === 'road' ? 'road' : 'waterway', tiles: g.length }));
    }
  }

  for (const t of tiles) {
    if (t.building) {
      features.push(feature({ type: 'Point', coordinates: project(center(t)) }, {
        layer: 'building', building: t.building, name: BUILDINGS[t.building].name, q: t.q, r: t.r,
      }));
    } else if (t.feature === 'village') {
      features.push(feature({ type: 'Point', coordinates: project(center(t)) }, { layer: 'building', building: 'houses', name: 'Houses', q: t.q, r: t.r }));
    }
  }

  for (const t of tiles) {
    const edges = [0, 1, 2, 3, 4, 5].map((k) => edgeAt(t, k)).join('');
    const neighbours = DIRS.filter(([dq, dr]) => state.tiles[key(t.q + dq, t.r + dr)]).length;
    features.push(feature(polygonGeometry([[hexRing(t)]], project), {
      layer: 'tile', q: t.q, r: t.r, base: t.base, model: BASES[t.base].model, rotation: t.rot * 60,
      edges, feature: t.feature || null, building: t.building || null, neighbours, order: t.id,
    }));
  }

  return {
    type: 'FeatureCollection',
    name: `OpenDorf realm ${state.seed}`,
    opendorf: { seed: state.seed, turn: state.turn, score: state.score, origin, metersPerUnit, version: state.version },
    features,
  };
}
