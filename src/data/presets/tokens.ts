import type {
  CellCoord,
  CellEdges,
  Connection,
  EdgeKind,
  GridCell,
  SolidCell,
  TileGrid,
} from "@/schema/grid";

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
  "Y": deckEquip("mod-deflector-mk1", 0),
  "U": deckEquip("mod-deflector-mk2", 0),
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
  // Capital multi-cell modules — anchors only. The covered cells of each
  // polyomino are installed after subdivision by `coverFootprint` (below),
  // which claims the adjacent fine sub-cells as `covers` back-pointers to the
  // anchor. The token places the anchor at the coarse cell; subdivision carries
  // it to the top-left fine sub-cell of that block, and the footprint offsets
  // then extend east/south within the same block.
  "I": deckEquip("ter-spinal-lance", 0),          // 4-cell fixed spinal beam (forward)
  "Q": deckEquip("ter-spinal-driver", 0),         // 3-cell fixed spinal coilgun (forward)
  "H": deckEquip("ter-heavy-railgun-turret", 0),  // 2-cell heavy railgun turret
  "B": deckEquip("ter-capital-drive", Math.PI),   // 3-cell capital plasma drive (aft)
  "Z": deckEquip("ter-cross-reactor", 0),         // 4-cell T-section antimatter command core
  "N": deckEquip("ter-bastion-shield", 0),        // 2x2 capital shield array
  "k": deckEquip("ter-bulwark-deflector", 0),     // 2-cell heavy momentum screen
};

/** Single-character tokens for the ASCII grid authoring map — Swarm parts.
 *  Distinct set so a Swarm grid can be authored without ambiguity. Hull tiles
 *  collapse to armor surfaces; struts to bare; bio-membrane passages to deck.
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
  // `w` living momentum screen (carapace screen) — the Swarm's deflector.
  "w": deckEquip("swm-carapace-screen", 0),
  "j": deckEquip("swm-flagellum-drive", Math.PI),
  "u": deckEquip("swm-pulse-jet", Math.PI),
  "f": deckEquip("swm-flagellum-drive", 0),
  "t": deckEquip("swm-pulse-jet", 0),
  ">": deckEquip("swm-flagellum-drive", -Math.PI / 2),
  "<": deckEquip("swm-flagellum-drive", Math.PI / 2),
  "g": deckEquip("swm-neural-ganglion", 0),
  "m": deckEquip("swm-metabolic-core", 0),
  "s": deckEquip("swm-spore-cloud", 0),
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
  // Capital multi-cell modules — anchors only. The covered cells of each
  // polyomino are installed after subdivision by `coverFootprint` (below),
  // which claims the adjacent fine sub-cells as `covers` back-pointers to the
  // anchor. The token places the anchor at the coarse cell; subdivision carries
  // it to the top-left fine sub-cell of that block, and the footprint offsets
  // then extend east/south (or west, for the bloom cannon's T-bar) within the
  // same block. All capital Swarm weapons remain bio-autonomous (crewless).
  "B": deckEquip("swm-spore-battery", 0),       // 2-cell twin spore gland (forward)
  "V": deckEquip("swm-acid-bank", 0),           // 3-cell L-shaped acid bank (forward)
  "O": deckEquip("swm-bloom-cannon", 0),        // 4-cell T-shaped bloom cannon (forward)
  "H": deckEquip("swm-metabolic-heart", 0),     // 3-cell compound bio-reactor (command)
  "T": deckEquip("swm-tentacle-drive-mass", Math.PI),  // 2×2 tentacle drive cluster (aft)
  "W": deckEquip("swm-barkweave-carapace", 0),  // 3-cell ridged deflector carapace
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

/**
 * Install the covered cells of a multi-cell module around an anchor that
 * coarse-level authoring + subdivision already placed. Faction-agnostic: works
 * on any subdivided grid.
 *
 * The anchor sits at the top-left fine sub-cell of coarse block
 * `(anchorCol, anchorRow)`; after subdivision by `f` its fine position is
 * `(anchorCol * f, anchorRow * f)`. Each non-zero footprint offset claims the
 * fine sub-cell at that offset from the anchor, converting it from a plain
 * deck sub-cell into a covered cell carrying a `covers` back-pointer to the
 * anchor.
 *
 * The anchor itself (offset `{0,0}`) is installed here, NOT left to the token:
 *  - If the anchor cell already carries equipment for THIS module (placed by a
 *    coarse token such as `I` for a spinal lance, or `B` for an aft-facing
 *    capital drive), it is PRESERVED as-is — the token authors the anchor's
 *    `facing` (e.g. `Math.PI` for an aft drive), which the helper must not
 *    clobber.
 *  - If the anchor cell has NO equipment (the new use case — a plain `~` deck
 *    cell or corridor), the helper installs `{ moduleId, facing: 0 }` itself.
 *
 * That second branch is what lets `mountMultiCell` mount a multi-cell module
 * on ANY deck cell without requiring a dedicated single-character grid token
 * per new module id, so new modules can be added to the catalogue and mounted
 * in presets without touching this file's token tables.
 *
 * Throws on an out-of-bounds target, a non-solid target, or a non-anchor
 * covered cell that already carries equipment (an overlap the preset author
 * must resolve rather than silently overwrite), so a multi-cell module that
 * does not fit fails loudly at build time. The anchor placement is by design
 * (it is the mount target). Returns the input grid unchanged when the offset
 * list is empty.
 *
 * The optional `facing` argument only applies on the empty-anchor branch
 * (where the helper installs the equipment record itself): it lets a
 * `mountMultiCell` placement author the anchor's facing — e.g. `Math.PI` for
 * an aft drive mounted on a plain deck cell — without a dedicated grid token.
 * A token-placed anchor (the `cell.equipment !== undefined` branch) keeps the
 * facing the token authored, since the token is the authority there.
 */
