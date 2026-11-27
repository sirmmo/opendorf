// Tile catalogue.
//
// Every tile is a hexagon with six edges, numbered 0..5 counter-clockwise when seen from
// above, starting at +x (edge k faces the direction at angle 60*k degrees in the x/z plane).
// Edge letters:
//   L  land          (grass, beach)
//   R  road
//   W  river
//   S  sea           (open water and the water side of coast tiles)
//
// The edge strings below were measured from the KayKit meshes themselves (tools/edges.py),
// so the rules match what is drawn.

export const BASES = {
  grass: { model: 'hex_grass', edges: 'LLLLLL' },
  water: { model: 'hex_water', edges: 'SSSSSS' },

  road_A: { model: 'hex_road_A', edges: 'RLLRLL' },
  road_B: { model: 'hex_road_B', edges: 'LLLRLR' },
  road_C: { model: 'hex_road_C', edges: 'LLLRRL' },
  road_D: { model: 'hex_road_D', edges: 'LRLRLR' },
  road_E: { model: 'hex_road_E', edges: 'RLLRLR' },
  road_F: { model: 'hex_road_F', edges: 'RRLRLL' },
  road_G: { model: 'hex_road_G', edges: 'LLRRRL' },
  road_H: { model: 'hex_road_H', edges: 'RLRRRL' },
  road_I: { model: 'hex_road_I', edges: 'LRRLRR' },
  road_J: { model: 'hex_road_J', edges: 'RRRRLL' },
  road_K: { model: 'hex_road_K', edges: 'LRRRRR' },
  road_L: { model: 'hex_road_L', edges: 'RRRRRR' },
  road_M: { model: 'hex_road_M', edges: 'LLLRLL' },

  river_A: { model: 'hex_river_A', edges: 'WLLWLL' },
  river_A_curvy: { model: 'hex_river_A_curvy', edges: 'WLLWLL' },
  river_B: { model: 'hex_river_B', edges: 'LLLWLW' },
  river_C: { model: 'hex_river_C', edges: 'LLLWWL' },
  river_D: { model: 'hex_river_D', edges: 'LWLWLW' },
  river_E: { model: 'hex_river_E', edges: 'WLLWLW' },
  river_F: { model: 'hex_river_F', edges: 'WWLWLL' },
  river_G: { model: 'hex_river_G', edges: 'LLWWWL' },
  river_H: { model: 'hex_river_H', edges: 'WLWWWL' },
  river_I: { model: 'hex_river_I', edges: 'LWWLWW' },
  river_J: { model: 'hex_river_J', edges: 'WWWWLL' },
  river_K: { model: 'hex_river_K', edges: 'LWWWWW' },
  river_L: { model: 'hex_river_L', edges: 'WWWWWW' },
  ford_A: { model: 'hex_river_crossing_A', edges: 'WRLWRL' },
  ford_B: { model: 'hex_river_crossing_B', edges: 'WLRWLR' },
  // The fords cover both crossings of a straight river by a straight road (edges 1-4 and 2-5,
  // at 60 degrees). What they cannot do is cross it square: a road from edge 1 to edge 5 runs
  // straight up the tile at x 0.5, across the river at a right angle. A bridge does that: the
  // straight river with a KayKit bridge laid over it (the view adds the bridge). Turned by 3 it
  // is the 2-4 crossing too, so one base covers both.
  bridge: { model: 'hex_river_A', edges: 'WRLWLR' },

  coast_A: { model: 'hex_coast_A', edges: 'LSLLLL' },
  coast_B: { model: 'hex_coast_B', edges: 'LSSLLL' },
  coast_C: { model: 'hex_coast_C', edges: 'SSSLLL' },
  coast_D: { model: 'hex_coast_D', edges: 'SSSLLS' },
};

// Features sit in the middle of plain grass tiles.
// Ruins are the broken walls and columns of an older realm, waiting for someone to dig.
// Hills are low green rises with stone under the turf; marsh is wet ground with pools and
// reeds, and only lies where it touches a river or the sea (see `needsWater`).
export const FEATURES = ['forest', 'field', 'village', 'meadow', 'mountain', 'ruins', 'hills', 'marsh'];

