# Multi-cell (polyomino) module model

A design for modules whose installed footprint is more than one cell: a spinal
capital railgun spanning a row of cells, a reactor that fills a plus-shape, a
sensor array built as a diamond. The unit is the **polyomino**: a connected set
of cell offsets carried on the `ModuleDefinition`, placed on the grid at one
**anchor** cell, with the remaining **covered** cells pointing back to that
anchor.

The engine stays cell-based. Every solid cell is still one `SimModule` with its
own HP and connectivity; damage, break-apart, and the snapshot wire format do
not change. The polyomino is a **design-time and rendering** concept layered on
top: it changes how modules are *authored*, *placed*, *validated*, *aggregated
into stats*, and *drawn* — not how they *behave* in the simulation. This is what
makes the change backward-compatible: every existing module keeps a one-cell
footprint, the resolved `SimModule[]` for an all-1x1 fleet is byte-identical,
and the `LOSSLESS_CHECK` frame hash stays green through Phase 2.

## Goals

1. One module can occupy N connected cells (`N >= 1`).
2. Stats, mass, and cost come out of the module **once**, at its anchor — not
   once per covered cell. A 3-cell weapon is one weapon, not three.
3. The full polyomino must fit the hull, sit on placeable surfaces, and not
   overlap another module — validated at parse time like every other grid rule.
4. The battle engine, the snapshot/descriptor wire format, and break-apart need
   no algorithmic change. The model falls out of where the effect is attached.
5. Rendering merges the footprint into one visual block: every cell extruded in
   the module's colour and height, the glyph engraved only on the anchor.
6. Catalog authors scale a module's capability with its cell count; mass follows
   from the existing capability-derived density system, not from a new formula.

---

## 1. The `footprint` field on `ModuleDefinition`

`src/schema/module.ts:637` (`ModuleDefinition`) gains:

```ts
/**
 * The set of cell offsets this module occupies, anchored at {0,0} (the cell
 * where the module's equipment record lives). A 1-cell module — every existing
 * module — carries the default [{0,0}]. Offsets are integer cell coordinates;
 * the polyomino MUST be 4-connected (validated on the catalog at load, and the
 * grid refine re-checks fit/overlap on placement — see section 4).
 *
 * The footprint is a geometric/visual/connectivity concept. It does NOT drive
 * mass or stats directly: the catalog author writes the module's capability on
 * the effect (a 3-cell weapon authors ~3x the muzzle energy), and mass falls
 * out of the capability-derived density helpers in `data/catalog/physics.ts`.
 * See section 8.
 */
footprint: z
  .array(z.object({ dx: z.number().int(), dy: z.number().int() }))
  .min(1)
  .default([{ dx: 0, dy: 0 }]),
```

Invariants (validated by a catalog load-time check, separate from the per-grid
placement refine):

- `{0,0}` is always present (the anchor offset).
- The offsets form a single 4-connected polyomino (every offset reachable from
  `{0,0}` by edge-adjacent steps through other offsets). Diagonal-only links are
  not a polyomino.
- No duplicate offsets.

A 1-cell module authors only `[{0,0}]` (the default), so every existing catalog
entry parses unchanged.

## 2. The `covers` field on `CellEquipment`

`src/schema/grid.ts:90` (`CellEquipment`) today is a flat object with a required
`moduleId`. It becomes a record that carries **either** an anchor's module
reference **or** a covered cell's back-pointer to its anchor — never both. The
mutual exclusion is enforced by a refine, mirroring the existing
`SolidCell` refine at `grid.ts:137` that excludes equipment on armour:

