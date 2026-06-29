import type { CellEdges, GridCell, TileGrid } from "@/schema/grid";

/**
 * Bundled starter ships and fleets, so a brand-new player can run a battle the
 * moment the app loads instead of designing everything from scratch first.
 *
 * Designs and fleets are authored as plain objects and validated against the
 * schema at load time (same pattern as the catalog). Every design is a valid
 * build — solid cells 4-connected (substrate adjacency), a command module
 * present, power and crew in balance — which `presets.unit.test.ts` asserts,
 * so a catalog change that breaks a preset fails loudly rather than shipping a
 * broken starter ship.
 *
 * Phase 2: the layered-cell migration. Hull tiles (`#`/`=`/`o`) collapse to
 * `surface: "armor"` cells (all-wall edges, since armor is itself the
 * barrier). Struts (`/`) become `surface: "bare"` (low-mass framing, not
 * walkable, substrate-connected). Floor (`~`) becomes `surface: "deck"` (the
 * walkable crew floor). Every equipment token sits on `surface: "deck"` so
 * crew can reach every station. Armour-equipment modules (`A`, `D`, `c`, `R`)
 * are gone — armour is now a cell surface, so those tokens map to armor cells.
 *
 * Preset ids are stable ("preset-*"); seeding is idempotent and version-gated
 * (see src/storage/seed.ts).
 *
 * Grids are authored as a small ASCII map for legibility: each string is a
 * grid row, each token a cell. `.` is empty space and the remaining tokens map
 * to surfaces or module ids via the token tables below. The map is parsed
 * row-major into a `TileGrid`; engines face aft (π) so their thrust drives the
 * ship forward, everything else faces forward (0) — the Designer lets a player
 * change any cell's facing.
 */

/** Fixed timestamp: presets are built-in content, not user-authored records. */
export const PRESET_TIME = "2026-06-16T00:00:00.000Z";

// ---------------------------------------------------------------------------
// Cell construction helpers.
// ---------------------------------------------------------------------------

/** All-open edges: a deck/bare cell that does not gate crew movement or seal
 *  a compartment on any side. */
const OPEN_EDGES: CellEdges = {
  n: "open",
  e: "open",
  s: "open",
  w: "open",
  doorStates: {},
};

/** All-wall edges: an armor cell is itself the barrier on every side it
 *  presents. The airtightness perimeter check treats any edge bordering an
 *  armor cell as sealed. */
const WALL_EDGES: CellEdges = {
  n: "wall",
  e: "wall",
  s: "wall",
  w: "wall",
  doorStates: {},
};

/** An armor-surface cell: solid, impassable, high HP/mass, no equipment. */
function armorCell(): GridCell {
  return { kind: "solid", substrate: true, surface: "armor", edges: WALL_EDGES };
}

/** A bare-surface cell: low-mass framing, not walkable, substrate-connected. */
function bareCell(): GridCell {
  return { kind: "solid", substrate: true, surface: "bare", edges: OPEN_EDGES };
}

/** A deck-surface cell with no equipment: walkable interior corridor space. */
function deckCell(): GridCell {
  return { kind: "solid", substrate: true, surface: "deck", edges: OPEN_EDGES };
}

/** A deck-surface cell carrying one equipment module. All preset equipment
 *  sits on deck so crew can reach every station; a bare-mounted weapon would
 *  be unreachable. */
function deckEquip(moduleId: string, facing = 0): GridCell {
  return {
    kind: "solid",
    substrate: true,
    surface: "deck",
    edges: OPEN_EDGES,
    equipment: { moduleId, facing },
  };
}

// ---------------------------------------------------------------------------
// Faction token sets.
// ---------------------------------------------------------------------------

