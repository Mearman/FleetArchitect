import { Fleet } from "@/schema/fleet";
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
 * cell-derived budget — which `presets.unit.test.ts` asserts, so a catalog
 * change that breaks a preset fails loudly rather than shipping a broken
 * starter ship.
 *
 * Preset ids are stable ("preset-*"); seeding is idempotent and version-gated
 * (see src/storage/seed.ts).
 *
 * Grids are authored as a small ASCII map for legibility: each string is a
 * grid row, each token a cell. `.` is empty space, `#` is a hull block, and
 * the remaining tokens map to module ids via `TOKENS`. The map is parsed
 * row-major into a `TileGrid`; every module cell faces forward (0 rad) — the
 * Designer lets a player change that per cell.
 */

/** Fixed timestamp: presets are built-in content, not user-authored records. */
const PRESET_TIME = "2026-06-16T00:00:00.000Z";

/** Single-character tokens for the ASCII grid authoring map. */
const TOKENS: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "hull", tile: "block" },
  "L": { kind: "module", moduleId: "mod-pulse-laser", facing: 0 },
  "R": { kind: "module", moduleId: "mod-railgun", facing: 0 },
  "M": { kind: "module", moduleId: "mod-missile-rack", facing: 0 },
  "T": { kind: "module", moduleId: "mod-plasma-torpedo", facing: 0 },
  "S": { kind: "module", moduleId: "mod-shield-mk2", facing: 0 },
  "A": { kind: "module", moduleId: "mod-armour-titanium", facing: 0 },
  "E": { kind: "module", moduleId: "mod-engine-ion", facing: Math.PI },
  "F": { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 },
  "X": { kind: "module", moduleId: "mod-reactor-antimatter", facing: 0 },
  "C": { kind: "module", moduleId: "mod-crew-quarters", facing: 0 },
};

/** Parse an ASCII map (one string per row) into a row-major TileGrid. Every
 *  row must be the same length; an unknown token throws so a typo in a preset
 *  fails loudly at module load. */
function gridFromMap(rows: readonly string[]): TileGrid {
  const firstRow = rows[0];
  if (firstRow === undefined) throw new Error("preset grid has no rows");
  const cols = firstRow.length;
  const cells: GridCell[] = [];
  for (const row of rows) {
    if (row.length !== cols) {
      throw new Error(`preset grid row "${row}" is not ${cols} cells wide`);
    }
    for (const ch of row) {
      const cell = TOKENS[ch];
      if (cell === undefined) throw new Error(`unknown grid token "${ch}"`);
      cells.push(cell);
    }
  }
  return { cols, rows: rows.length, cells };
}

const designData: ShipDesign[] = [
  {
    id: "preset-ship-sabre",
    name: "Sabre Interceptor",
    faction: "Terran",
    // Fighter: a forward pulse laser, a fusion reactor (the bridge), an ion
    // engine, all on one connected spine.
    grid: gridFromMap(["EFL", "..C"]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-gunship",
    name: "Vanguard Gunship",
    faction: "Terran",
    // Frigate: a railgun nose flanked by pulse lasers, twin reactors and
    // engines, crew amidships.
    grid: gridFromMap([
      "EFLR",
      "EFLC",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-bulwark",
    name: "Bulwark Escort",
    faction: "Terran",
    // Frigate: three pulse lasers behind a shield bank, triple reactors and
    // engines, crew, a hull strut amidships.
    grid: gridFromMap([
      "EFCL",
      "ESFL",
      "EF#L",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-torpedo",
    name: "Vanguard Torpedo Boat",
    faction: "Terran",
    // Frigate: a plasma torpedo and a missile rack forward, armour amidships,
    // twin reactors, an engine and crew aft.
    grid: gridFromMap([
      "EFAT",
      "EFCM",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-ship-leviathan",
    name: "Leviathan Battleship",
    faction: "Terran",
    // Cruiser: a heavy battery (torpedoes, railguns, lasers) over a hull
    // spine, triple antimatter reactors, triple engines, crew, a shield bank.
    grid: gridFromMap([
      "EX#TL",
      "EXSRL",
      "EXCTL",
      "EXCRC",
    ]),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
];

const swarmOrders: Orders = {
  stance: "aggressive",
  targetPriority: "nearest",
  engageRange: "short",
  retreatThreshold: 0,
};
const lineOrders: Orders = {
  stance: "defensive",
  targetPriority: "strongest",
  engageRange: "long",
  retreatThreshold: 0.3,
};
const strikeOrders: Orders = {
  stance: "balanced",
  targetPriority: "nearest",
  engageRange: "medium",
  retreatThreshold: 0.15,
};

const fleetData: Fleet[] = [
  {
    id: "preset-fleet-swarm",
    name: "Fighter Swarm",
    faction: "Terran",
    ships: [
      { designId: "preset-ship-sabre", position: { x: -340, y: -120 }, facing: 0, orders: swarmOrders },
      { designId: "preset-ship-sabre", position: { x: -340, y: -60 }, facing: 0, orders: swarmOrders },
      { designId: "preset-ship-sabre", position: { x: -360, y: 0 }, facing: 0, orders: swarmOrders },
      { designId: "preset-ship-sabre", position: { x: -340, y: 60 }, facing: 0, orders: swarmOrders },
      { designId: "preset-ship-sabre", position: { x: -340, y: 120 }, facing: 0, orders: swarmOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
  {
    id: "preset-fleet-battleline",
    name: "Battle Line",
    faction: "Terran",
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
    ships: [
      { designId: "preset-ship-gunship", position: { x: -300, y: -70 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-torpedo", position: { x: -300, y: 70 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-sabre", position: { x: -360, y: -150 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-sabre", position: { x: -360, y: 0 }, facing: 0, orders: strikeOrders },
      { designId: "preset-ship-sabre", position: { x: -360, y: 150 }, facing: 0, orders: strikeOrders },
    ],
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
  },
];

export const presetDesigns: readonly ShipDesign[] = designData.map((d) =>
  ShipDesign.parse(d),
);
export const presetFleets: readonly Fleet[] = fleetData.map((f) => Fleet.parse(f));