// Features that must touch water: a neighbour carrying a river or the sea.
export const needsWater = (feature) => feature === 'marsh';

// What the realm's carts bring, with relative weights.
export const BAG = [
  { base: 'grass', feature: 'forest', w: 20 },
  { base: 'grass', feature: 'field', w: 13 },
  { base: 'grass', feature: 'village', w: 16 },
  { base: 'grass', feature: 'meadow', w: 6 },
  { base: 'grass', feature: 'mountain', w: 4 },
  { base: 'grass', feature: 'ruins', w: 3.5 },
  { base: 'grass', feature: 'hills', w: 4 },
  { base: 'grass', feature: 'marsh', w: 2.5 },

  { base: 'road_A', w: 4 },
  { base: 'road_B', w: 3 },
  { base: 'road_C', w: 1 },
  { base: 'road_E', w: 1.4 },
  { base: 'road_F', w: 0.8 },
  { base: 'road_D', w: 0.6 },
  { base: 'road_M', w: 1.2 },
  { base: 'road_G', w: 0.4 },
  { base: 'road_H', w: 0.3 },
  { base: 'road_I', w: 0.3 },
  { base: 'road_J', w: 0.3 },
  { base: 'road_K', w: 0.15 },
  { base: 'road_L', w: 0.1 },

  { base: 'river_A', w: 2 },
  { base: 'river_A_curvy', w: 1.5 },
  { base: 'river_B', w: 2.5 },
  { base: 'river_C', w: 0.8 },
  { base: 'river_E', w: 0.8 },
  { base: 'river_F', w: 0.5 },
  { base: 'river_D', w: 0.3 },
  { base: 'river_G', w: 0.3 },
  { base: 'ford_A', w: 0.9 },
  { base: 'ford_B', w: 0.7 },
  { base: 'bridge', w: 0.4 },

  { base: 'water', w: 2.6 },
  { base: 'coast_A', w: 1.6 },
  { base: 'coast_B', w: 1.6 },
  { base: 'coast_C', w: 1.2 },
  { base: 'coast_D', w: 0.8 },
];

// Every tile there is, for the sandbox palette, in groups: land (each feature, then plain grass),
// roads, rivers (with fords), and the sea and its coasts.
function groupOf(base) {
  const e = BASES[base].edges;
  if (e.includes('W')) return 'river';
  if (e.includes('R')) return 'road';
  if (e.includes('S')) return 'sea';
  return 'land';
}
// Roads and rivers from the fewest ways to the most, fords and the bridge last.
function ways(base) {
  if (base === 'bridge') return 10;
  return base.startsWith('ford') ? 9 : [...BASES[base].edges].filter((x) => x === 'R' || x === 'W').length;
}
export const PALETTE_GROUPS = ['land', 'road', 'river', 'sea'];
export const PALETTE = [
  ...FEATURES.map((feature) => ({ base: 'grass', feature, group: 'land' })),
  { base: 'grass', group: 'land' },
  ...PALETTE_GROUPS.slice(1).flatMap((g) =>
    Object.keys(BASES).filter((b) => groupOf(b) === g).sort((x, y) => ways(x) - ways(y)).map((base) => ({ base, group: g }))),
];

// Banner colours for players taking turns: the four colours the KayKit buildings come in.
// `uv` is how far to the right of the blue its colour lies in the pack's palette texture (the
// view moves a blue building's roofs and flags there to paint it); `ink` reads on `hex`.
export const BANNERS = {
  blue: { name: 'Blue', hex: '#2a8bd2', ink: '#ffffff', uv: 0 },
  red: { name: 'Red', hex: '#d33b3b', ink: '#ffffff', uv: 0.125 },
  yellow: { name: 'Yellow', hex: '#f4b23e', ink: '#3b2a1a', uv: 0.25 },
  green: { name: 'Green', hex: '#13a06a', ink: '#ffffff', uv: 0.375 },
};

