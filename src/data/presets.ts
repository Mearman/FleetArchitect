import { Fleet, defaultOrders } from "@/schema/fleet";
import type { Orders } from "@/schema/fleet";
import type { GridCell, TileGrid } from "@/schema/grid";
import { ShipDesign } from "@/schema/ship";

/**
 * Bundled starter ships and fleets, so a brand-new player can run a battle the
 * moment the app loads instead of designing everything from scratch first.
 *
 * Designs and fleets are authored as plain objects and validated against the
 * schema at load time (same pattern as the catalog). Every design is a valid
 * build — cells 4-connected, a command module present, mass within the
 * cell-derived budget, power and crew in balance — which `presets.unit.test.ts`
 * asserts, so a catalog change that breaks a preset fails loudly rather than
 * shipping a broken starter ship.
 *
 * Phase D additions: floor / corridor cells (`~` token) and munitions magazines
 * (`G` Terran, `q` Swarm) are now part of the vocabulary. Every ship with
 * finite-ammo weapons (railguns, missiles, torpedoes, neural stings) carries at
 * least one magazine that is walkable-reachable from those weapons. Capitals
 * have explicit floor corridors running through their interiors so crew can
 * walk between quarters, reactors, magazines and weapon stations.
 *
 * Preset ids are stable ("preset-*"); seeding is idempotent and version-gated
 * (see src/storage/seed.ts).
 *
 * Grids are authored as a small ASCII map for legibility: each string is a grid
 * row, each token a cell. `.` is empty space and the remaining tokens map to
 * hull tiles or module ids via the token tables below. The map is parsed
 * row-major into a `TileGrid`; engines face aft (π) so their thrust drives the
 * ship forward, everything else faces forward (0) — the Designer lets a player
 * change any cell's facing.
 */

/** Fixed timestamp: presets are built-in content, not user-authored records. */
const PRESET_TIME = "2026-06-16T00:00:00.000Z";

/** Single-character tokens for the ASCII grid authoring map — Terran parts.
 *  Hull tiles: `#` block, `=` edge, `o` corner, `/` strut.
 *  `~` walkable floor / corridor cell (no module, just interior decking).
 *  `G` munitions magazine (mod-munitions-magazine).
 *  Sensors: `v` passive array (omni), `V` long-range dish (narrow forward cone,
 *  crewed), `K` gravimetric imager (wide nebula-immune cone). All face forward
 *  (bearing 0).
 *  Comms: `O` omni transceiver, `d` steerable relay dish, `b` laser backbone link.
 *  Manoeuvring: `J` RCS thrusters, `W` reaction wheel. */
const TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "hull", tile: "block" },
  "=": { kind: "hull", tile: "edge" },
  "o": { kind: "hull", tile: "corner" },
  "/": { kind: "hull", tile: "strut" },
  "~": { kind: "floor" },
  "L": { kind: "module", moduleId: "mod-pulse-laser", facing: 0 },
  "R": { kind: "module", moduleId: "mod-railgun", facing: 0 },
  "M": { kind: "module", moduleId: "mod-missile-rack", facing: 0 },
  "T": { kind: "module", moduleId: "mod-plasma-torpedo", facing: 0 },
  "s": { kind: "module", moduleId: "mod-shield-mk1", facing: 0 },
  "S": { kind: "module", moduleId: "mod-shield-mk2", facing: 0 },
  "A": { kind: "module", moduleId: "mod-armour-titanium", facing: 0 },
  "D": { kind: "module", moduleId: "mod-armour-ablative", facing: 0 },
  "E": { kind: "module", moduleId: "mod-engine-ion", facing: Math.PI },
  "P": { kind: "module", moduleId: "mod-engine-plasma", facing: Math.PI },
  "F": { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 },
  "X": { kind: "module", moduleId: "mod-reactor-antimatter", facing: 0 },
  "C": { kind: "module", moduleId: "mod-crew-quarters", facing: 0 },
  "G": { kind: "module", moduleId: "mod-munitions-magazine", facing: 0 },
  // Sensors
  "v": { kind: "module", moduleId: "mod-sensor-passive", facing: 0 },
  "V": { kind: "module", moduleId: "mod-sensor-longrange", facing: 0 },
  "K": { kind: "module", moduleId: "mod-sensor-gravimetric", facing: 0 },
  // Comms
  "O": { kind: "module", moduleId: "mod-comms-omni", facing: 0 },
  "d": { kind: "module", moduleId: "mod-comms-dish", facing: 0 },
  "b": { kind: "module", moduleId: "mod-comms-laser", facing: 0 },
  // Manoeuvring gear (Newtonian rotation): `J` RCS thrusters, `W` reaction wheel.
  "J": { kind: "module", moduleId: "mod-rcs-thrusters", facing: 0 },
  "W": { kind: "module", moduleId: "mod-reaction-wheel", facing: 0 },
};