```ts
export const CellEquipment = z
  .object({
    /** Anchor fields — present when this cell IS a module's anchor. */
    moduleId: EntityId.optional(),
    /** Direction the module faces, ship-local radians. Default 0 (forward).
     *  Meaningful only on an anchor; covered cells accept the default and
     *  ignore it. */
    facing: z.number().default(0),
    channel: z.number().int().min(0).optional(),
    commsBearing: z.number().optional(),
    commsRange: z.number().optional(),
    sensorBearing: z.number().optional(),
    sensorRangeSetting: z.number().optional(),
    /** Covered-cell marker — present when this cell is part of a multi-cell
     *  module anchored elsewhere. `{moduleId, anchorCol, anchorRow}` identifies
     *  the anchor cell that owns this module instance. Mutually exclusive with
     *  `moduleId` (the refine below). */
    covers: z
      .object({
        moduleId: EntityId,
        anchorCol: z.number().int().min(0),
        anchorRow: z.number().int().min(0),
      })
      .optional(),
  })
  .refine((e) => (e.moduleId !== undefined) !== (e.covers !== undefined), {
    message:
      "CellEquipment must carry exactly one of moduleId (anchor) or covers (covered cell)",
    path: [],
  });
```

Reading the result:

- An **anchor** cell has `equipment.moduleId` set and `equipment.covers === undefined`.
  All per-instance overrides (`facing`, `channel`, ...) live here.
- A **covered** cell has `equipment.covers` set and `equipment.moduleId === undefined`.
  It carries no per-instance config of its own; it inherits the anchor's identity.
- A plain deck/bare cell has `equipment === undefined` (unchanged).

The inferred type makes `moduleId` optional, so direct reads must narrow
(`if (e.moduleId !== undefined)`). This is deliberate: the repo bans `as`
assertions, and the `placedModules` helper (section 3) is the abstraction that
shields almost every consumer from having to narrow. The handful of sites that
still read `cell.equipment` directly are listed in section 5.

**Backward compatibility.** Existing persisted designs and shared URLs carry
`equipment.moduleId` with no `covers` field; they parse as anchors (the refine
passes: `moduleId` present, `covers` absent). `covers` defaults to `undefined`,
so old data loads cleanly with no migration. `facing` moving from required to
`.default(0)` is also backward-compatible: old data already carries it.

The existing `SolidCell` refine at `grid.ts:137`
(`surface !== "armor" || equipment === undefined`) needs no change: a covered
cell still has `equipment !== undefined`, so armour cells carrying `covers` are
rejected exactly as armour cells carrying an anchor would be. Armour is not
equipment-placeable, anchor or covered.

## 3. The `placedModules` helper

A new pure helper that walks the grid and yields **each placed module once**, at
its anchor, skipping covered cells. This is the single migration target for
every site that today iterates `cell.equipment` per cell and would otherwise
double-count a multi-cell module.

It lives in a new catalog-free module (e.g. `src/domain/placed-modules.ts`),
following the existing `src/domain/grid.ts` convention of taking a resolver
rather than importing the `Catalog` (so `domain/grid` stays decoupled from the
bundled data, exactly as `cellMass` and `deriveMass` take a `cellMass` resolver
rather than a catalog). A thin catalog-bound wrapper lives wherever convenient
(`domain/catalog.ts` or `stats.ts`).

```ts
import type { TileGrid } from "@/schema/grid";
import type { EntityId } from "@/schema/primitives";

/** One cell offset of a module's polyomino footprint. */
export interface FootprintOffset {
  readonly dx: number;
  readonly dy: number;
}

/**
 * The footprint resolver: maps a module id to its authored polyomino (from the
 * catalog's `ModuleDefinition.footprint`). Returns undefined for an unknown
 * module id; the caller decides how to fault that (analyseShipDesign already
 * reports `unknownModule`). Kept as a parameter so this layer imports no
 * catalog. The default for a module whose catalog entry is missing is treated
 * as the 1-cell `[{0,0}]` polyomino so a partial catalog never widens a module.
 */
export type FootprintResolver = (
  moduleId: EntityId,
) => ReadonlyArray<FootprintOffset> | undefined;

/** A module placed on the grid, yielded once at its anchor. */
export interface PlacedModule {
  /** Anchor cell column. */
  readonly col: number;
  /** Anchor cell row. */
  readonly row: number;
  /** The anchor's equipment (moduleId present; per-instance overrides live
   *  here). Covered cells are NOT yielded — they appear in `coveredCells`. */
  readonly equipment: {
    readonly moduleId: EntityId;
    readonly facing: number;
    readonly channel?: number;
    readonly commsBearing?: number;
    readonly commsRange?: number;
    readonly sensorBearing?: number;
    readonly sensorRangeSetting?: number;
  };
  /** The module's polyomino offsets (from the catalog). Always includes {0,0}. */
  readonly footprint: ReadonlyArray<FootprintOffset>;
  /** Absolute grid coordinates of every covered cell (footprint minus the
   *  anchor, resolved through the anchor's col/row). Empty for a 1-cell module. */
  readonly coveredCells: ReadonlyArray<{ col: number; row: number }>;
}

/**
 * Yield each placed module once, at its anchor, in row-major anchor order.
 * Covered cells (equipment.covers !== undefined) are skipped as yielded modules
 * but DO appear in the anchor's `coveredCells`. A cell whose anchor references a
 * module id the resolver cannot resolve is treated as a 1-cell polyomino at its
 * own coordinate (so an unknown module degrades to the legacy 1-cell behaviour
 * rather than swallowing its neighbours). Pure, deterministic, unit-tested.
 */
export function placedModules(
  grid: TileGrid,
  resolveFootprint: FootprintResolver,
): PlacedModule[];
```