export function coverFootprint(
  fine: TileGrid,
  subdivisionFactor: number,
  anchorCol: number,
  anchorRow: number,
  moduleId: string,
  offsets: readonly { dx: number; dy: number }[],
  facing: number = 0,
): TileGrid {
  const fineAnchorCol = anchorCol * subdivisionFactor;
  const fineAnchorRow = anchorRow * subdivisionFactor;
  const cells = fine.cells.slice();
  for (const { dx, dy } of offsets) {
    const col = fineAnchorCol + dx;
    const row = fineAnchorRow + dy;
    if (col < 0 || col >= fine.cols || row < 0 || row >= fine.rows) {
      throw new Error(
        `coverFootprint: covered cell (${col}, ${row}) for module "${moduleId}" is out of bounds`,
      );
    }
    const idx = row * fine.cols + col;
    const cell = cells[idx];
    if (cell === undefined || cell.kind !== "solid") {
      throw new Error(
        `coverFootprint: covered cell (${col}, ${row}) for module "${moduleId}" is not solid`,
      );
    }
    if (dx === 0 && dy === 0) {
      // Anchor: preserve a token-placed equipment record for this module
      // (it carries the token's authored `facing`, e.g. `Math.PI` for an aft
      // drive). Only install fresh equipment when the anchor cell is empty —
      // the mountMultiCell-on-any-deck-cell path that needs no dedicated token,
      // using the caller-supplied `facing` (default 0, forward).
      if (cell.equipment === undefined) {
        cells[idx] = { ...cell, equipment: { moduleId, facing } };
      }
      continue;
    }
    if (cell.equipment !== undefined) {
      throw new Error(
        `coverFootprint: covered cell (${col}, ${row}) for module "${moduleId}" already carries equipment`,
      );
    }
    cells[idx] = {
      ...cell,
      equipment: {
        facing: 0,
        covers: { moduleId, anchorCol: fineAnchorCol, anchorRow: fineAnchorRow },
      },
    };
  }
  return { ...fine, cells };
}

/**
 * Fold {@link coverFootprint} over a list of multi-cell module placements,
 * installing each anchor's covered cells in turn. Keeps a design literal
 * readable when a capital mounts several multi-cell modules at once: author the
 * coarse anchors as tokens, subdivide, then pass the fine grid and the list of
 * `(col, row, moduleId, offsets)` placements. Each placement's `(col, row)` is
 * the COARSE position of the anchor block.
 *
 * The optional fifth element `facing` lets a placement author the anchor's
 * facing on the empty-anchor branch (a mount on a plain `~` deck cell with no
 * dedicated grid token) — e.g. `Math.PI` for an aft drive. It has no effect on
 * a token-placed anchor, whose facing the token already authored.
 */
