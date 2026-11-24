# OpenDorf

A calm tile-laying game for the browser. You grow a medieval realm one hex tile at a time:
lay forests, fields, villages, roads, rivers and coastline, and watch the houses put the land
around them to work.

**Play:** https://sirmmo.github.io/opendorf/

## How it plays

1. **Lay tiles** next to your realm. Roads and rivers must carry on, and a beach must run on
   into more beach or open water (edges and corners both have to agree). Land may meet the sea
   as a low cliff, and rivers may flow into the sea. You see where the current tile fits, and
   how much renown it would earn, before you lay it.
2. **Houses put their land to work.** A house next to a forest becomes a lumbermill, next to
   fields a windmill, by a river a watermill, under a mountain a mine, and by the sea a
   watchtower. Each forest, field and river feeds one workshop per three tiles, a sea one per
   four, and every mountain feeds its own mine.
3. **Villages grow.** Village tiles that touch form a village. Three of them dig a well, then
   come a tavern (5), a market (7), a church (10) and finally a castle (14). A village with a
   lumbermill and a mine also gets a blacksmith. Every building needs a free house to stand on,
   so workshops and town buildings compete for the same houses.
4. **Royal charters** set three goals at a time (a forest of 8, a road across 6 tiles, a
   second windmill…).
5. **Tiles run out.** You start with 40. Every building and every charter brings more. When
   the last tile is laid, the realm is complete.

Renown per tile: +1 for each neighbour, +2 for each neighbour with the same land, +2 for each
road or river joined, +1 for each stretch of sea joined. Buildings and charters add their own.

Every realm has a seed. The same seed always deals the same tiles, so you can share a realm
(menu → *Copy link to this realm*) or play *Today's realm*. The game saves itself after every
move; the last move can be undone.

**Sandbox.** Menu → *Sandbox (choose every tile)* opens a realm where you pick each tile
yourself from a palette of every tile there is: each kind of land (forest, field, village,
meadow, mountain, plain grass), every road and river shape, fords, open sea and coasts. The
tile you pick stays in hand until you pick another. Fitting, renown, buildings and charters
work as in the normal game, but the tiles never run out and the realm never ends. The sandbox
saves apart from your normal realm (open it directly with `?mode=sandbox`); *Back to my realm*
returns to where you left off, and *New sandbox realm* starts over.

## Map export (GeoJSON)

Menu → *Download map (GeoJSON)* (also on the end screen) saves the realm as a GeoJSON
FeatureCollection. Each feature has a `layer` property:

| `layer` | Geometry | What |
| --- | --- | --- |
| `realm` | (Multi)Polygon | Outline of the whole realm |
| `area` | (Multi)Polygon | Each forest, farmland, village, mountain range and sea, merged (`kind`, `tiles`) |
| `road`, `waterway` | MultiLineString | Each road and river network |
| `building` | Point | Workshops, town buildings and houses (`building`, `name`) |
| `tile` | Polygon | Every tile: `q`, `r`, `base`, `model`, `rotation`, `edges`, `feature`, `building`, `order` |

The realm's centre tile sits at longitude/latitude 0, 0 and a tile is 100 m across. To put it
somewhere else, open the game with `?origin=lon,lat` (for example `?origin=11.3426,44.4949`).

## Controls

| | Mouse and keyboard | Touch |
| --- | --- | --- |
| Lay a tile | click a glowing spot | tap a spot, then tap it again (or *Place*) |
| Turn the tile | `R` / right click (`Shift+R` the other way) | ⟲ ⟳ |
| Move the view | drag, or `WASD` / arrows | drag |
| Rotate the view | right drag, `Q` / `E` | twist with two fingers |
| Zoom | wheel, `+` / `-` | pinch |
| Undo, discard, center | `Z`, `X`, `C` | ↶ and ⌖ buttons, *Discard* |
| Choose a tile (sandbox) | click it in the palette, `T` / `Shift+T` for the next / previous | tap it in the strip above the tray (swipe for more) |

## Development

Plain HTML, CSS and JavaScript modules. No build step and no dependencies at runtime.

```sh
python3 -m http.server 8000      # then open http://localhost:8000
npm test                          # rules tests (Node 20+)
node tools/balance.mjs 1 2 3      # greedy games per seed: length, score, buildings
```

| Path | What |
| --- | --- |
| `js/tiles.js` | Tile edges, the tile bag, the sandbox palette, buildings, workshop and village rules |
| `js/rules.js` | The game: pure, seeded and JSON-serialisable (`newGame`, `place`, `preview`, `discard`, and `choose` for the sandbox) |
| `js/view.js` | three.js board, ghost tile, spots, construction animation, hand thumbnails |
| `js/geojson.js`, `js/geo.js` | GeoJSON export: projection and merging tiles into outlines |
| `js/main.js` | Input, HUD, saving, undo, map download |
| `tools/edges.py`, `tools/heights.py` | Measure which tile edges carry road, river or sea, and the height of each corner, from the KayKit meshes |
| `models/` | The subset of the KayKit packs the game uses (glTF + each pack's shared texture) |

The rules never touch the DOM or three.js, so the tests and the balance script run them
directly in Node.

## Credits

- 3D models: [KayKit Medieval Hexagon Pack](https://kaylousberg.itch.io/kaykit-medieval-hexagon) and
  [KayKit Resource Bits](https://www.kaylousberg.com) (the piles beside workshops) by
  Kay Lousberg, CC0.
- [three.js](https://threejs.org), MIT (`vendor/three-LICENSE.txt`).
- Fonts: Cinzel and Fredoka from Google Fonts (OFL).

## License

Code: GPL-3.0, see `LICENSE`. Models: CC0.