Behaviour:

- Walks `footprint(grid)` (the existing row-major occupied-cell walk). For each
  solid cell with `equipment.moduleId !== undefined`, emit a `PlacedModule`.
- For each anchor, resolve the module's footprint offsets and compute
  `coveredCells = offsets.filter(o => o.dx !== 0 || o.dy !== 0).map(o => ({ col: col + o.dx, row: row + o.dy }))`.
- Cells with `equipment.covers !== undefined` are **not** emitted as placements
  (they belong to the anchor identified by `covers.anchorCol/anchorRow`); they
  are skipped by the `equipment.moduleId !== undefined` test.
- Cells with no equipment are skipped (they are pure structure).

A catalog-bound convenience overload `placedModules(grid, catalog)` threads
`catalog.module(id)?.footprint` as the resolver.

## 4. Grid validation — the polyomino fit refine

Polyomino fit is a **grid-level** concern: an anchor's offsets reach into other
cells, so the check must see the whole grid. It is added as a new refine on
`TileGrid` (`src/schema/grid.ts:226`), alongside the existing `cells.length` and
connection-endpoint refines at `grid.ts:233-251`. The per-cell `SolidCell`
refine at `grid.ts:137` (armour cannot carry equipment) is unchanged — covered
armour cells are already rejected by it.

The refine needs the catalog to resolve footprints. Zod refines are pure
functions on the parsed value, so the check takes one of two forms:

- **Eager, in `analyseShipDesign`** (recommended): the polyomino fit check runs
  in `stats.ts` where the catalog is already in scope, emitting `error` faults
  (`invalidFootprint`) for each violation. This matches where every other
  design-time structural fault is raised (`unknownModule`, `crossFaction`, the
  reachability checks). The schema stays catalog-free.
- **Schema-side, via a footprint resolver threaded through parse**: possible but
  couples parse to the catalog, which the codebase avoids.

Recommended: **eager validation in `analyseShipDesign`**, faulting each
violation. The rules, applied per anchor `A` at `(col, row)` with footprint
offsets `O`:

1. **In bounds.** Every `(col + dx, row + dy)` is inside the grid
   (`0 <= c < cols`, `0 <= r < rows`).
2. **Solid.** Every offset cell is a `solid` cell (not `empty`). A polyomino
   cannot overhang space.
3. **Placeable surface.** Every offset cell's `surface` is `bare` or `deck`, not
   `armor` — armour cannot carry equipment, anchor or covered. (Already enforced
   per-cell by the `SolidCell` refine, but restated here so the fault points at
   the anchor and names the offending offset.)
4. **No overlap.** No offset cell is the anchor or a covered cell of another
   module. Two modules cannot claim the same cell.