export function mountMultiCell(
  fine: TileGrid,
  subdivisionFactor: number,
  placements: readonly [
    col: number,
    row: number,
    moduleId: string,
    offsets: readonly { dx: number; dy: number }[],
    facing?: number,
  ][],
): TileGrid {
  return placements.reduce(
    (grid, [col, row, moduleId, offsets, facing]) =>
      coverFootprint(grid, subdivisionFactor, col, row, moduleId, offsets, facing),
    fine,
  );
}

/** Parse an ASCII map using the Swarm token set. */
export function swarmGrid(rows: readonly string[]): TileGrid {
  return gridFromMapWith(rows, SWARM_TOKENS);
}

// ---------------------------------------------------------------------------
// Coarse-level edge authoring.
// ---------------------------------------------------------------------------

/** A cardinal edge direction on a cell. */
export type EdgeDir = "n" | "e" | "s" | "w";

/** One coarse-level edge override: set the edge at `(col, row)` facing `dir` to
 *  `kind`. */
export interface AuthoredEdge {
  col: number;
  row: number;
  dir: EdgeDir;
  kind: EdgeKind;
}

/** Apply coarse-level edge overrides to a grid built by `gridFromMap` (or any
 *  factional variant). Each tuple sets one edge of one cell to an absolute
 *  `kind` — `open`, `wall`, or `door` — managing the doorState invariant (a
 *  state is present exactly on door edges). Authored doors default to open
 *  (passable at battle start; crew close them to seal during damage control).
 *
 *  Each edge is mirrored onto the neighbour cell's opposite edge so the shared
 *  boundary is symmetric: a wall blocks from either side and a door is
 *  openable from either side. Without this, `edgePassable` and the crew
 *  pathfinder (which read the edge off the *from* cell) would treat a one-sided
 *  wall as passable from the open side — crew could walk straight through an
 *  authored wall. Armour and out-of-bounds neighbours are skipped: armour's
 *  all-wall edges are the barrier already and overwriting them would break the
 *  invariant; a grid-boundary edge has no neighbour to mirror onto.
 *
 *  This runs AFTER `gridFromMap` and BEFORE `subdivideGrid`: a coarse-level
 *  wall or door between two deck/bare cells then propagates onto the matching
 *  sub-cell block perimeter during subdivision (see `projectedEdges` in
 *  `shipgen.ts`). Without this step subdivision drops authored edges, since
 *  `gridFromMap` cannot express per-cell walls or doors in the ASCII map.
 *
 *  Throws on an out-of-bounds coordinate or a non-solid (empty) target cell:
 *  a preset authoring error must fail loudly at build time rather than silently
 *  dropping an edge. Returns the input grid unchanged when `edges` is empty
 *  (the common case, so calling sites need no guard). */
export function withEdges(
  grid: TileGrid,
  edges: readonly AuthoredEdge[],
): TileGrid {
  if (edges.length === 0) return grid;
  const cells = grid.cells.slice();
  for (const edge of edges) {
    if (
      edge.col < 0 ||
      edge.col >= grid.cols ||
      edge.row < 0 ||
      edge.row >= grid.rows
    ) {
      throw new Error(
        `withEdges: edge override at (${edge.col}, ${edge.row}) is out of bounds`,
      );
    }
    const idx = edge.row * grid.cols + edge.col;
    const cell = cells[idx];
    if (cell === undefined || cell.kind !== "solid") {
      throw new Error(
        `withEdges: no solid cell at (${edge.col}, ${edge.row}) to edge`,
      );
    }
    cells[idx] = setEdge(cell, edge.dir, edge.kind);
    // Mirror the edge onto the neighbour's opposite side so walls block both
    // ways and doors open both ways (see function doc).
    const offset = EDGE_OFFSET[edge.dir];
    const nCol = edge.col + offset.dCol;
    const nRow = edge.row + offset.dRow;
    if (nCol >= 0 && nCol < grid.cols && nRow >= 0 && nRow < grid.rows) {
      const nIdx = nRow * grid.cols + nCol;
      const neighbour = cells[nIdx];
      if (
        neighbour !== undefined &&
        neighbour.kind === "solid" &&
        neighbour.surface !== "armor"
      ) {
        cells[nIdx] = setEdge(
          neighbour,
          EDGE_OPPOSITE[edge.dir],
          edge.kind,
        );
      }
    }
  }
  return { ...grid, cells };
}

