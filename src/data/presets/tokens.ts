import type { GridCell, TileGrid } from "@/schema/grid";

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
export const PRESET_TIME = "2026-06-16T00:00:00.000Z";

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
  return { cols, rows: rows.length, cells, connections: [], shape: { outlineMode: "hexadecilinear" } };
}

/** Parse an ASCII map using the Terran token set. */
export function gridFromMap(rows: readonly string[]): TileGrid {
  return gridFromMapWith(rows, TOKENS);
}

/** Parse an ASCII map using the Swarm token set. */
export function swarmGrid(rows: readonly string[]): TileGrid {
  return gridFromMapWith(rows, SWARM_TOKENS);
}

/** Single-character tokens for the ASCII grid authoring map — Crystalline parts. */
const CRYSTAL_TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "hull", tile: "block" },
  "~": { kind: "floor" },
  "F": { kind: "module", moduleId: "cry-power-crystal", facing: 0 },
  "X": { kind: "module", moduleId: "cry-quantum-lattice", facing: 0 },
  "C": { kind: "module", moduleId: "cry-resonator-core", facing: 0 },
  "L": { kind: "module", moduleId: "cry-prism-beam", facing: 0 },
  "H": { kind: "module", moduleId: "cry-phase-lance", facing: 0 },
  "S": { kind: "module", moduleId: "cry-adaptive-shield-mk1", facing: 0 },
  "E": { kind: "module", moduleId: "cry-thruster", facing: Math.PI },
  "B": { kind: "module", moduleId: "cry-blink-drive", facing: 0 },
  "K": { kind: "module", moduleId: "cry-phase-cloak", facing: 0 },
};

/** Single-character tokens for the ASCII grid authoring map — Foundry parts. */
const FOUNDRY_TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "hull", tile: "block" },
  "~": { kind: "floor" },
  "F": { kind: "module", moduleId: "fnd-reactor-mk1", facing: 0 },
  "X": { kind: "module", moduleId: "fnd-reactor-mk2", facing: 0 },
  "C": { kind: "module", moduleId: "fnd-crew-barracks", facing: 0 },
  "A": { kind: "module", moduleId: "fnd-autocannon", facing: 0 },
  "G": { kind: "module", moduleId: "fnd-magazine", facing: 0 },
  "D": { kind: "module", moduleId: "fnd-bulkhead", facing: 0 },
  "R": { kind: "module", moduleId: "fnd-reactive-armour", facing: 0 },
  "W": { kind: "module", moduleId: "fnd-repair-bay", facing: 0 },
  "E": { kind: "module", moduleId: "fnd-thruster", facing: Math.PI },
  "P": { kind: "module", moduleId: "fnd-grav-drive", facing: Math.PI },
  "M": { kind: "module", moduleId: "fnd-mine-layer", facing: 0 },
};

/** Single-character tokens for the ASCII grid authoring map — Corsair parts. */
const CORSAIR_TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "hull", tile: "block" },
  "~": { kind: "floor" },
  "F": { kind: "module", moduleId: "cor-reactor", facing: 0 },
  "C": { kind: "module", moduleId: "cor-crew-quarters", facing: 0 },
  "M": { kind: "module", moduleId: "cor-raider-missile", facing: 0 },
  "W": { kind: "module", moduleId: "cor-swarm-missile", facing: 0 },
  "G": { kind: "module", moduleId: "cor-magazine", facing: 0 },
  "E": { kind: "module", moduleId: "cor-raider-engine", facing: Math.PI },
  "K": { kind: "module", moduleId: "cor-cloak", facing: 0 },
  "B": { kind: "module", moduleId: "cor-blink-drive", facing: 0 },
  "J": { kind: "module", moduleId: "cor-scrambler", facing: 0 },
  "O": { kind: "module", moduleId: "cor-boarding-pod", facing: 0 },
};

/** Single-character tokens for the ASCII grid authoring map — Synthetic parts. */
const SYNTHETIC_TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "hull", tile: "block" },
  "~": { kind: "floor" },
  "P": { kind: "module", moduleId: "syn-processor", facing: 0 },
  "X": { kind: "module", moduleId: "syn-quantum-core", facing: 0 },
  "C": { kind: "module", moduleId: "syn-precise-cannon", facing: 0 },
  "R": { kind: "module", moduleId: "syn-railgun", facing: 0 },
  "G": { kind: "module", moduleId: "syn-magazine", facing: 0 },
  "E": { kind: "module", moduleId: "syn-thruster", facing: Math.PI },
  "I": { kind: "module", moduleId: "syn-pd-array", facing: 0 },
  "N": { kind: "module", moduleId: "syn-sensor-array", facing: 0 },
  "H": { kind: "module", moduleId: "syn-drone-hangar", facing: 0 },
  "A": { kind: "module", moduleId: "syn-coordination-aura", facing: 0 },
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