5. **Cover back-pointer matches.** Each non-anchor offset cell's
   `equipment.covers` points back at this anchor
   (`covers.moduleId === A.moduleId`, `covers.anchorCol === col`,
   `covers.anchorRow === row`). A covered cell whose back-pointer names a
   different anchor, or a different module id, is a fault.
6. **Anchor has the module.** The anchor cell carries
   `equipment.moduleId === covers.moduleId` (the covered cells agree with the
   anchor about which module is installed).

Faults:

```ts
| { kind: "invalidFootprint"; severity: "error"; col: number; row: number;
    moduleId: EntityId; reason: string }
```

where `reason` is one of: `"offset out of bounds"`, `"offset cell not solid"`,
`"offset cell is armour"`, `"offset cell claimed by another module"`,
`"covered cell back-pointer mismatch"`.

A `default([{ dx: 0, dy: 0 }])` footprint means every 1-cell module trivially
satisfies all six rules (one in-bounds solid placeable cell, no covered cells,
no overlap), so the check is a no-op for existing designs — backward-compatible.

## 5. The cell-iterating sites that migrate to `placedModules`

Today, nine distinct sites read `cell.equipment` straight off the grid. They
split into two groups: **per-module** sites (aggregate a module's contribution
once — these migrate wholesale to `placedModules`) and **per-cell** sites (walk
every solid cell for layer mass/HP/structure and must keep doing so, but must
treat covered cells as structure, not as a second equipment instance).

### Per-module sites — migrate to `placedModules`

| File:line | Current behaviour | Migration |
|---|---|---|
| `src/domain/stats.ts:359-389` (`analyseShipDesign` main loop, equipment branch) | Applies `applyModule` and adds `moduleDef.mass` once per equipment cell. | Iterate `placedModules(grid, resolveFootprint)` for the equipment branch. A multi-cell module applies once at its anchor. Layer mass/HP for every solid cell (the surrounding `footprint(grid)` walk) is unchanged — covered cells still contribute their substrate/surface mass and HP as structure. |
| `src/domain/stats.ts:599-617` (reachability positions: quarters, crewed stations, magazines, finite-ammo weapons) | Collects one position per equipment cell. | Iterate `placedModules`. A multi-cell crew block reports one quarters position (the anchor); a multi-cell weapon reports one weapon position. |
| `src/domain/stats.ts:271-280` (`partFactions`) | Adds the module's faction once per equipment cell. | Iterate `placedModules`. Covered cells do not introduce a faction (they share the anchor's module faction). |
| `src/domain/resolve.ts:144-159` (`maxSightReach`) | Reads each sensor's `detectionRange`. | Iterate `placedModules`. A multi-cell sensor reports once. |
| `src/domain/stats.ts:486-487` (hardwire endpoint resolution) | Resolves `fromCell.equipment.moduleId` / `toCell.equipment.moduleId`. | Hardwires connect anchor cells (a covered cell is not a meaningful endpoint). Either iterate `placedModules` and key endpoints by anchor coord, or reject covered cells as endpoints with an `invalidHardwire` fault. |

### Per-cell sites — keep walking `footprint(grid)`, handle covered cells