/** Single-character tokens for the ASCII grid authoring map — Swarm parts.
 *  Distinct set so a Swarm grid can be authored without ambiguity. Hull tiles:
 *  `#` carapace block, `=` chitin plate (edge), `/` chitin filament (strut).
 *  `~` walkable floor / corridor cell (interior bio-membrane passage).
 *  `q` ammon sac (swm-ammon-sac, the Swarm magazine equivalent).
 *  Sensors: `e` electro-receptor membrane (omni), `y` chemosensor palp
 *  (directional cone). Both face forward (bearing 0).
 *  Comms: `h` pheromone net (omni), `i` synapse focus organ (dish), `k` biolaser spine.
 *  Manoeuvring: `x` pseudopod cluster, `z` gyral organ. */
const SWARM_TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "hull", tile: "block" },
  "=": { kind: "hull", tile: "edge" },
  "/": { kind: "hull", tile: "strut" },
  "~": { kind: "floor" },
  "p": { kind: "module", moduleId: "swm-spore-launcher", facing: 0 },
  "a": { kind: "module", moduleId: "swm-acid-sprayer", facing: 0 },
  "n": { kind: "module", moduleId: "swm-neural-sting", facing: 0 },
  "r": { kind: "module", moduleId: "swm-regen-membrane", facing: 0 },
  "c": { kind: "module", moduleId: "swm-carapace-plating", facing: 0 },
  "j": { kind: "module", moduleId: "swm-flagellum-drive", facing: Math.PI },
  "u": { kind: "module", moduleId: "swm-pulse-jet", facing: Math.PI },
  "g": { kind: "module", moduleId: "swm-neural-ganglion", facing: 0 },
  "m": { kind: "module", moduleId: "swm-metabolic-core", facing: 0 },
  "s": { kind: "module", moduleId: "swm-spore-cloud", facing: 0 },
  "q": { kind: "module", moduleId: "swm-ammon-sac", facing: 0 },
  // Sensors
  "e": { kind: "module", moduleId: "swm-electro-membrane", facing: 0 },
  "y": { kind: "module", moduleId: "swm-chemosensor-organ", facing: 0 },
  // Comms
  "h": { kind: "module", moduleId: "swm-pheromone-net", facing: 0 },
  "i": { kind: "module", moduleId: "swm-synapse-dish", facing: 0 },
  "k": { kind: "module", moduleId: "swm-biolaser-spine", facing: 0 },
  // Manoeuvring gear (Newtonian rotation): `x` pseudopod cluster, `z` gyral organ.
  "x": { kind: "module", moduleId: "swm-pseudopod-cluster", facing: 0 },
  "z": { kind: "module", moduleId: "swm-gyral-organ", facing: 0 },
};

/** Parse an ASCII map (one string per row) into a row-major TileGrid using the
 *  provided token map. Every row must be the same length; an unknown token
 *  throws so a typo in a preset fails loudly at module load. */
