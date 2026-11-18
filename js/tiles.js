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

  coast_A: { model: 'hex_coast_A', edges: 'LSLLLL' },
  coast_B: { model: 'hex_coast_B', edges: 'LSSLLL' },
  coast_C: { model: 'hex_coast_C', edges: 'SSSLLL' },
  coast_D: { model: 'hex_coast_D', edges: 'SSSLLS' },
};

// Features sit in the middle of plain grass tiles.
export const FEATURES = ['forest', 'field', 'village', 'meadow', 'mountain'];

// What the realm's carts bring, with relative weights.
export const BAG = [
  { base: 'grass', feature: 'forest', w: 20 },
  { base: 'grass', feature: 'field', w: 13 },
  { base: 'grass', feature: 'village', w: 16 },
  { base: 'grass', feature: 'meadow', w: 6 },
  { base: 'grass', feature: 'mountain', w: 4 },

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

  { base: 'water', w: 2.6 },
  { base: 'coast_A', w: 1.6 },
  { base: 'coast_B', w: 1.6 },
  { base: 'coast_C', w: 1.2 },
  { base: 'coast_D', w: 0.8 },
];

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
};

// A workshop appears on a house next to a group of the right land, one per `per` tiles.
export const WORKSHOPS = [
  { building: 'lumbermill', group: 'forest', per: 3 },
  { building: 'windmill', group: 'field', per: 3 },
  { building: 'watermill', group: 'river', per: 3 },
  { building: 'mine', group: 'mountain', per: 1 },
  { building: 'watchtower', group: 'sea', per: 4 },
];

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