/** Single-character tokens for the ASCII grid authoring map — Terran parts.
 *  Hull tiles collapse to armor surfaces; struts to bare; floor to deck.
 *  Munitions: `G` magazine (mod-munitions-magazine).
 *  Sensors: `v` passive array (omni), `V` long-range dish (narrow forward cone,
 *  crewed), `K` gravimetric imager (wide nebula-immune cone). All face forward
 *  (bearing 0).
 *  Comms: `O` omni transceiver, `d` steerable relay dish, `b` laser backbone link.
 *  Manoeuvring: `J` RCS thrusters, `W` reaction wheel.
 *  Drive orientation: `E`/`P` fire AFT (π, driving the ship forward); `e`/`p`
 *  fire FORWARD (0, retrograde braking); `>` fires UP (−π/2, lateral −y);
 *  `<` fires DOWN (π/2, lateral +y). A competent combat ship mounts drive in
 *  every direction so it can brake and translate without flipping — matching
 *  the modularShip fixture's balanced engine set. */
const TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": armorCell(),
  "=": armorCell(),
  "o": armorCell(),
  "/": bareCell(),
  "~": deckCell(),
  "L": deckEquip("mod-pulse-laser", 0),
  "R": deckEquip("mod-railgun", 0),
  "M": deckEquip("mod-missile-rack", 0),
  "T": deckEquip("mod-plasma-torpedo", 0),
  "s": deckEquip("mod-shield-mk1", 0),
  "S": deckEquip("mod-shield-mk2", 0),
  // Armour tokens (`A`, `D`) formerly mapped to armour equipment modules.
  // Armour is now a cell surface; both map to an armor cell.
  "A": armorCell(),
  "D": armorCell(),
  "E": deckEquip("mod-engine-ion", Math.PI),
  "P": deckEquip("mod-engine-plasma", Math.PI),
  "e": deckEquip("mod-engine-ion", 0),
  "p": deckEquip("mod-engine-plasma", 0),
  ">": deckEquip("mod-engine-ion", -Math.PI / 2),
  "<": deckEquip("mod-engine-ion", Math.PI / 2),
  "F": deckEquip("mod-reactor-fusion", 0),
  "X": deckEquip("mod-reactor-antimatter", 0),
  "C": deckEquip("mod-crew-quarters", 0),
  "G": deckEquip("mod-munitions-magazine", 0),
  // Sensors
  "v": deckEquip("mod-sensor-passive", 0),
  "V": deckEquip("mod-sensor-longrange", 0),
  "K": deckEquip("mod-sensor-gravimetric", 0),
  // Comms
  "O": deckEquip("mod-comms-omni", 0),
  "d": deckEquip("mod-comms-dish", 0),
  "b": deckEquip("mod-comms-laser", 0),
  // Manoeuvring gear (Newtonian rotation): `J` RCS thrusters, `W` reaction wheel.
  "J": deckEquip("mod-rcs-thrusters", 0),
  "W": deckEquip("mod-reaction-wheel", 0),
};

/** Single-character tokens for the ASCII grid authoring map — Swarm parts.
 *  Distinct set so a Swarm grid can be authored without ambiguity. Hull tiles
 *  collapse to armor surfaces; struts to bare; bio-membrane passages to deck.
 *  `q` ammon sac (swm-ammon-sac, the Swarm magazine equivalent).
 *  Sensors: `e` electro-receptor membrane (omni), `y` chemosensor palp
 *  (directional cone). Both face forward (bearing 0).
 *  Comms: `h` pheromone net (omni), `i` synapse focus organ (dish), `k` biolaser spine.
 *  Manoeuvring: `x` pseudopod cluster, `z` gyral organ.
 *  Drive orientation: `j`/`u` fire AFT (π); `f`/`t` fire FORWARD (0, braking);
 *  `>` fires UP (−π/2); `<` fires DOWN (π/2). A balanced engine set lets the
 *  ship brake and strafe. */