// A short name for a tile kind, e.g. "Forest", "Road, bend", "River, 3 ways", "Coast, sea on 2 sides".
export function tileName(kind) {
  if (kind.feature) return kind.feature[0].toUpperCase() + kind.feature.slice(1);
  const e = BASES[kind.base].edges;
  const count = (c) => [...e].filter((x) => x === c).length;
  const shape = (c) => {
    const at = [...e].map((x, i) => (x === c ? i : -1)).filter((i) => i >= 0);
    if (at.length === 1) return 'end';
    if (at.length === 2) {
      const d = at[1] - at[0];
      return d === 3 ? 'straight' : d === 1 || d === 5 ? 'sharp bend' : 'bend';
    }
    return `${at.length} ways`;
  };
  if (kind.base === 'grass') return 'Grass';
  if (kind.base === 'water') return 'Open sea';
  if (kind.base.startsWith('ford')) return 'Ford';
  if (kind.base === 'bridge') return 'Bridge';
  if (count('W')) return `River, ${kind.base.endsWith('curvy') ? 'winding' : shape('W')}`;
  if (count('R')) return `Road, ${shape('R')}`;
  const n = count('S');
  return `Coast, sea on ${n} side${n > 1 ? 's' : ''}`;
}

export const BUILDINGS = {
  lumbermill: { name: 'Lumbermill', pts: 10, tiles: 2, model: 'building_lumbermill_blue' },
  windmill: { name: 'Windmill', pts: 10, tiles: 2, model: 'building_windmill_blue' },
  watermill: { name: 'Watermill', pts: 10, tiles: 2, model: 'building_watermill_blue' },
  mine: { name: 'Mine', pts: 10, tiles: 2, model: 'building_mine_blue' },
  watchtower: { name: 'Watchtower', pts: 10, tiles: 2, model: 'building_tower_A_blue' },
  well: { name: 'Well', pts: 5, tiles: 1, model: 'building_well_blue' },
  tavern: { name: 'Tavern', pts: 10, tiles: 2, model: 'building_tavern_blue' },
  market: { name: 'Market', pts: 15, tiles: 3, model: 'building_market_blue' },
  blacksmith: { name: 'Blacksmith', pts: 15, tiles: 3, model: 'building_blacksmith_blue' },
  church: { name: 'Church', pts: 20, tiles: 4, model: 'building_church_blue' },
  castle: { name: 'Castle', pts: 40, tiles: 6, model: 'building_castle_blue' },
  // Ruins and the scholars they draw. No single model: the view composes them from the
  // Quaternius ruins pieces and a few KayKit props.
  digsite: { name: 'Dig site', pts: 10, tiles: 2 },
  society: { name: 'Archaeological Society', pts: 15, tiles: 3 },
  academy: { name: 'Academy', pts: 25, tiles: 4 },
  // Workshops of the new lands, composed by the view: a quarry cut into the hills, and an herb
  // garden of beds and drying racks by the marsh.
  quarry: { name: 'Quarry', plural: 'Quarries', pts: 10, tiles: 2 },
  herbgarden: { name: 'Herb garden', pts: 10, tiles: 2 },
  // A garrison for a village that can arm itself and keep a lookout.
  barracks: { name: 'Barracks', pts: 15, tiles: 3, model: 'building_barracks_blue' },
  archery: { name: 'Archery range', pts: 20, tiles: 3, model: 'building_archeryrange_blue' },
  // These two stand on the land itself, not on a house (`land`): the witch's hut in the middle
  // of a big marsh, the churchyard on a meadow beside a church.
  witchhut: { name: "Witch's hut", pts: 20, tiles: 2, land: 'marsh' },
  churchyard: { name: 'Churchyard', pts: 5, tiles: 1, land: 'meadow', verb: 'laid out' },
};

// A workshop appears on a house next to a group of the right land, one per `per` tiles. With
// `first`, the first one comes sooner: at `first` tiles, then one more every `per` tiles.
export const WORKSHOPS = [
  { building: 'lumbermill', group: 'forest', per: 3 },
  { building: 'windmill', group: 'field', per: 3 },
  { building: 'watermill', group: 'river', per: 3 },
  { building: 'mine', group: 'mountain', per: 1 },
  { building: 'watchtower', group: 'sea', per: 4 },
  { building: 'digsite', group: 'ruins', first: 1, per: 2 },
  { building: 'quarry', group: 'hills', per: 3 },
  { building: 'herbgarden', group: 'marsh', per: 3 },
];