/**
 * Append hardwire conduit {@link Connection}s to a grid. Author AFTER
 * subdivision and `mountMultiCell`: `subdivideGrid` strips connections
 * (`shipgen.ts`), so conduits must be added to the fine grid whose endpoints
 * are the magazine/weapon anchor sub-cells. Each connection is resolved to a
 * per-ship hardwire by `resolveHardwires` (`resolve.ts`), which validates the
 * source/sink module kinds via `stats.ts` (an ammo conduit's source must be a
 * magazine, sink a finite-ammo weapon). Returns the input grid unchanged when
 * `connections` is empty.
 */
export function withConnections(
  grid: TileGrid,
  connections: readonly Connection[],
): TileGrid {
  if (connections.length === 0) return grid;
  return { ...grid, connections: [...grid.connections, ...connections] };
}

/**
 * Build ammo-conduit {@link Connection}s from a magazine to one or more
 * finite-ammo weapons, authoring in COARSE grid coordinates (the same coords
 * `mountMultiCell` placements use) and scaling by the design's subdivision
 * factor to land on each anchor's top-left fine sub-cell — the cell carrying
 * the equipment. Call `withConnections(grid, ammoConduit(f, mag, weapons))`
 * as the LAST step of a design's grid pipeline (after `mountMultiCell`).
 */
export function ammoConduit(
  subdivisionFactor: number,
  magazineCoarse: CellCoord,
  weaponCoarses: readonly CellCoord[],
): Connection[] {
  const from: CellCoord = {
    col: magazineCoarse.col * subdivisionFactor,
    row: magazineCoarse.row * subdivisionFactor,
  };
  return weaponCoarses.map((w) => ({
    from,
    to: {
      col: w.col * subdivisionFactor,
      row: w.row * subdivisionFactor,
    },
    resource: "ammo",
  }));
}

/**
 * Build power-conduit {@link Connection}s from a reactor to one or more
 * power-drawing modules, authoring in COARSE grid coordinates and scaling by
 * the design's subdivision factor (mirroring {@link ammoConduit}). Use for a
 * high-draw module that sits beyond `powerWiringRadius` of every reactor (e.g.
 * a capital spinal lance on a deeply subdivided hull) so `refillHardwiredPower`
 * tops its charge each tick. Call `withConnections(grid, powerConduit(f, reactor, sinks))`
 * as the LAST step of a design's grid pipeline.
 */
export function powerConduit(
  subdivisionFactor: number,
  reactorCoarse: CellCoord,
  sinkCoarses: readonly CellCoord[],
): Connection[] {
  const from: CellCoord = {
    col: reactorCoarse.col * subdivisionFactor,
    row: reactorCoarse.row * subdivisionFactor,
  };
  return sinkCoarses.map((s) => ({
    from,
    to: {
      col: s.col * subdivisionFactor,
      row: s.row * subdivisionFactor,
    },
    resource: "power",
  }));
}

/** Cardinal (dCol, dRow) offset from a cell to the neighbour across each edge. */
const EDGE_OFFSET: Record<EdgeDir, { dCol: number; dRow: number }> = {
  n: { dCol: 0, dRow: -1 },
  e: { dCol: 1, dRow: 0 },
  s: { dCol: 0, dRow: 1 },
  w: { dCol: -1, dRow: 0 },
};

/** The direction the neighbour across an edge sees back along the shared edge. */
const EDGE_OPPOSITE: Record<EdgeDir, EdgeDir> = { n: "s", e: "w", s: "n", w: "e" };