const SWARM_TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": armorCell(),
  "=": armorCell(),
  "/": bareCell(),
  "~": deckCell(),
  "p": deckEquip("swm-spore-launcher", 0),
  "a": deckEquip("swm-acid-sprayer", 0),
  "n": deckEquip("swm-neural-sting", 0),
  "r": deckEquip("swm-regen-membrane", 0),
  // `c` formerly the carapace-plating armour module; now an armor cell.
  "c": armorCell(),
  "j": deckEquip("swm-flagellum-drive", Math.PI),
  "u": deckEquip("swm-pulse-jet", Math.PI),
  "f": deckEquip("swm-flagellum-drive", 0),
  "t": deckEquip("swm-pulse-jet", 0),
  ">": deckEquip("swm-flagellum-drive", -Math.PI / 2),
  "<": deckEquip("swm-flagellum-drive", Math.PI / 2),
  "g": deckEquip("swm-neural-ganglion", 0),
  "m": deckEquip("swm-metabolic-core", 0),
  "s": deckEquip("swm-spore-cloud", 0),
  "q": deckEquip("swm-ammon-sac", 0),
  // Sensors
  "e": deckEquip("swm-electro-membrane", 0),
  "y": deckEquip("swm-chemosensor-organ", 0),
  // Comms
  "h": deckEquip("swm-pheromone-net", 0),
  "i": deckEquip("swm-synapse-dish", 0),
  "k": deckEquip("swm-biolaser-spine", 0),
  // Manoeuvring gear (Newtonian rotation): `x` pseudopod cluster, `z` gyral organ.
  "x": deckEquip("swm-pseudopod-cluster", 0),
  "z": deckEquip("swm-gyral-organ", 0),
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
  return { cols, rows: rows.length, cells, connections: [] };
}

/** Parse an ASCII map using the Terran token set. */
export function gridFromMap(rows: readonly string[]): TileGrid {
  return gridFromMapWith(rows, TOKENS);
}

/** Parse an ASCII map using the Swarm token set. */
export function swarmGrid(rows: readonly string[]): TileGrid {
  return gridFromMapWith(rows, SWARM_TOKENS);
}

/** Single-character tokens for the ASCII grid authoring map — Crystalline parts.
 *  Drive orientation: `E` AFT (π), `e` FORWARD (0, braking), `>` UP (−π/2),
 *  `<` DOWN (π/2). */
const CRYSTAL_TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": armorCell(),
  "~": deckCell(),
  "F": deckEquip("cry-power-crystal", 0),
  "X": deckEquip("cry-quantum-lattice", 0),
  "C": deckEquip("cry-resonator-core", 0),
  "L": deckEquip("cry-prism-beam", 0),
  "H": deckEquip("cry-phase-lance", 0),
  "Z": deckEquip("cry-spinal-lance", 0), // Spinal Resonance Lance (1 GW capital spinal beam)
  "S": deckEquip("cry-adaptive-shield-mk1", 0),
  "D": deckEquip("cry-adaptive-shield-mk2", 0), // Adaptive Bulwark Mk II (600 MJ capital shield)
  "E": deckEquip("cry-thruster", Math.PI),
  "e": deckEquip("cry-thruster", 0),
  ">": deckEquip("cry-thruster", -Math.PI / 2),
  "<": deckEquip("cry-thruster", Math.PI / 2),
  "B": deckEquip("cry-blink-drive", 0),
  "K": deckEquip("cry-phase-cloak", 0),
  "v": deckEquip("cry-resonance-sensor", 0), // Resonance Sensor (omni passive array, matches Terran `v`)
};

/** Single-character tokens for the ASCII grid authoring map — Foundry parts.
 *  Drive orientation: `E` AFT (π), `P` AFT heavy (π), `e` FORWARD (0, braking),
 *  `>` UP (−π/2), `<` DOWN (π/2). */