// How many workshops a group of `size` tiles feeds.
export function workshopsFor(w, size) {
  const first = w.first ?? w.per;
  return size < first ? 0 : 1 + Math.floor((size - first) / w.per);
}

// Buildings a village raises once it holds the right others (each on a free house, one each):
// a blacksmith for a lumbermill and a mine; an Archaeological Society for a dig site and a
// tavern or a market; an Academy for a Society and a church; Barracks for a blacksmith and a
// watchtower within reach; an Archery range for Barracks and a market.
// `needs` must stand in the village; `near` may also stand within REACH tiles of it (a
// watchtower is often on the coast, across a road from the village it keeps watch for).
export const REACH = 2;
export const COMBOS = [
  { building: 'blacksmith', needs: [['lumbermill'], ['mine']] },
  { building: 'society', needs: [['digsite'], ['tavern', 'market']] },
  { building: 'academy', needs: [['society'], ['church']] },
  { building: 'barracks', needs: [['blacksmith']], near: [['watchtower']] },
  { building: 'archery', needs: [['barracks'], ['market']] },
];

// The witch's hut: once per marsh group of this many tiles.
export const WITCH_MARSH = 6;

// Wild camps. One may turn up in a big stretch of wild land with no village within REACH
// tiles: each tile laid that leaves such a group without a camp gives it a `chance`. A camp
// stops the land feeding new workshops (`blocks`) until a watchtower or Barracks stands within
// REACH tiles of its land, which clears it for renown and tiles. Nothing built is ever lost.
export const CAMPS = {
  bandits: { name: 'Bandit camp', land: 'forest', size: 5, blocks: 'lumbermill', pts: 15, tiles: 2, chance: 1 / 3 },
  wolves: { name: 'Wolf den', land: 'mountain', size: 3, blocks: 'mine', pts: 15, tiles: 2, chance: 1 / 3 },
};
export const CLEARS_CAMPS = ['watchtower', 'barracks'];

// The first mountain range of this many tiles opens a dungeon mouth, one per realm, leading to
// OpenDelve.
export const DUNGEON_MOUNTAIN = 3;
export const DELVE_URL = 'https://ingmmo.com/opendelve/';

// A tavern can be run as an inn in OpenInn: The Wheatsheaf, its village inn.
export const INN_URL = 'https://ingmmo.com/openinn/play/?game=village-inn';

// Village milestones: one of each per village, once it is big enough.
export const CIVIC = [
  { building: 'well', size: 3 },
  { building: 'tavern', size: 5 },
  { building: 'market', size: 7 },
  { building: 'church', size: 10 },
  { building: 'castle', size: 14 },
];

// Which edges may touch. Roads and rivers must carry on; land may meet the sea as a low cliff
// (the sea sits 0.2 below the grass, as in the KayKit sample scenes); a river may fall into
// the sea.
export function compatible(a, b) {
  if (a === b) return true;
  const pair = a < b ? a + b : b + a;
  return pair === 'LS' || pair === 'SW';
}

// Corners: corner c sits between edge c and edge c+1 (angle 60c+30).
//   d  dry land at grass height
//   w  open water (both edges are sea): flat, so it can meet a cliff
//   b  beach: sand sloping down to the sea between a land and a sea edge. A beach corner must
//      meet another beach or open water, or the sand ends in a notch in the next tile.
// Measured on the meshes with tools/heights.py: they follow from the edges.
export function cornersOf(edges) {
  let out = '';
  for (let c = 0; c < 6; c++) {
    const n = (edges[c] === 'S') + (edges[(c + 1) % 6] === 'S');
    out += n === 2 ? 'w' : n === 1 ? 'b' : 'd';
  }
  return out;
}
for (const b of Object.values(BASES)) b.corners = cornersOf(b.edges);

export function cornersAgree(a, b) {
  return !((a === 'b' && b === 'd') || (a === 'd' && b === 'b'));
}