function gridFromMapWith(
  rows: readonly string[],
  tokens: Record<string, GridCell>,
): TileGrid {
  const firstRow = rows[0];
  if (firstRow === undefined) throw new Error("preset grid has no rows");
  const cols = firstRow.length;
  const cells: GridCell[] = [];
  for (const row of rows) {
    if (row.length !== cols) {
      throw new Error(`preset grid row "${row}" is not ${cols} cells wide`);
    }
    for (const ch of row) {
      const cell = tokens[ch];
      if (cell === undefined) throw new Error(`unknown grid token "${ch}"`);
      cells.push(cell);
    }
  }
  return { cols, rows: rows.length, cells };
}

/** Parse an ASCII map using the Terran token set. */
function gridFromMap(rows: readonly string[]): TileGrid {
  return gridFromMapWith(rows, TOKENS);
}

/** Parse an ASCII map using the Swarm token set. */
function swarmGrid(rows: readonly string[]): TileGrid {
  return gridFromMapWith(rows, SWARM_TOKENS);
}

// Authoring note on orientation: ships face +x (to the right). A cell's world
// x grows with its column, so the RIGHTMOST columns are the prow (forward) and
// the LEFTMOST are the stern — engines (`E`/`P`, `j`/`u`) sit at the left edge
// firing aft, weapons cluster toward the right. Empty cells (`.`) carve the
// silhouette: tapered prows, swept-back wings, engine nacelles. Rows are the
// beam (top-to-bottom) axis; designs are mirrored top/bottom so they fly true.
//
// Phase D interior design notes:
// - `~` (floor / corridor) tiles connect modules to quarters and magazines.
// - `G` (munitions magazine) must appear on every ship with finite-ammo weapons
//   (railguns, missiles, torpedoes). All occupied cells are walkable, so a
//   connected ship with at least one `G` automatically satisfies the
//   noAmmoSource reachability check.
// - Crew quarters (`C`) are needed whenever any module has crewRequired > 0.
//   All Terran modules with crew draw on the connected walkable surface, so
//   any connected design with crew quarters satisfies unreachableStation.