/** Set one edge of a solid cell to `kind`, preserving the doorState invariant
 *  on the other three edges. The doorStates entry is added exactly when the
 *  edge becomes a door (defaulting to open, so crew can traverse at battle
 *  start) and removed otherwise. Returns a new cell; the input is not mutated. */
function setEdge(
  cell: SolidCell,
  dir: EdgeDir,
  kind: EdgeKind,
): SolidCell {
  const doorStates = { ...cell.edges.doorStates };
  if (kind === "door") {
    doorStates[dir] = "open";
  } else {
    delete doorStates[dir];
  }
  return {
    kind: "solid",
    substrate: true,
    surface: cell.surface,
    equipment: cell.equipment,
    edges: { ...cell.edges, [dir]: kind, doorStates },
  };
}

/** Single-character tokens for the ASCII grid authoring map — Crystalline parts.
 *  Weapons: `Y` Resonance Cannon (lobbed shard kinetic, unlimited ammo), `O`
 *  Resonance Overcharger (power surge). Drive orientation: `E` AFT (π), `e`
 *  FORWARD (0, braking), `>` UP (−π/2), `<` DOWN (π/2). */
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
  "Y": deckEquip("cry-resonance-cannon", 0), // Resonance Cannon (lobbed shard kinetic, unlimited ammo)
  "S": deckEquip("cry-adaptive-shield-mk1", 0),
  "D": deckEquip("cry-adaptive-shield-mk2", 0), // Adaptive Bulwark Mk II (600 MJ capital shield)
  "R": deckEquip("cry-resonance-bulwark-mk1", 0),
  "Q": deckEquip("cry-resonance-bulwark-mk2", 0),
  "O": deckEquip("cry-overcharger", 0), // Resonance Overcharger (brief power-ceiling surge)
  "E": deckEquip("cry-thruster", Math.PI),
  "e": deckEquip("cry-thruster", 0),
  ">": deckEquip("cry-thruster", -Math.PI / 2),
  "<": deckEquip("cry-thruster", Math.PI / 2),
  "B": deckEquip("cry-blink-drive", 0),
  "K": deckEquip("cry-phase-cloak", 0),
  "v": deckEquip("cry-resonance-sensor", 0), // Resonance Sensor (omni passive array, matches Terran `v`)
  // Capital multi-cell modules — anchors only. The covered cells of each
  // polyomino are installed after subdivision by `coverFootprint` (below),
  // which claims the adjacent fine sub-cells as `covers` back-pointers to the
  // anchor. The token places the anchor at the coarse cell; subdivision carries
  // it to the top-left fine sub-cell of that block, and the footprint offsets
  // then extend east/south within the same block.
  "A": deckEquip("cry-prism-array", 0),             // 2-cell paired prism-beam array (forward)
  "I": deckEquip("cry-spinal-lance-heavy", 0),      // 3-cell heavy spinal resonance lance (forward)
  "J": deckEquip("cry-shard-cannon-heavy", 0),      // 3-cell L-tromino heavy shard cannon (forward)
  "N": deckEquip("cry-adaptive-bastion", 0),        // 4-cell S-zigzag capital adaptive shield
  "W": deckEquip("cry-resonance-bulwark-array", 0), // 2-cell paired momentum screen
  "M": deckEquip("cry-quantum-spire", 0),           // 3-cell capital antimatter command core
  "P": deckEquip("cry-thruster-array", Math.PI),    // 2-cell paired resonance thruster (aft)
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
  // Capital weapons and defence — the Foundry's heavy battery, unlocked by the
  // roster review so the capitals field their signature modules.
  "H": deckEquip("fnd-heavy-cannon", 0),     // gauss, the capital kinetic
  "Q": deckEquip("fnd-siege-plasma", 0),     // capital plasma mortar (alpha strike)
  "Y": deckEquip("fnd-torpedo-tube", 0),     // armour-cracking torpedo
  "L": deckEquip("fnd-flak-battery", 0),     // point defence
  "U": deckEquip("fnd-bulwark-deflector", 0), // heavy momentum screen
  "W": deckEquip("fnd-repair-bay", 0),
  "E": deckEquip("fnd-thruster", Math.PI),
  "P": deckEquip("fnd-grav-drive", Math.PI),
  "e": deckEquip("fnd-thruster", 0),
  ">": deckEquip("fnd-thruster", -Math.PI / 2),
  "<": deckEquip("fnd-thruster", Math.PI / 2),
  "M": deckEquip("fnd-mine-layer", 0),
  // Capital multi-cell modules — polyomino-footprint variants of the
  // single-cell catalogue (see src/data/catalog/modules/foundry-capital.ts).
  // Each anchor's covered cells are installed by `mountMultiCell` after
  // subdivision; the tokens here place only the anchor equipment record.
  "S": deckEquip("fnd-siege-cannon-heavy", 0),  // 2×2 capital coilgun (forward)
  "J": deckEquip("fnd-forge-drive", Math.PI),   // 1×3 triple heavy-plasma drive (aft)
  "Z": deckEquip("fnd-cross-section-core", 0),  // T-section antimatter command core
  "K": deckEquip("fnd-magazine-bunker", 0),     // 1×2 blast-door magazine bunker
  "N": deckEquip("fnd-bulwark-bastion", 0),     // 2×2 capital deflector bastion
  "T": deckEquip("fnd-repair-bastion", 0),      // 1×2 twin damage-control bay
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
  // Cannon, drive, and ECM kit — the Reavers' raid tools, unlocked by the
  // roster review so the cruiser and boarding designs field their signature
  // modules.
  "R": deckEquip("cor-raid-cannon", 0),      // light autocannon, sustained fire
  "A": deckEquip("cor-afterburner", 0),       // burst thrust/turn
  "S": deckEquip("cor-raider-shield", 0),     // light shield
  "D": deckEquip("cor-raider-deflector", 0),  // light momentum screen
  "L": deckEquip("cor-decoy-launcher", 0),    // holo decoys
  // Capital multi-cell modules — anchors only. The covered cells of each
  // 1×2 polyomino are installed after subdivision by `coverFootprint` /
  // `mountMultiCell` (above), which claims the adjacent fine sub-cell as a
  // `covers` back-pointer to the anchor.
  "Y": deckEquip("cor-broadside-swarm-rack", Math.PI / 2),  // 2-cell twin-rail broadside missile array (broadside mount)
  "H": deckEquip("cor-heavy-raid-cannon", 0),               // 2-cell heavy autocannon (heavyAutocannon band)
  "U": deckEquip("cor-scrambler-array", 0),                 // 2-cell wide-aperture ECM jammer array
  "N": deckEquip("cor-raider-screen-array", 0),             // 2-cell medium-band shield projector
  "P": deckEquip("cor-raid-drive-bank", Math.PI),           // 2-cell twin-nozzle raider drive bank (aft)
  "X": deckEquip("cor-overdrive-reactor", 0),               // 2-cell advanced-fusion command reactor
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
  // Capital multi-cell modules — anchors only. The covered cells of each
  // polyomino are installed after subdivision by `coverFootprint` /
  // `mountMultiCell` (above), which claims the adjacent fine sub-cells as
  // `covers` back-pointers to the anchor. The token places the anchor at the
  // coarse cell; subdivision carries it to the top-left fine sub-cell of that
  // block, and the footprint offsets then extend east/south (or west/north,
  // for the plus-shape hub and shield) within the same block. All capital
  // Synthetic modules stay crewless — the Collective's automation signature.
  "K": deckEquip("syn-coilgun-bank", 0),         // 1×2 twin coilgun bank (forward)
  "D": deckEquip("syn-drone-hangar-heavy", 0),   // 2×2 heavy drone hangar (forward)
  "J": deckEquip("syn-coordination-hub", 0),     // plus-shape fleet datalink hub
  "M": deckEquip("syn-quantum-core-heavy", 0),   // 1×3 ganged antimatter command core
  "S": deckEquip("syn-shield-hub", 0),           // plus-shape capital shield projector
  "T": deckEquip("syn-thruster-bank", Math.PI),  // 1×2 twin ion drive bank (aft)
  "L": deckEquip("syn-interceptor-grid", 0),     // 1×2 dense point-defence grid
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