const FOUNDRY_TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": armorCell(),
  "~": deckCell(),
  "F": deckEquip("fnd-reactor-mk1", 0),
  "X": deckEquip("fnd-reactor-mk2", 0),
  "C": deckEquip("fnd-crew-barracks", 0),
  "A": deckEquip("fnd-autocannon", 0),
  "G": deckEquip("fnd-magazine", 0),
  // `D` (fnd-bulkhead) and `R` (fnd-reactive-armour) formerly Foundry armour
  // modules. Armour is now a cell surface; both map to an armor cell. The
  // bulkhead's damageReduction and the reactive fields are ported onto the
  // Foundry armor layer material (see src/data/catalog/layer-materials.ts).
  "D": armorCell(),
  "R": armorCell(),
  "W": deckEquip("fnd-repair-bay", 0),
  "E": deckEquip("fnd-thruster", Math.PI),
  "P": deckEquip("fnd-grav-drive", Math.PI),
  "e": deckEquip("fnd-thruster", 0),
  ">": deckEquip("fnd-thruster", -Math.PI / 2),
  "<": deckEquip("fnd-thruster", Math.PI / 2),
  "M": deckEquip("fnd-mine-layer", 0),
};

/** Single-character tokens for the ASCII grid authoring map — Corsair parts.
 *  Drive orientation: `E` AFT (π), `e` FORWARD (0, braking), `>` UP (−π/2),
 *  `<` DOWN (π/2). */
const CORSAIR_TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": armorCell(),
  "~": deckCell(),
  "F": deckEquip("cor-reactor", 0),
  "C": deckEquip("cor-crew-quarters", 0),
  "M": deckEquip("cor-raider-missile", 0),
  "W": deckEquip("cor-swarm-missile", 0),
  "G": deckEquip("cor-magazine", 0),
  "E": deckEquip("cor-raider-engine", Math.PI),
  "e": deckEquip("cor-raider-engine", 0),
  ">": deckEquip("cor-raider-engine", -Math.PI / 2),
  "<": deckEquip("cor-raider-engine", Math.PI / 2),
  "K": deckEquip("cor-cloak", 0),
  "B": deckEquip("cor-blink-drive", 0),
  "J": deckEquip("cor-scrambler", 0),
  "O": deckEquip("cor-boarding-pod", 0),
};

/** Single-character tokens for the ASCII grid authoring map — Synthetic parts.
 *  Drive orientation: `E` AFT (π), `e` FORWARD (0, braking), `>` UP (−π/2),
 *  `<` DOWN (π/2). */
const SYNTHETIC_TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": armorCell(),
  "~": deckCell(),
  "P": deckEquip("syn-processor", 0),
  "X": deckEquip("syn-quantum-core", 0),
  "C": deckEquip("syn-precise-cannon", 0),
  "R": deckEquip("syn-railgun", 0),
  "G": deckEquip("syn-magazine", 0),
  "E": deckEquip("syn-thruster", Math.PI),
  "e": deckEquip("syn-thruster", 0),
  ">": deckEquip("syn-thruster", -Math.PI / 2),
  "<": deckEquip("syn-thruster", Math.PI / 2),
  "I": deckEquip("syn-pd-array", 0),
  "N": deckEquip("syn-sensor-array", 0),
  "H": deckEquip("syn-drone-hangar", 0),
  "A": deckEquip("syn-coordination-aura", 0),
};

/** Parse an ASCII map using the Crystalline token set. */
export function crystalGrid(rows: readonly string[]): TileGrid {
  return gridFromMapWith(rows, CRYSTAL_TOKENS);
}

/** Parse an ASCII map using the Foundry token set. */
export function foundryGrid(rows: readonly string[]): TileGrid {
  return gridFromMapWith(rows, FOUNDRY_TOKENS);
}

/** Parse an ASCII map using the Corsair token set. */
export function corsairGrid(rows: readonly string[]): TileGrid {
  return gridFromMapWith(rows, CORSAIR_TOKENS);
}

/** Parse an ASCII map using the Synthetic token set. */
export function syntheticGrid(rows: readonly string[]): TileGrid {
  return gridFromMapWith(rows, SYNTHETIC_TOKENS);
}
