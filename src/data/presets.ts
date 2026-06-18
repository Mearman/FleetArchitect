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
 * The roster is built for variety: each faction fields a spread of roles
 * (interceptor, gunship, brawler, artillery, capital) that between them exercise
 * the whole catalogue — every weapon, both shield marks, both armour types, both
 * Terran engines, and the hull-tile shapes (block/edge/corner/strut) used as
 * light structural spines and prows rather than packing every cell with a module.
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
 *  Hull tiles: `#` block, `=` edge, `o` corner, `/` strut. */
const TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "hull", tile: "block" },
  "=": { kind: "hull", tile: "edge" },
  "o": { kind: "hull", tile: "corner" },
  "/": { kind: "hull", tile: "strut" },
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
};

/** Single-character tokens for the ASCII grid authoring map — Swarm parts.
 *  Distinct set so a Swarm grid can be authored without ambiguity. Hull tiles:
 *  `#` carapace block, `=` chitin plate (edge), `/` chitin filament (strut). */
const SWARM_TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "hull", tile: "block" },
  "=": { kind: "hull", tile: "edge" },
  "/": { kind: "hull", tile: "strut" },
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

const designData: ShipDesign[] = [
  // ===========================================================================
  // Terran designs — ferro-steel hulls, energy shields, conventional drives.
  // ===========================================================================
  {
    id: "preset-ship-sabre",
    name: "Sabre Interceptor",
    faction: "Terran",
    // Fighter: a cheap, fast laser picket. Twin pulse lasers on a fusion spine
    // with an ion drive and a strut nose for a little structure.
    grid: gridFromMap([
      "EFL",
      "/CL",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-wasp",
    name: "Wasp Skirmisher",
    faction: "Terran",
    // Fighter: a plasma-drive missile skirmisher that kites — the 360° missile
    // turret keeps firing while it runs. Light strut wings for shape.
    grid: gridFromMap([
      "PFM",
      "/C/",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-gunship",
    name: "Vanguard Gunship",
    faction: "Terran",
    // Frigate: the balanced workhorse. A railgun turret and pulse laser behind
    // a Mk I deflector, twin reactors and ion drives, crew amidships.
    grid: gridFromMap([
      "EFsR",
      "EFLC",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-bulwark",
    name: "Bulwark Escort",
    faction: "Terran",
    // Frigate: a shield brawler. A heavy Mk II shield bank and titanium plating
    // protect three pulse lasers, on triple reactors and ion drives.
    grid: gridFromMap([
      "EFCL",
      "ESAL",
      "EF#L",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-aegis",
    name: "Aegis Monitor",
    faction: "Terran",
    // Frigate: an armour brawler — slow, but a double belt of ablative hull and
    // a Mk I shield soak enormous punishment while two lasers chip back.
    grid: gridFromMap([
      "EFDL",
      "EsDC",
      "EF#L",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-torpedo",
    name: "Vanguard Torpedo Boat",
    faction: "Terran",
    // Frigate: stand-off artillery. A plasma torpedo and a missile turret behind
    // titanium and ablative plating; hits hard, folds under a rush.
    grid: gridFromMap([
      "EFAT",
      "ECDM",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-leviathan",
    name: "Leviathan Battleship",
    faction: "Terran",
    // Cruiser: a heavy mixed battery — torpedoes, railguns and lasers over a
    // hull spine, behind a Mk II shield wall, on triple antimatter cores with a
    // crew block amidships to run the guns.
    grid: gridFromMap([
      "EXCTS",
      "EXCRL",
      "EXCRL",
      "EX#TS",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-titan",
    name: "Titan Dreadnought",
    faction: "Terran",
    // Capital: the apex Terran hull. A laser broadside and railgun spinal mounts
    // behind a triple Mk II shield wall and an ablative cap, on antimatter power
    // with a full crew block. Enormously expensive — one anchors a whole fleet.
    grid: gridFromMap([
      "EXCLLS",
      "EXCLLS",
      "EXCLLS",
      "EX#RRD",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },

  // ===========================================================================
  // Swarm designs — bio-organic insectoid ships. Fast, numerous, regenerating.
  // ===========================================================================
  {
    id: "preset-ship-drone",
    name: "Drone Skimmer",
    faction: "Swarm",
    // Fighter: a spore launcher forward, a neural ganglion (command + power), a
    // flagellum drive aft — the most basic Swarm combat unit.
    grid: swarmGrid(["jgp"]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-carrion",
    name: "Carrion Wing",
    faction: "Swarm",
    // Fighter: a fast acid flanker. Twin acid sprayers strip armour at knife
    // range; a flagellum and a pulse jet make it the quickest thing in the swarm.
    grid: swarmGrid([
      "jga",
      "u/a",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-ravager",
    name: "Ravager Assault Ship",
    faction: "Swarm",
    // Frigate: twin acid sprayers over a regenerating hull, a metabolic core
    // (command + heavy power), two flagellum drives.
    grid: swarmGrid([
      "jga",
      "jra",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-spitter",
    name: "Brood Spitter",
    faction: "Swarm",
    // Frigate: a living artillery battery. A column of three neural stings spits
    // homing tendrils downrange; spore-cloud emitters screen incoming fire while
    // a regen membrane and metabolic core keep it in the fight.
    grid: swarmGrid([
      "jmn",
      "ssn",
      "jrn",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-hive-lord",
    name: "Hive Lord",
    faction: "Swarm",
    // Cruiser: a neural sting battery flanked by acid sprayers, carapace plating
    // amidships, a metabolic core, spore cloud point defences, pulse jets, and
    // regeneration membranes along the spine.
    grid: swarmGrid([
      "jm#n",
      "umsn",
      "jrcn",
      "uram",
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
    // A defensive capital line: a battleship anchor screened by two shield
    // brawlers, holding at long range and focusing the strongest threat.
    ships: [
      { designId: "preset-ship-leviathan", position: { x: -300, y: 0 }, facing: 0, orders: lineOrders },
      { designId: "preset-ship-bulwark", position: { x: -340, y: -130 }, facing: 0, orders: lineOrders },
      { designId: "preset-ship-bulwark", position: { x: -340, y: 130 }, facing: 0, orders: lineOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-fleet-strike",
    name: "Strike Wing",
    faction: "Terran",
    // A balanced mixed-arms wing: a gunship and torpedo boat for weight, fast
    // fighters to screen and flank.
    ships: [
      { designId: "preset-ship-gunship", position: { x: -300, y: -70 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-torpedo", position: { x: -300, y: 70 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-wasp", position: { x: -360, y: -150 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-sabre", position: { x: -360, y: 0 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-sabre", position: { x: -360, y: 150 }, facing: 0, orders: strikeOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-fleet-spearhead",
    name: "Armoured Spearhead",
    faction: "Terran",
    // A heavy aggressive thrust: the Titan dreadnought punches in behind two
    // armour brawlers, all driving to medium range and focusing fire.
    ships: [
      { designId: "preset-ship-titan", position: { x: -280, y: 0 }, facing: 0, orders: spearheadOrders },
      { designId: "preset-ship-aegis", position: { x: -340, y: -120 }, facing: 0, orders: spearheadOrders },
      { designId: "preset-ship-aegis", position: { x: -340, y: 120 }, facing: 0, orders: spearheadOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-fleet-picket",
    name: "Picket Screen",
    faction: "Terran",
    // A cheap fast screen: a cloud of interceptors and skirmishers that swarms
    // and harasses, picking off the weakest targets.
    ships: [
      { designId: "preset-ship-wasp", position: { x: -340, y: -120 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-wasp", position: { x: -340, y: 120 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-sabre", position: { x: -360, y: -60 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-sabre", position: { x: -380, y: 0 }, facing: 0, orders: skirmishOrders },
      { designId: "preset-ship-sabre", position: { x: -360, y: 60 }, facing: 0, orders: skirmishOrders },
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
    // and overwhelms by numbers.
    ships: [
      { designId: "preset-ship-drone", position: { x: -340, y: -120 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: -60 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -360, y: 0 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: 60 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -340, y: 120 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-carrion", position: { x: -320, y: -90 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-carrion", position: { x: -320, y: 90 }, facing: 0, orders: hiveOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-fleet-hive-assault",
    name: "Hive Assault",
    faction: "Swarm",
    // The combined assault: a Hive Lord leads ravagers and drones in an
    // all-out close-range charge.
    ships: [
      { designId: "preset-ship-hive-lord", position: { x: -300, y: 0 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-ravager", position: { x: -360, y: -80 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-ravager", position: { x: -360, y: 80 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -400, y: -160 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -400, y: 160 }, facing: 0, orders: hiveOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-fleet-brood-flight",
    name: "Brood Flight",
    faction: "Swarm",
    // An artillery brood: spitters sting from the back rank while carrion wings
    // and drones screen and run down anything that closes.
    ships: [
      { designId: "preset-ship-spitter", position: { x: -300, y: -70 }, facing: 0, orders: broodOrders },
      { designId: "preset-ship-spitter", position: { x: -300, y: 70 }, facing: 0, orders: broodOrders },
      { designId: "preset-ship-carrion", position: { x: -360, y: -150 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-carrion", position: { x: -360, y: 150 }, facing: 0, orders: hiveOrders },
      { designId: "preset-ship-drone", position: { x: -380, y: 0 }, facing: 0, orders: hiveOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
];

export const presetDesigns: readonly ShipDesign[] = designData.map((d) =>
  ShipDesign.parse(d),
);
export const presetFleets: readonly Fleet[] = fleetData.map((f) => Fleet.parse(f));
