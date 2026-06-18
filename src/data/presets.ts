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

// Authoring note on orientation: ships face +x (to the right). A cell's world
// x grows with its column, so the RIGHTMOST columns are the prow (forward) and
// the LEFTMOST are the stern — engines (`E`/`P`, `j`/`u`) sit at the left edge
// firing aft, weapons cluster toward the right. Empty cells (`.`) carve the
// silhouette: tapered prows, swept-back wings, engine nacelles. Rows are the
// beam (top-to-bottom) axis; designs are mirrored top/bottom so they fly true.

const designData: ShipDesign[] = [
  // ===========================================================================
  // Terran designs — ferro-steel hulls, energy shields, conventional drives.
  // Angular, symmetrical warships with armoured prows and aft engine banks.
  // ===========================================================================
  {
    id: "preset-ship-sabre",
    name: "Sabre Interceptor",
    faction: "Terran",
    // Fighter: a darting laser interceptor. A pointed nose of pulse lasers, swept
    // strut wings, an ion drive on the spine — cheap, fast, fragile.
    grid: gridFromMap([
      "...oL..",
      ".E=#L..",
      "EFFC#LL",
      ".E=#L..",
      "...oL..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-wasp",
    name: "Wasp Skirmisher",
    faction: "Terran",
    // Fighter: a plasma-drive missile skirmisher that kites. Wingtip missile
    // turrets fire in any direction while it runs; a strut tail for agility.
    grid: gridFromMap([
      "..#M..",
      "P=CFMM",
      "PFCC#L",
      "P=CFMM",
      "..#M..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-gunship",
    name: "Vanguard Gunship",
    faction: "Terran",
    // Frigate: the balanced workhorse. A railgun and laser battery behind a Mk I
    // deflector prow, twin fusion reactors, an engine bank and crew amidships.
    grid: gridFromMap([
      "..=sRL..",
      ".EFCCs#R",
      "EEFFCs#R",
      ".EFCCs#R",
      "..=sRL..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-bulwark",
    name: "Bulwark Escort",
    faction: "Terran",
    // Frigate: a shield brawler. A broad Mk II shield wall and titanium belt
    // front a laser battery; triple fusion reactors and a deep engine bank.
    grid: gridFromMap([
      ".=#SAL.",
      "EFCSSAL",
      "EFFCSAL",
      "EFCSSAL",
      ".=#SAL.",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-aegis",
    name: "Aegis Monitor",
    faction: "Terran",
    // Frigate: an armour brawler. A blunt prow of ablative plating over a Mk I
    // shield soaks punishment while railgun turrets answer; slow but unyielding.
    grid: gridFromMap([
      ".#DDsR.",
      "EFCCDsR",
      "EXFCDsR",
      "EFCCDsR",
      ".#DDsR.",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-torpedo",
    name: "Vanguard Torpedo Boat",
    faction: "Terran",
    // Frigate: stand-off artillery. Spinal plasma torpedoes and wingtip missile
    // turrets behind a titanium belt; hits enormously hard, folds under a rush.
    grid: gridFromMap([
      "..A#MM...",
      ".EFCCA#TT",
      "EXFFCA#TT",
      ".EFCCA#TT",
      "..A#MM...",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-leviathan",
    name: "Leviathan Battleship",
    faction: "Terran",
    // Cruiser: a true capital broadside. A stepped armoured prow and Mk II shield
    // wall front a mixed battery of torpedoes, railguns and lasers; antimatter
    // cores and a deep crew block run it, behind a five-engine stern bank.
    grid: gridFromMap([
      "...=#SDTRL....",
      "..EXCCSDTRRL..",
      ".EXFCCSDTRRLL.",
      "EXFCCCSDTRRLLL",
      ".EXFCCSDTRRLL.",
      "..EXCCSDTRRL..",
      "...=#SDTRL....",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-titan",
    name: "Titan Dreadnought",
    faction: "Terran",
    // Capital: the apex Terran hull and by far the largest thing in the
    // catalogue — a dreadnought that dwarfs a cruiser. A great arrowhead prow of
    // ablative armour and stacked Mk II shields fronts banked railgun, missile
    // and laser batteries; a core of antimatter cores and crew decks drives a
    // vast stern engine bank. One anchors an entire fleet.
    grid: gridFromMap([
      ".....=#SDRML.....",
      "...EXCCCSDRRMLL..",
      "..EXFCCCSDRRMMLL.",
      ".EXFFCCCSDRRMMLLL",
      "EXFFCCCCSDRRMMLLL",
      ".EXFFCCCSDRRMMLLL",
      "..EXFCCCSDRRMMLL.",
      "...EXCCCSDRRMLL..",
      ".....=#SDRML.....",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },

  // ===========================================================================
  // Swarm designs — bio-organic insectoid ships. Asymmetric, clawed, organic
  // silhouettes: tapered stingers, swept carapace, clustered drive flagella.
  // ===========================================================================
  {
    id: "preset-ship-drone",
    name: "Drone Skimmer",
    faction: "Swarm",
    // Fighter: the basic Swarm unit. A spore launcher snout, a neural ganglion
    // core, twin flagella — small, fast, expendable.
    grid: swarmGrid([
      ".#p.",
      "jgpp",
      ".#p.",
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
      "..#a..",
      "j=gaa.",
      "ugcgaa",
      "j=gaa.",
      "..#a..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-ravager",
    name: "Ravager Assault Ship",
    faction: "Swarm",
    // Frigate: a regenerating brawler. Banks of acid sprayers over a self-knitting
    // carapace, a metabolic core, and a cluster of flagella and pulse jets.
    grid: swarmGrid([
      ".j#caa..",
      "jgcraaa.",
      "ugmcraaa",
      "jgcraaa.",
      ".j#caa..",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-spitter",
    name: "Brood Spitter",
    faction: "Swarm",
    // Frigate: living artillery. A fan of neural stingers spits homing tendrils
    // downrange; spore clouds screen it while regen membranes and a metabolic
    // core sustain the brood.
    grid: swarmGrid([
      "..#snn...",
      ".jgcsnnn.",
      "ugmcrsnnn",
      ".jgcsnnn.",
      "..#snn...",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-hive-lord",
    name: "Hive Lord",
    faction: "Swarm",
    // Cruiser: the swarm capital. A great clawed prow of neural stingers and acid
    // sprayers over a regenerating carapace, ringed by spore-cloud defences, with
    // a metabolic heart and a bank of pulse-jet flagella driving the whole mass.
    grid: swarmGrid([
      "...#cnnn....",
      "..jgcrsnnnn.",
      ".jgmcrsannn.",
      "ugmmcrsaannn",
      ".jgmcrsannn.",
      "..jgcrsnnnn.",
      "...#cnnn....",
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