const designData: ShipDesign[] = [
  // ===========================================================================
  // Terran designs — ferro-steel hulls, energy shields, conventional drives.
  // Angular, symmetrical warships with armoured prows and aft engine banks.
  // ===========================================================================
  {
    id: "preset-ship-sabre",
    name: "Sabre Interceptor",
    faction: "Terran",
    // Fighter: a darting laser interceptor. Pulse lasers need no ammo supply
    // so no magazine is required. A central crew deck and fusion reactor keep
    // the design self-sufficient; swept hull struts give it its silhouette.
    // Phase B: a long-range scanner (V) on the starboard wing tip and an omni
    // transceiver (O) on the port wing tip make the Sabre the fleet's eyes —
    // it scouts ahead and relays contact data back on channel 0. The central
    // hull block is replaced by a second crew bay so the scanner operator has
    // a berth. crewRequired 9 / crewCapacity 16 — comfortably manned.
    // Merged: keeps the scanner (V) and omni transceiver (O), and adds RCS
    // thrusters (J) on the nose and tail so the Sabre can actually slew.
    grid: gridFromMap([
      "...JL..",
      ".E=#LV.",
      "EFFCCLL",
      ".E=#LO.",
      "...JL..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-wasp",
    name: "Wasp Skirmisher",
    faction: "Terran",
    // Fighter-sized missile skirmisher. The central munitions magazine (G)
    // replaces the hull block in the ship's spine, feeding all wingtip missile
    // turrets — the whole ship is 4-connected so crew can walk from any
    // crew-quarters cell to the magazine and back. Plasma drives give good speed.
    grid: gridFromMap([
      "..JM..",
      "P=CFMM",
      "PFCCGL",
      "P=CFMM",
      "..JM..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-gunship",
    name: "Vanguard Gunship",
    faction: "Terran",
    // Frigate: the balanced workhorse. A spinal railgun battery backed by a
    // central magazine (G) fed by a floor corridor, twin fusion reactors, crew
    // quarters, and an engine bank. The Mk I shields protect the flanks.
    grid: gridFromMap([
      "..JsRL..",
      ".EFC~sWR",
      "EFFCG~#R",
      ".EFC~sWR",
      "..JsRL..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-bulwark",
    name: "Bulwark Escort",
    faction: "Terran",
    // Frigate: a shield brawler using only pulse lasers. No finite-ammo weapons
    // means no magazine required. A broad Mk II shield wall fronts a laser bank;
    // triple fusion reactors and a deep crew and engine block run it.
    grid: gridFromMap([
      ".JWSAL.",
      "EFCSSAL",
      "EFFCSAL",
      "EFCSSAL",
      ".JWSAL.",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-aegis",
    name: "Aegis Monitor",
    faction: "Terran",
    // Frigate: an armour brawler. A blunt prow of ablative plating over a Mk I
    // shield soaks punishment while railgun turrets answer. The magazine (G) in
    // the central corridor feeds all railguns; slow but unyielding.
    grid: gridFromMap([
      ".JDDsR.",
      "EFCCGsR",
      "EXFWGsR",
      "EFCCGsR",
      ".JDDsR.",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-torpedo",
    name: "Vanguard Torpedo Boat",
    faction: "Terran",
    // Frigate: stand-off artillery. Spinal plasma torpedoes and wingtip missile
    // turrets hit enormously hard. The munitions magazine (G) sits in the
    // reactor bay feeding all weapons; five crew quarters sustain the large crew
    // needed to man torpedoes and missiles; titanium armour and shields protect
    // the fragile innards.
    grid: gridFromMap([
      "..AJMM...",
      ".EFCCAWTT",
      "EXFGCA#TT",
      ".EFCCAWTT",
      "..AJMM...",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-leviathan",
    name: "Leviathan Battleship",
    faction: "Terran",
    // Cruiser: a true capital broadside. Corridors (~) run from the crew block
    // through two magazines (G) to the torpedo and railgun batteries along the
    // flanks. A stepped armoured prow fronts the works; antimatter cores and a
    // five-engine stern bank drive the whole mass.
    //
    // Phase B: omni transceivers (O) bolted to the outer prow tips (rows 0 and 6
    // col 10) give fleet squad-net coverage on channel 0. Laser backbone links
    // (b) on rows 2 and 4 col 13 extend the high-bandwidth spine to relay ships
    // (dish/laser, also channel 0). Laser links are manned — crew can reach them
    // via the continuous walkable surface from the C cells in the interior.
    //
    // Layout (14 cols × 7 rows):
    // stern (left) → crew/reactor spine → corridors → magazines → weapons → prow
    // Merged: keeps the omni transceivers (O, prow tips rows 0/6) and the laser
    // backbone links (b, rows 2/4 col 13) for fleet squad-net, and adds RCS (J)
    // plus reaction wheels (W) on the spine so the capital can come about.
    grid: gridFromMap([
      "...JWSDTRLO...",
      "..EXCCSWTRRL..",
      ".EXFCC~GDRRLLb",
      "EXFCCCWG~RRLLL",
      ".EXFCC~GDRRLLb",
      "..EXCCSWTRRL..",
      "...JWSDTRLO...",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-titan",
    name: "Titan Dreadnought",
    faction: "Terran",
    // Capital: the apex Terran hull — a true dreadnought with a proper crewed
    // interior. Floor corridors (~) run fore–aft through the ship's core,
    // branching to magazines (G) that supply the railgun and missile batteries.
    // A great arrowhead prow of ablative armour and stacked Mk II shields fronts
    // banked weapon batteries; antimatter cores and crew decks drive a vast stern
    // engine bank. One anchors an entire fleet.
    //
    // Layout (19 cols × 9 rows):
    // stern → engines → reactor/crew spine → crew decks → magazines → weapons → prow
    // C cells (crew quarters) line the central corridor; G (magazine) cells sit
    // between the crew block and the weapon batteries so crew can haul ammo.
    grid: gridFromMap([
      "......JWWSDRML.....",
      ".....EXCCWSDRRMLL..",
      "....EXFCC~GSDRRMMLL",
      "...EXFFCCGGWDRRMMLL",
      "EXFFCCCGGGCDRRMMLLL",
      "...EXFFCCGGWDRRMMLL",
      "....EXFCC~GSDRRMMLL",
      ".....EXCCWSDRRMLL..",
      "......JWWSDRML.....",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },

  // ===========================================================================
  // Swarm designs — bio-organic insectoid ships. Asymmetric, clawed, organic
  // silhouettes: tapered stingers, swept carapace, clustered drive flagella.
  //
  // Swarm weapons are all bio-organic — spore launchers (cannon), acid sprayers
  // (beam), and neural stings (missile with tracking). Neural stings have no
  // ammoCapacity in the schema (they are guided bio-electric tendrils, not
  // discrete rounds), so no ammon sac is needed even for sting-armed ships.
  // All Swarm crewRequired values are 0; no crew quarters are needed either.
  // ===========================================================================
  {
    id: "preset-ship-drone",
    name: "Drone Skimmer",
    faction: "Swarm",
    // Fighter: the basic Swarm unit. A spore launcher snout, a neural ganglion
    // core, twin flagella — small, fast, expendable. No crew, no ammo.
    // Phase B: an electro-receptor membrane (e) and a pheromone net (h) extend
    // the Drone's awareness and connect it to the hive-net on channel 0. Both
    // are passive (no metabolic cost or crew), tucked onto the aft wing tips.
    // Merged: keeps the electro-receptor membrane (e) and pheromone net (h) for
    // hive-net awareness, and adds pseudopod clusters (x) so the Drone can turn.
    grid: swarmGrid([
      ".xpe",
      "jgpp",
      ".xph",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-carrion",
    name: "Carrion Wing",
    faction: "Swarm",
    // Fighter: a fast acid flanker. Forward-swept acid claws strip armour at
    // knife range; paired flagella and a pulse jet make it the quickest hunter.
    grid: swarmGrid([
      "..xa..",
      "j=gaa.",
      "ugcgaa",
      "j=gaa.",
      "..xa..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-ravager",
    name: "Ravager Assault Ship",
    faction: "Swarm",
    // Frigate: a regenerating brawler. Banks of acid sprayers over a
    // self-knitting carapace, a metabolic core, and a cluster of flagella and
    // pulse jets. No discrete ammo weapons so no ammon sac needed.
    grid: swarmGrid([
      ".jxcaa..",
      "jgczaaa.",
      "ugmcraaa",
      "jgczaaa.",
      ".jxcaa..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-spitter",
    name: "Brood Spitter",
    faction: "Swarm",
    // Frigate: living artillery. A fan of neural stingers spits homing tendrils
    // downrange; spore clouds screen it. Neural stings have no ammoCapacity so
    // no ammon sac is required. Regen membranes and a metabolic core sustain it.
    grid: swarmGrid([
      "..xsnn...",
      ".jgzsnnn.",
      "ugmcrsnnn",
      ".jgzsnnn.",
      "..xsnn...",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-hive-lord",
    name: "Hive Lord",
    faction: "Swarm",
    // Cruiser: the swarm capital. A great clawed prow of neural stingers and
    // acid sprayers over a regenerating carapace, ringed by spore-cloud defences,
    // with a metabolic heart and a bank of pulse-jet flagella driving the whole
    // mass. No discrete ammo weapons; no ammon sac needed.
    // Phase B: pheromone nets (h) on rows 1 and 5 provide omni squad-net
    // coverage on channel 0. Chemosensor organs (y) on rows 2 and 4 extend
    // the hive's detection reach well beyond weapon range. A biolaser spine
    // (k) on row 3 extends the Hive Lord to a high-bandwidth backbone relay
    // linking other hive-kin on the same channel. All bio-comms/sensors are
    // autonomous (crewRequired 0), adding only metabolic draw.
    // Merged: keeps the biolaser spines (k), pheromone nets (h) and chemosensor
    // organs (y) for hive-net coverage, and adds pseudopod clusters (x) plus
    // gyral organs (z) on the spine so the capital can come about.
    grid: swarmGrid([
      "...xcnnnk...",
      "..jgzrsnnnnh",
      ".jgmcrsannny",
      "ugmmcrsaannn",
      ".jgmcrsannny",
      "..jgzrsnnnnh",
      "...xcnnnk...",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
];

// Fleet doctrines — each a distinct set of orders the ships in it share.
const lineOrders: Orders = {
  ...defaultOrders,
  stance: "defensive",
  targetPriority: "strongest",
  engageRange: "long",
  retreatThreshold: 0.3,
  focusFire: true,
  rangeKeepingBand: 0.5,
};
const strikeOrders: Orders = {
  ...defaultOrders,
  stance: "balanced",
  targetPriority: "nearest",
  engageRange: "medium",
  retreatThreshold: 0.15,
  rangeKeepingBand: 0.3,
};
const skirmishOrders: Orders = {
  ...defaultOrders,
  stance: "evasive",
  targetPriority: "weakest",
  engageRange: "long",
  retreatThreshold: 0.4,
  focusFire: true,
  rangeKeepingBand: 0.6,
};
const spearheadOrders: Orders = {
  ...defaultOrders,
  stance: "aggressive",
  targetPriority: "strongest",
  engageRange: "medium",
  retreatThreshold: 0.1,
  focusFire: true,
  rangeKeepingBand: 0.25,
};
/** Orders for Swarm fleets: extremely aggressive, close-range pack hunters. */
const hiveOrders: Orders = {
  ...defaultOrders,
  stance: "aggressive",
  targetPriority: "nearest",
  engageRange: "short",
  retreatThreshold: 0,
  focusFire: true,
  rangeKeepingBand: 0.2,
};
/** Orders for the Swarm brood artillery: hang back and sting from range. */
const broodOrders: Orders = {
  ...defaultOrders,
  stance: "balanced",
  targetPriority: "weakest",
  engageRange: "long",
  retreatThreshold: 0.1,
  focusFire: true,
  rangeKeepingBand: 0.5,
};

const fleetData: Fleet[] = [
  // --- Terran fleets ---
  {
    id: "preset-fleet-battleline",
    name: "Battle Line",
    faction: "Terran",
    // A defensive capital line: twin battleships anchor a wall of shield
    // brawlers, holding at long range and focusing the strongest threat.
    ships: [
      { designId: "preset-ship-leviathan", position: { x: -300, y: -70 }, facing: 0, orders: lineOrders },
      { designId: "preset-ship-leviathan", position: { x: -300, y: 70 }, facing: 0, orders: lineOrders },
      { designId: "preset-ship-bulwark", position: { x: -350, y: -180 }, facing: 0, orders: lineOrders },
      { designId: "preset-ship-bulwark", position: { x: -350, y: 0 }, facing: 0, orders: lineOrders },
      { designId: "preset-ship-bulwark", position: { x: -350, y: 180 }, facing: 0, orders: lineOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-fleet-strike",
    name: "Strike Wing",
    faction: "Terran",
    // A balanced mixed-arms wing: paired gunships and torpedo boats for weight,
    // a screen of fast fighters to flank.
    ships: [
      { designId: "preset-ship-gunship", position: { x: -300, y: -90 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-gunship", position: { x: -300, y: 90 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-torpedo", position: { x: -320, y: 0 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-wasp", position: { x: -360, y: -170 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-wasp", position: { x: -360, y: 170 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-sabre", position: { x: -380, y: -60 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-sabre", position: { x: -380, y: 60 }, facing: 0, orders: strikeOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-fleet-spearhead",
    name: "Armoured Spearhead",
    faction: "Terran",
    // A heavy aggressive thrust: the Titan dreadnought punches in flanked by
    // armour brawlers and a gunship, all driving to medium range and focusing
    // fire on the strongest target.
    ships: [
      { designId: "preset-ship-titan", position: { x: -260, y: 0 }, facing: 0, orders: spearheadOrders },
      { designId: "preset-ship-aegis", position: { x: -360, y: -150 }, facing: 0, orders: spearheadOrders },
      { designId: "preset-ship-aegis", position: { x: -360, y: 150 }, facing: 0, orders: spearheadOrders },
      { designId: "preset-ship-gunship", position: { x: -400, y: 0 }, facing: 0, orders: spearheadOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-fleet-picket",
    name: "Picket Screen",
    faction: "Terran",
    // A cheap fast screen: a large cloud of interceptors and skirmishers that
    // swarms and harasses, picking off the weakest targets.
    ships: [
      { designId: "preset-ship-wasp", position: { x: -340, y: -180 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-wasp", position: { x: -340, y: -90 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-wasp", position: { x: -340, y: 90 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-wasp", position: { x: -340, y: 180 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-sabre", position: { x: -380, y: -135 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-sabre", position: { x: -380, y: -45 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-sabre", position: { x: -380, y: 45 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-sabre", position: { x: -380, y: 135 }, facing: 0, orders: skirmishOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  // --- Swarm fleets ---
  {
    id: "preset-fleet-drone-swarm",
    name: "Drone Swarm",
    faction: "Swarm",
    // The signature Swarm rush: a wall of expendable drones that closes fast
    // and overwhelms by numbers, with acid flankers on the wings.
    ships: [
      { designId: "preset-ship-drone", position: { x: -340, y: -200 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: -150 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: -100 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: -50 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -360, y: 0 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: 50 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: 100 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: 150 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: 200 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-carrion", position: { x: -320, y: -120 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-carrion", position: { x: -320, y: 120 }, facing: 0, orders: hiveOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-fleet-hive-assault",
    name: "Hive Assault",
    faction: "Swarm",
    // The combined assault: twin Hive Lords lead a pack of ravagers and drones
    // in an all-out close-range charge.
    ships: [
      { designId: "preset-ship-hive-lord", position: { x: -290, y: -80 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-hive-lord", position: { x: -290, y: 80 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-ravager", position: { x: -360, y: -160 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-ravager", position: { x: -360, y: 0 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-ravager", position: { x: -360, y: 160 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -420, y: -200 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -420, y: -100 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -420, y: 100 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -420, y: 200 }, facing: 0, orders: hiveOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-fleet-brood-flight",
    name: "Brood Flight",
    faction: "Swarm",
    // An artillery brood: a rank of spitters stings from the back while carrion
    // wings and drones screen and run down anything that closes.
    ships: [
      { designId: "preset-ship-spitter", position: { x: -300, y: -110 }, facing: 0, orders: broodOrders },
      { designId: "preset-ship-spitter", position: { x: -300, y: 0 }, facing: 0, orders: broodOrders },
      { designId: "preset-ship-spitter", position: { x: -300, y: 110 }, facing: 0, orders: broodOrders },
      { designId: "preset-ship-carrion", position: { x: -370, y: -170 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-carrion", position: { x: -370, y: 170 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -400, y: -60 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -400, y: 60 }, facing: 0, orders: hiveOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
];

export const presetDesigns: readonly ShipDesign[] = designData.map((d) =>
  ShipDesign.parse(d),
);
export const presetFleets: readonly Fleet[] = fleetData.map((f) => Fleet.parse(f));