| File:line | Current behaviour | Migration |
|---|---|---|
| `src/domain/stats.ts:248-264` (`cellMass`) | Adds `equipment.moduleId`'s mass to the cell's layer mass. | A covered cell has `equipment.moduleId === undefined`, so its equipment-mass contribution is naturally 0 — the anchor cell already carries the full module mass via the per-module loop. **No change needed** once `covers` cells omit `moduleId`. |
| `src/domain/resolve.ts:459-611` (`resolveModules`) | Builds one `ResolvedModule` per solid cell; equipment cells carry the effect. | Keep the per-cell walk (every cell becomes a `SimModule`). For a covered cell, emit a **hull-effect placeholder** (effect `{ kind: "hull" }`, mass = layer mass only, no power/crew/effect) whose `kind` label is the **anchor module's kind** (so the renderer picks up the right colour). The anchor cell emits the full module as today. See section 6. |
| `src/domain/resolve.ts:789-797` (`designCellLayout`) | Calls `resolveModules`; inherits the fix. | No separate change. |
| `src/domain/resolve.ts:691-756` (`engineFacingFor`, `weaponFacingFor`, `commsChannelFor`, `commsBearingFor`, `sensorBearingFor`, and the `*Range` readers) | Read per-instance overrides off `cell.equipment`. | These run per cell inside `resolveModules`. For a covered cell (`equipment.covers !== undefined`, no `moduleId`) they must return their defaults (0 / the effect default). Cleanest: guard each helper on `equipment.moduleId !== undefined` so covered cells fall through to defaults. |
| `src/ui/routes/designerGrid.ts:189-235` (`cellColour`, `cellLabel`, `cellGlyph`) | Reads `catalog.module(cell.equipment.moduleId)` for colour/glyph. | A covered cell looks up its `covers.moduleId` for the **colour** (so it paints as part of the module) but returns `null` for the **glyph** (the glyph is the anchor's alone — section 7). |

The nine sites are the complete set; `grep -rn "cell.equipment" src/` finds no
others outside tests.

## 6. Engine model — anchor carries the effect, covered cells are structure

The engine is cell-based and stays so. The polyomino is resolved away before
the engine sees the ship:

- **Anchor cell** resolves to a `SimModule` carrying the module's full `effect`,
  mass, power draw, crew, and per-instance config — exactly as today.
- **Covered cells** resolve to `SimModule`s with `effect: { kind: "hull" }`
  (pure structure: no behaviour, no power draw, no crew need) but whose `kind`
  **label** is the anchor module's kind (e.g. `"weapon"`), so the snapshot's
  `ShipCellLayout.kind` drives `MODULE_APPEARANCE` to paint the covered cell in
  the module's colour. Their mass is layer mass only (substrate + surface); they
  do not add the module's mass (the anchor already carries it once).

Consequences:

- **Damage** runs per cell as today. Hitting a covered cell ablates that cell's
  HP (it is structure); it does not touch the module's effect. To disable the
  module, the anchor cell must be destroyed. A multi-cell module is therefore a
  harder target only in the sense that its covered cells are ablative structure
  around the anchor — not because its capability is distributed.
- **Break-apart** (next section) needs no algorithmic change.
- **The snapshot wire format** (`ShipCellLayout`, `ShipDescriptor`) is unchanged.
  A covered cell is just another cell entry whose `kind` happens to match the
  anchor's, with the same `slotId` scheme (`cell-<col>-<row>`).
- **No `SimModule` schema change**, no `ShipCellLayout` schema change, no engine
  tick change. This is the property that keeps the lossless gate green.

`resolveModules` pseudocode for a covered cell:

```ts
// covered cell: structure that renders as part of the anchor's module
out.push({
  slotId,
  moduleId: equipment.covers.moduleId, // identity for rendering keying
  kind: anchorKind,                   // paints in the module's colour
  col, row, x: local.x, y: local.y,
  surface: cell.surface, edges: cell.edges,
  maxSurfaceHp, maxSubstrateHp, /* reactive fields */,
  mass: (surfaceMass + substrateMass) * frac, // layer mass only
  powerDraw: 0, crewRequired: 0,
  effect: { kind: "hull" },           // inert
  command: false, repairRate: 0,
  shieldArc: Math.PI * 2, shieldFacing: 0,
  facing: 0, weaponFacing: 0, turretArc: 0, turretTurnRate: 0,
  channel: 0, commsBearing: 0, sensorBearing: 0,
});
```

`anchorKind` is resolved by looking up `catalog.module(equipment.covers.moduleId).effect.kind`
once (cache it per anchor to avoid repeated lookups across the covered set).

## 7. Break-apart rule — straddling a break truncates the module

`analyseBreakApart` (`src/domain/simulation/engine/damage.ts:292`) unions alive
`SimModule`s by 4-connected grid adjacency and splits disconnected components
into chunk ships. Because a multi-cell module's cells are ordinary solid cells
(each a `SimModule`), they participate in connectivity and split exactly like
any other cells. **No engine change is required.**

The rule, stated precisely:

- The **anchor's component** keeps the module's effect. The anchor cell carries
  the `effect`; wherever it lands after the union-find partition, that component
  has the functioning module.
- **Covered cells in another component** lose their cover. They are already
  hull-effect structure (section 6), so "losing their cover" is a rendering
  observation, not an engine action: a covered cell severed from its anchor is
  still a valid structural `SimModule` in its new chunk; it renders in the
  module's colour (its `kind` label is unchanged) but the glyph was only ever
  on the anchor, so the severed fragment shows a coloured structural block with
  no module mark. The module is **truncated** in the sense that its physical
  extent is reduced to the cells that remain with the anchor.

Why no active severance is needed:

- The engine never tracked the cover link at runtime — `covers` is a design-time
  field on `CellEquipment`; by the time the ship is resolved into `SimModule`s
  the link is gone, replaced by per-cell `kind`/`effect`.
- A covered cell's `effect` is `{ kind: "hull" }` regardless of component, so a
  chunk that contains only covered cells (the anchor went with the survivor) has
  no functioning module — just structure. Correct.

**Effect scaling is explicitly out of scope.** The anchor retains full capability
whether zero or all of its covered cells survive. Scaling a module's damage/output
down as its covered cells die would require new per-module live state (a surviving-
cell count consumed by every fire/resource step) and would change the frame hash;
it is a future enhancement, not part of this design. The lossless gate depends on
its absence.

## 8. Render approach — iso, 2D sprite, and designer

The single source of truth for appearance is `MODULE_APPEARANCE`
(`src/ui/render/moduleAppearance.ts`), keyed by `CellKind`. It does not change.
A covered cell's `kind` is the anchor module's kind (section 6), so
`appearanceOf(kind)` already yields the module's colour, glyph, and height for
every cell of the polyomino.

### Isometric view (`src/ui/routes/isoShipCells.ts`)

`drawIsoShipCells` already draws one `isoCellBox` per `RenderCell`. A polyomino
therefore extrudes naturally: each covered cell calls `isoCellBox` with the
module's `app.height`, painting its top face in `app.colour`. Adjacent covered
cells share an edge and their boxes meet flush, so the polyomino reads as one
merged block rising to a uniform height. No geometry change.

The glyph is engraved by `drawTopGlyph` (`isoShipCells.ts:330`) per cell. To
restrict the glyph to the anchor only, the `RenderCell` needs a flag (or the
descriptor needs to mark anchor cells). Cleanest: add an optional
`glyph: boolean` to `ShipCellLayout` (`src/schema/battle.ts:253`), defaulting to
`true` (omitted = draw glyph, for backward compatibility); the resolver sets it
`false` on covered cells. `drawIsoShipCells` and the sprite baker then skip the
glyph stroke when `glyph === false`. The turret barrel (line 306) is already
gated on `m.turretAngle !== undefined`, which is only present on the anchor, so
covered cells never draw a barrel.

### Flat 2D sprite (`src/ui/routes/shipSprite.ts`)

`rasteriseShipSprite` paints each alive cell as a `fillRect` in
`MODULE_COLOUR[c.kind]` then strokes the glyph. A covered cell's `kind` is the
module's kind, so the fill is correct; the glyph stroke (line 234) is gated on
the same `glyph` flag. The wall/door edge accumulation and the hull-outline clip
are unchanged. The sprite cache key (`spriteKey`, line 93) is unchanged — it is
keyed on slot-id set and edge topology, both of which already distinguish the
cells of a polyomino (they have distinct slot ids).

### Designer grid (`src/ui/routes/designerGrid.ts`)

`cellColour` (line 189) currently returns the deck tan for an empty deck cell
and the module colour for an equipment cell. A covered cell must paint in its
anchor module's colour, so the deck branch gains a case: when
`equipment.covers !== undefined`, look up `catalog.module(covers.moduleId).effect.kind`
and return `MODULE_APPEARANCE[kind].colour`. `cellGlyph` (line 229) returns the
module's glyph for equipment cells; covered cells return `null` (no glyph — the
anchor's glyph alone identifies the module). `cellLabel` is unchanged.

### Placement brush (designer interaction)

`applyCellBrush` (line 252) handles the `equipment` brush by setting a single
cell's `equipment`. For a multi-cell module, placing the brush at `(col, row)`
must:

1. Set the anchor cell's `equipment: { moduleId, facing: 0 }`.
2. For each non-anchor offset `(dx, dy)`, set the offset cell's
   `equipment: { covers: { moduleId, anchorCol: col, anchorRow: row } }`
   (rejecting the placement if any offset cell is out of bounds, empty, armour,
   or already claimed — the same rules as the grid refine in section 4).
3. Removing the brush from the anchor must also clear the covered cells'
   `equipment` (set back to `undefined`), so the module is removed as a unit.

This is the only place that authoring the `covers` back-pointers happens; the
grid refine (section 4) validates the result.

## 9. Catalog scaling principles

**Capability scales with cell count; mass falls out of the density system.**

The density system in `src/data/catalog/physics.ts` derives a module's mass from
its authored capability, not from a size class:

- `kineticWeaponMass(projectileMass, muzzleVelocity, density)` (line 478) — mass
  from muzzle kinetic energy `1/2 m v^2`.
- `beamWeaponMass(beamPowerW, density)` (line 495) — mass from sustained beam
  power.
- `reactorMass(outputW, powerDensity, density)` (line 508) — mass from output.
- `engineMass(thrustN, density)` (line 521), `shieldMass(capacity, density)`
  (line 533), `deflectorMass`, `magazineMass`, `crewMass` — each from its
  capability anchor.

A multi-cell module is authored with a proportionally larger capability, and the
mass derivation produces a proportionally larger mass. A 3-cell railgun authors
~3x the muzzle energy of its 1-cell peer; `kineticWeaponMass` yields ~3x the
volume and ~3x the mass. The **footprint does not feed the mass formula** — it is
a geometric record. This keeps one source of truth (capability) and avoids a
parallel "cell-count mass" path that would drift from the calibrated anchors.

The relationship `volume ~ cellCount x CELL_SIZE^3` (with `CELL_SIZE = 1 m`,
`src/domain/grid.ts:20`) is a **catalog-authoring sanity check**, not a runtime
formula: a well-calibrated 3-cell weapon's derived volume should be of the order
of 3 cell-volumes, because the energy-density anchors were calibrated to
cell-scale mechanisms. A module whose derived volume is wildly off its footprint
extent is a calibration smell to fix in the catalog, not an engine concern.

**Which modules get multi-cell variants.** A module earns a multi-cell variant
when (a) its capability naturally scales beyond one cell and (b) the faction's
aesthetic calls for it. Concretely:

- **Weapons** — spinal lines for capital kinetics and lances (a 4-6 cell row
  is a spinal mount); plus-shapes for point-defence batteries; heavy turrets as
  2x2 blocks. Single-cell variants remain for fighters.
- **Reactors** — capital power plants as 2x2 or plus-shape (a big core).
- **Shields/deflectors** — array projectors as plus or cross shapes.
- **Engines** — spinal drive lines for capitals.
- **Sensors/comms** — array lines and 2x2 dishes.
- **Magazines** — 2x2 or line ordnance bays.
- **Crew quarters** — 2x2 habitation blocks.
- **Structure/hull modules, RCS, reaction wheels, hardwire endpoints, single
  PD, signature/cloak/ECM/ECCM/decoy** — stay 1x1. They are either inherently
  cell-sized or punctuate, not polyomino-shaped.

**Thematic shapes per faction** (catalog-authoring convention; the engine treats
all footprints identically). The anchor is always `{0,0}`; the examples below are
canonical offset sets the catalog uses:

| Faction | Shape idiom | Example footprint (offsets) |
|---|---|---|
| Terran | Spinal lines (long rows) — clean engineering | `[{0,0},{1,0},{2,0},{3,0}]` |
| Foundry | Plus / cross shapes — modular blocks | `[{0,0},{1,0},{-1,0},{0,1},{0,-1}]` |
| Crystalline | Diamonds (2x2 and rotated) — faceted | `[{0,0},{1,0},{0,1},{1,1}]` |
| Swarm | Irregular blobs — organic clusters | `[{0,0},{1,0},{0,1},{1,2}]` |
| Corsair / Synthetic | Mixed (lines and 2x2) — pragmatic | varies |

A module's footprint is a property of its `ModuleDefinition`, so a faction can
have both a 1-cell "light railgun" and a 4-cell "spinal railgun" as separate
catalog entries with proportionally different capabilities.

## 10. Lossless-gate reasoning (Phase 2 backward compatibility)

The `LOSSLESS_CHECK=1` suite hashes `result.frames`. After Phase 2 (schema
extended, every existing module still 1x1), it MUST stay green. It does, because:

1. Every existing `ModuleDefinition` parses with `footprint = [{0,0}]` (the
   default). No catalog entry changes.
2. Every existing equipment cell parses as an anchor (`moduleId` present,
   `covers` absent). No persisted design or shared URL changes.
3. `placedModules(grid, resolveFootprint)` for an all-1x1 grid yields exactly
   one `PlacedModule` per equipment cell, at the same `(col, row)`, with
   `coveredCells = []` — the same set and coordinates the per-cell walk produces
   today.
4. `resolveModules` migrated to `placedModules` for the equipment branch emits
   the same `SimModule` per anchor cell (same effect, mass, config). No covered
   cells exist, so no hull-effect placeholders are added.
5. Therefore the resolved `CombatShip.modules` for every preset fleet is
   byte-identical, the engine ticks identically, and the frame hash is unchanged.

Phase 4 (multi-cell presets authored in the catalog) **will** change the hash —
those fleets resolve to different module sets. Phase 5 re-baselines the
`LOSSLESS_REGENERATE` snapshot, as the orchestration notes already state.

## 11. Out of scope

- **Effect scaling with surviving covered cells** (section 7) — future.
- **Shared-HP pools across a polyomino** (a module whose HP is the sum of its
  cells, killed only when all die) — future; would need a per-module aggregate
  on `SimShip` and a damage-routing change.
- **Footprint-driven mass** (making `moduleVolume` a function of cell count) —
  rejected; mass stays capability-derived to keep one source of truth.
- **Diagonal-connected polyominoes** — rejected; 4-connected only, matching the
  grid's connectivity model throughout.
- **Rotating footprints at placement time** — future; today the footprint is
  authored in its canonical orientation and the catalog ships one entry per
  orientation (a horizontal spinal and a vertical spinal are two modules).

## References (files grounded in this design)

- `src/schema/module.ts:637` — `ModuleDefinition` gains `footprint`.
- `src/schema/grid.ts:90` — `CellEquipment` gains `covers`; `:137` armour refine
  unchanged; `:226` `TileGrid` gains the polyomino-fit refine (or it runs in
  `stats.ts`).
- `src/domain/grid.ts` — pure grid helpers; `placedModules` lives alongside
  (`footprint`, `cellAt`) taking a footprint resolver, not a catalog.
- `src/domain/stats.ts:359, 599, 271, 486` — per-module sites migrate to
  `placedModules`; `:248` `cellMass` needs no change once covered cells omit
  `moduleId`.
- `src/domain/resolve.ts:459` — `resolveModules` emits hull-effect placeholders
  for covered cells; `:144` `maxSightReach` and `:691-756` helpers handle covers.
- `src/domain/simulation/engine/damage.ts:292` — break-apart unchanged; rule is
  satisfied by construction (section 7).
- `src/data/catalog/physics.ts:478-575` — capability-derived mass helpers; the
  scaling principle (section 9) reuses these unchanged.
- `src/ui/render/moduleAppearance.ts` — unchanged; covered cells key into it via
  their anchor's `kind`.
- `src/ui/routes/isoShipCells.ts`, `src/ui/routes/shipSprite.ts`,
  `src/ui/routes/designerGrid.ts` — render covered cells in the module colour,
  glyph on anchor only.
- `src/schema/battle.ts:253` — `ShipCellLayout` gains optional `glyph: boolean`.
